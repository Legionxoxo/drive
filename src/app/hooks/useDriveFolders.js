import { useState, useCallback } from "react";

export async function fetchDriveFolders() {
    const accessToken = localStorage.getItem("av_access_token");
    const refreshToken = localStorage.getItem("av_refresh_token");

    if (!accessToken || !refreshToken) {
        throw new Error("Authentication required. Please log in again.");
    }

    try {
        const response = await fetch("/api/drive/folders", {
            method: "GET",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "X-Refresh-Token": refreshToken,
            },
        });

        const data = await response.json();

        if (!response.ok) {
            // Handle specific error cases
            if (response.status === 401) {
                // Token expired or invalid
                throw new Error("Session expired. Please log in again.");
            }
            throw new Error(data.error || "Failed to fetch folders");
        }

        // If we got a new access token, update it in localStorage
        if (data.new_access_token) {
            localStorage.setItem("av_access_token", data.new_access_token);
        }

        // Return the folders data
        return {
            folders: data.folders || [],
            count: data.count || 0,
            success: true,
        };
    } catch (error) {
        console.error("Error fetching folders:", error);
        throw error; // Re-throw to let caller handle the error
    }
}

// Custom hook for fetching drive folders
export function useDriveFolders() {
    const [folders, setFolders] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchFolders = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await fetchDriveFolders();
            setFolders(result.folders);
        } catch (err) {
            setError(err.message);
            // If authentication error, redirect to login
            if (err.message.includes("Authentication required")) {
                // Clear tokens as they might be invalid
                localStorage.removeItem("av_access_token");
                localStorage.removeItem("av_refresh_token");
            }
        } finally {
            setLoading(false);
        }
    }, []);

    return {
        folders,
        loading,
        error,
        fetchFolders,
    };
}
