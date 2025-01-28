"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../hooks/useAuth";

export default function DriveFolders() {
    const [folders, setFolders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const { fetchDriveFolders } = useAuth();

    const loadFolders = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const driveFolders = await fetchDriveFolders();
            setFolders(driveFolders);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [fetchDriveFolders]);

    useEffect(() => {
        loadFolders();
    }, [loadFolders]);

    const handleRefresh = () => {
        loadFolders();
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-6 bg-white rounded-lg shadow-md">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-semibold text-red-600">
                        Error Loading Folders
                    </h3>
                    <button
                        onClick={handleRefresh}
                        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                    >
                        Try Again
                    </button>
                </div>
                <p className="text-gray-800 mb-4">{error}</p>

                {error.includes("API has not been used") ||
                error.includes("not enabled") ? (
                    <div className="bg-blue-50 p-4 rounded-md">
                        <h4 className="font-semibold text-blue-800 mb-2">
                            How to fix this:
                        </h4>
                        <ol className="list-decimal list-inside space-y-2 text-blue-900">
                            <li>
                                Visit the{" "}
                                <a
                                    href="https://console.cloud.google.com/apis/library/drive.googleapis.com"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:text-blue-800 underline"
                                >
                                    Google Cloud Console
                                </a>
                            </li>
                            <li>
                                Make sure you're signed in with the same Google
                                account
                            </li>
                            <li>
                                Click "Enable" to enable the Google Drive API
                            </li>
                            <li>
                                Wait a few minutes for the changes to take
                                effect
                            </li>
                            <li>Click the "Try Again" button above</li>
                        </ol>
                    </div>
                ) : null}
            </div>
        );
    }

    return (
        <div className="p-4">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold">Your Drive Folders</h2>
                <button
                    onClick={handleRefresh}
                    className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors flex items-center space-x-2"
                >
                    <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                        />
                    </svg>
                    <span>Refresh</span>
                </button>
            </div>
            <div className="space-y-2">
                {folders.length === 0 ? (
                    <p className="text-gray-600">
                        No folders found in your Google Drive.
                    </p>
                ) : (
                    folders.map((folder) => (
                        <div
                            key={folder.id}
                            className="p-3 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
                        >
                            <div className="flex items-center space-x-2">
                                <svg
                                    className="w-6 h-6 text-yellow-500"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                                    />
                                </svg>
                                <span className="text-gray-800">
                                    {folder.name}
                                </span>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
