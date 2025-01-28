import { useState, useCallback } from "react";

export function useSessionCheck() {
    const [isChecking, setIsChecking] = useState(false);
    const [error, setError] = useState(null);

    const checkSession = useCallback(async (sessionId) => {
        setIsChecking(true);
        setError(null);

        try {
            const response = await fetch("/api/auth/check-session", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ session_id: sessionId }),
            });

            const data = await response.json();
            console.log("Session check result:", {
                success: data.success,
                authenticated: data.authenticated,
                not_found: data.not_found,
                expired: data.expired,
                has_user_details: !!data.user_details,
            });

            if (data.success && data.authenticated && data.user_details) {
                // Store user details and tokens in localStorage
                localStorage.setItem(
                    "user_details",
                    JSON.stringify(data.user_details)
                );

                if (data.user_details.tokens) {
                    console.log("Storing tokens:", {
                        access_token: data.user_details.tokens.access_token
                            ? "Present"
                            : "Missing",
                        refresh_token: data.user_details.tokens.refresh_token
                            ? "Present"
                            : "Missing",
                    });

                    localStorage.setItem(
                        "google_tokens",
                        JSON.stringify({
                            access_token: data.user_details.tokens.access_token,
                            refresh_token:
                                data.user_details.tokens.refresh_token,
                            expires_at:
                                Date.now() +
                                data.user_details.tokens.expires_in * 1000,
                        })
                    );
                }

                return {
                    success: true,
                    authenticated: true,
                    user: data.user_details,
                };
            }

            // Handle various session states
            if (data.not_found) {
                throw new Error("Session not found");
            }
            if (data.expired) {
                throw new Error("Session expired");
            }
            if (!data.authenticated) {
                return {
                    success: true,
                    authenticated: false,
                    waiting: true,
                };
            }

            return data;
        } catch (error) {
            console.error("Session check error:", error);
            setError(error.message);
            return {
                success: false,
                error: error.message,
            };
        } finally {
            setIsChecking(false);
        }
    }, []);

    return {
        checkSession,
        isChecking,
        error,
    };
}
