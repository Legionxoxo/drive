"use client";

import { createContext, useContext, useState, useEffect } from "react";

const AuthContext = createContext();

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    // Load user from localStorage on mount
    useEffect(() => {
        try {
            const storedUser = localStorage.getItem("av_user");
            const storedSession = localStorage.getItem("av_session");
            const accessToken = localStorage.getItem("av_access_token");
            const refreshToken = localStorage.getItem("av_refresh_token");

            if (storedUser && storedSession && accessToken && refreshToken) {
                // Parse the stored user data
                const parsedUser = JSON.parse(storedUser);
                // Add tokens to user object
                parsedUser.accessToken = accessToken;
                parsedUser.refreshToken = refreshToken;
                setUser(parsedUser);
            }
            setIsLoading(false);
        } catch (error) {
            console.error("Error restoring session:", error);
            // Clear potentially corrupted data
            localStorage.removeItem("av_user");
            localStorage.removeItem("av_session");
            localStorage.removeItem("av_access_token");
            localStorage.removeItem("av_refresh_token");
            setIsLoading(false);
        }
    }, []);

    const updateUser = (newUser, sessionId) => {
        setUser(newUser);
        if (newUser && sessionId) {
            try {
                localStorage.setItem("av_user", JSON.stringify(newUser));
                localStorage.setItem("av_session", sessionId);
                // Tokens are handled separately in the login flow
            } catch (error) {
                console.error("Error saving session:", error);
            }
        } else {
            localStorage.removeItem("av_user");
            localStorage.removeItem("av_session");
            localStorage.removeItem("av_access_token");
            localStorage.removeItem("av_refresh_token");
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            </div>
        );
    }

    return (
        <AuthContext.Provider value={{ user, setUser: updateUser }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuthContext() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuthContext must be used within an AuthProvider");
    }
    return context;
}
