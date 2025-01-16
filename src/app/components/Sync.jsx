"use client";

import { useState, useEffect } from "react";
import { startPull, startPush, startSync, stopSync } from "../actions/sync";

export default function SyncStatus() {
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastSynced, setLastSynced] = useState(null);
    const [selectedFolder, setSelectedFolder] = useState("");
    const [driveFolders, setDriveFolders] = useState([]);
    const [selectedDriveFolderId, setSelectedDriveFolderId] = useState("");

    useEffect(() => {
        const checkSyncStatus = async () => {
            const response = await fetch("/api/sync/status");
            const data = await response.json();
            setIsSyncing(data.isSyncing);
            setLastSynced(data.lastSynced);
            setSelectedFolder(data.selectedFolder || "");
        };

        checkSyncStatus();
        const interval = setInterval(checkSyncStatus, 5000);

        return () => clearInterval(interval);
    }, []);

    const fetchDriveFolders = async () => {
        try {
            const response = await fetch("/api/drive/folders");
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || "Failed to fetch folders");
            }

            const data = await response.json();
            if (data.success && data.folders) {
                console.log("Fetched folders:", data.folders); // Debug log
                setDriveFolders(data.folders);
            } else {
                throw new Error("No folders data received");
            }
        } catch (error) {
            console.error("Error fetching folders:", error);
            alert(`Error fetching folders: ${error.message}`);
        }
    };

    const handleStartSync = async () => {
        try {
            await startSync(selectedFolder);
            setIsSyncing(true);
        } catch (error) {
            console.error("Error starting sync:", error);
            alert(`Error starting sync: ${error.message}`);
        }
    };

    const handleStopSync = async () => {
        try {
            await stopSync();
            setIsSyncing(false);
        } catch (error) {
            console.error("Error stopping sync:", error);
        }
    };

    const handleStartPull = async () => {
        try {
            if (!selectedDriveFolderId) {
                alert("Please select a Google Drive folder first.");
                return;
            }

            // Start pull operation
            await startPull(selectedDriveFolderId);
            setIsSyncing(false);
        } catch (error) {
            console.error("Error starting pull:", error);
            alert(`Error starting pull: ${error.message}`);
        }
    };

    const handleStartPush = async () => {
        try {
            await startPush(selectedFolder);
            setIsSyncing(false);
        } catch (error) {
            console.error("Error starting push:", error);
            alert(`Error starting push: ${error.message}`);
        }
    };

    const handleFolderSelect = async () => {
        try {
            // Use showDirectoryPicker API to select folder
            const dirHandle = await window.showDirectoryPicker({
                mode: "readwrite",
            });

            // Get permission to read the directory
            const permission = await dirHandle.requestPermission({
                mode: "readwrite",
            });
            if (permission !== "granted") {
                throw new Error("Permission to access the folder was denied");
            }

            // Save the folder path
            const folderPath = dirHandle.name;
            setSelectedFolder(folderPath);

            // Send the folder path to the server
            const response = await fetch("/api/sync/folder", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    folderName: folderPath,
                }),
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    console.log("Selected folder:", data.folderPath);
                } else {
                    throw new Error(data.error || "Failed to select folder");
                }
            } else {
                const error = await response.json();
                throw new Error(error.error || "Failed to select folder");
            }
        } catch (error) {
            console.error("Error selecting folder:", error);
            alert(`Error selecting folder: ${error.message}`);
        }
    };

    return (
        <div className="flex flex-col items-center">
            <div className="mb-4">
                <button
                    onClick={handleFolderSelect}
                    className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
                >
                    Select Sync Folder
                </button>
                {selectedFolder && (
                    <p className="mt-2">Selected folder: {selectedFolder}</p>
                )}
            </div>

            <div className="mb-4">
                <button
                    onClick={fetchDriveFolders}
                    className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
                >
                    Fetch Drive Folders
                </button>
                {driveFolders.length > 0 ? (
                    <div className="mt-2">
                        <select
                            onChange={(e) =>
                                setSelectedDriveFolderId(e.target.value)
                            }
                            value={selectedDriveFolderId}
                            className="block w-full p-2 border rounded"
                        >
                            <option value="">Select a folder</option>
                            {driveFolders.map((folder) => (
                                <option key={folder.id} value={folder.id}>
                                    {folder.name}
                                </option>
                            ))}
                        </select>
                    </div>
                ) : (
                    <p className="mt-2 text-gray-600">
                        No folders found. Click to fetch folders.
                    </p>
                )}
            </div>

            <p className="mb-4">
                Status: {isSyncing ? "Syncing" : "Not syncing"}
            </p>
            {lastSynced && (
                <p className="mb-4">
                    Last synced: {new Date(lastSynced).toLocaleString()}
                </p>
            )}
            <button
                onClick={handleStartSync}
                className="mb-4 bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded"
                disabled={!selectedFolder}
            >
                Start Sync
            </button>
            <button
                onClick={handleStopSync}
                className="mb-4 bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
            >
                Stop Sync
            </button>
            <button
                onClick={handleStartPush}
                className="mb-4 bg-yellow-500 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded"
                disabled={!selectedFolder}
            >
                Start Push
            </button>
            <button
                onClick={handleStartPull}
                className="mb-4 bg-purple-500 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded"
            >
                Start Pull
            </button>
        </div>
    );
}
