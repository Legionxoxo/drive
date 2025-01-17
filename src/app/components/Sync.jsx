"use client";

import { useState, useEffect } from "react";
import { startPull, startPush, startSync, stopSync } from "../actions/sync";

export default function SyncStatus() {
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastSynced, setLastSynced] = useState(null);
    const [selectedFolder, setSelectedFolder] = useState("");
    const [driveFolders, setDriveFolders] = useState([]);
    const [selectedDriveFolderId, setSelectedDriveFolderId] = useState("");
    const [uploadProgress, setUploadProgress] = useState(0);
    const [currentFile, setCurrentFile] = useState("");
    const [totalFiles, setTotalFiles] = useState(0);
    const [processedFiles, setProcessedFiles] = useState(0);

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
            console.log("Fetching drive folders..."); // Debug log
            const response = await fetch("/api/drive/folders");
            const data = await response.json();

            console.log("Drive folders response:", data); // Debug log

            if (!response.ok) {
                throw new Error(data.error || "Failed to fetch folders");
            }

            if (data.success && data.folders) {
                console.log(`Found ${data.folders.length} folders`); // Debug log
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
            console.log("Starting push operation...");
            setIsSyncing(true);
            setUploadProgress(0);
            setCurrentFile("");
            setProcessedFiles(0);
            setTotalFiles(0);

            const dirHandle = await window.showDirectoryPicker({
                mode: "read",
            });

            console.log(`Selected directory: ${dirHandle.name}`);
            const files = [];
            const folders = [];

            async function processDirectory(handle, path = "") {
                console.log(`Processing directory: ${path || handle.name}`);
                for await (const [name, entry] of handle.entries()) {
                    if (entry.kind === "file") {
                        setCurrentFile(
                            `Scanning: ${path ? `${path}/${name}` : name}`
                        );
                        const file = await entry.getFile();
                        files.push({
                            name,
                            path: path ? `${path}/${name}` : name,
                            lastModified: file.lastModified,
                            size: file.size,
                            type: file.type,
                            content: await file.arrayBuffer(),
                        });
                    } else if (entry.kind === "directory") {
                        folders.push({
                            name,
                            path: path ? `${path}/${name}` : name,
                        });
                        await processDirectory(
                            entry,
                            path ? `${path}/${name}` : name
                        );
                    }
                }
            }

            await processDirectory(dirHandle);
            setTotalFiles(files.length);
            console.log(
                `Found ${files.length} files and ${folders.length} folders`
            );

            console.log("Uploading to Google Drive...");
            const response = await fetch("/api/push", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    rootFolder: dirHandle.name,
                    folders,
                    files: files.map((f, index) => {
                        setProcessedFiles(index + 1);
                        setCurrentFile(`Uploading: ${f.path}`);
                        setUploadProgress(((index + 1) / files.length) * 100);
                        return {
                            name: f.name,
                            path: f.path,
                            lastModified: f.lastModified,
                            size: f.size,
                            type: f.type,
                            content: Array.from(new Uint8Array(f.content)),
                        };
                    }),
                }),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || "Failed to push files");
            }

            console.log("Push operation completed successfully");
            setUploadProgress(100);
            setCurrentFile("Completed");
            alert("Push completed successfully!");
            setIsSyncing(false);
        } catch (error) {
            console.error("Error starting push:", error);
            if (error.name === "AbortError") {
                console.log("User cancelled directory selection");
                setIsSyncing(false);
                return;
            }
            alert(`Error starting push: ${error.message}`);
            setIsSyncing(false);
        } finally {
            setUploadProgress(0);
            setCurrentFile("");
            setProcessedFiles(0);
            setTotalFiles(0);
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
                        <p>Found {driveFolders.length} folders</p>
                        <select
                            onChange={(e) => {
                                setSelectedDriveFolderId(e.target.value);
                                console.log(
                                    "Selected folder ID:",
                                    e.target.value
                                ); // Debug log
                            }}
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
                        {selectedDriveFolderId && (
                            <p className="mt-2">
                                Selected folder:{" "}
                                {
                                    driveFolders.find(
                                        (f) => f.id === selectedDriveFolderId
                                    )?.name
                                }
                            </p>
                        )}
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

            {isSyncing && (
                <div className="w-full max-w-md mb-4">
                    <div className="mb-2 flex justify-between">
                        <span className="text-sm text-gray-600">
                            {currentFile}
                        </span>
                        <span className="text-sm text-gray-600">
                            {processedFiles} / {totalFiles} files
                        </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2.5">
                        <div
                            className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                            style={{ width: `${uploadProgress}%` }}
                        ></div>
                    </div>
                    <div className="mt-1 text-right text-sm text-gray-600">
                        {Math.round(uploadProgress)}%
                    </div>
                </div>
            )}
        </div>
    );
}
