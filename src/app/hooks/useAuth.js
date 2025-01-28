"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthContext } from "../components/AuthProvider";

export function useAuth() {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const { user, setUser } = useAuthContext();
    const router = useRouter();

    const login = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            // Get session ID from API route
            const sessionResponse = await fetch("/api/auth/create-session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            });

            const sessionData = await sessionResponse.json();

            if (!sessionData.success) {
                throw new Error(sessionData.msg || "Failed to create session");
            }

            // Open login window
            const loginWindow = window.open(
                `https://login.myairvault.com/?session_id=${sessionData.session_id}`,
                "Login",
                "width=600,height=800"
            );

            if (!loginWindow) {
                throw new Error(
                    "Popup blocked. Please allow popups and try again."
                );
            }

            // Poll for session status
            const checkInterval = setInterval(async () => {
                try {
                    const checkResponse = await fetch(
                        "/api/auth/check-session",
                        {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                session_id: sessionData.session_id,
                            }),
                        }
                    );

                    const checkData = await checkResponse.json();

                    if (checkData.not_found || checkData.expired) {
                        clearInterval(checkInterval);
                        loginWindow.close();
                        setError("Login session expired. Please try again.");
                        setIsLoading(false);
                        return;
                    }

                    if (checkData.authenticated && checkData.user_details) {
                        clearInterval(checkInterval);
                        loginWindow.close();

                        // Store tokens in localStorage
                        if (checkData.user_details.accessToken) {
                            localStorage.setItem(
                                "av_access_token",
                                checkData.user_details.accessToken
                            );
                        }
                        if (checkData.user_details.refreshToken) {
                            localStorage.setItem(
                                "av_refresh_token",
                                checkData.user_details.refreshToken
                            );
                        }

                        setUser(checkData.user_details, sessionData.session_id);
                        setIsLoading(false);
                        router.push("/");
                    }
                } catch (err) {
                    clearInterval(checkInterval);
                    loginWindow.close();
                    setError("Failed to check login status. Please try again.");
                    setIsLoading(false);
                }
            }, 2000);

            // Clean up interval after 1 minute
            setTimeout(() => {
                clearInterval(checkInterval);
                loginWindow.close();
                if (!user) {
                    setError("Login session expired. Please try again.");
                    setIsLoading(false);
                }
            }, 65000);
        } catch (err) {
            setError(err instanceof Error ? err.message : "An error occurred");
            setIsLoading(false);
        }
    }, [user, router, setUser]);

    const logout = useCallback(() => {
        // Clear tokens on logout
        localStorage.removeItem("av_access_token");
        localStorage.removeItem("av_refresh_token");
        setUser(null, null);
        setError(null);
        router.push("/");
    }, [router, setUser]);

    const fetchDriveFolders = useCallback(async () => {
        try {
            const accessToken = localStorage.getItem("av_access_token");
            const refreshToken = localStorage.getItem("av_refresh_token");

            if (!accessToken || !refreshToken) {
                throw new Error("Not authenticated. Please login again.");
            }

            // Use server-side endpoint that handles OAuth2 properly
            const response = await fetch("/api/drive/folders", {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "X-Refresh-Token": refreshToken,
                },
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || "Failed to fetch folders");
            }

            // Handle token refresh if new token was returned
            if (data.new_access_token) {
                localStorage.setItem("av_access_token", data.new_access_token);
            }

            return data.folders;
        } catch (error) {
            console.error("Error fetching drive folders:", error);
            // If authentication error, clear tokens and redirect to login
            if (
                error.message.includes("Not authenticated") ||
                error.message.includes("Authentication tokens required")
            ) {
                localStorage.removeItem("av_access_token");
                localStorage.removeItem("av_refresh_token");
                setUser(null, null);
                router.push("/");
            }
            throw error;
        }
    }, [router, setUser]);

    return {
        user,
        isLoading,
        error,
        login,
        logout,
        fetchDriveFolders,
    };
}
