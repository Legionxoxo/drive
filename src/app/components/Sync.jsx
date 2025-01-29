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
    const [pullFolderPath, setPullFolderPath] = useState("");

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
            const accessToken = localStorage.getItem("av_access_token");
            const refreshToken = localStorage.getItem("av_refresh_token");

            if (!accessToken || !refreshToken) {
                throw new Error(
                    "Authentication required. Please log in again."
                );
            }

            // Log token format
            console.log("Access Token (first 10 chars):", accessToken);
            console.log("Refresh Token (first 10 chars):", refreshToken);

            const response = await fetch("/api/drive/folders", {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "X-Refresh-Token": refreshToken,
                },
            });

            const data = await response.json();
            console.log("Drive folders response:", data); // Debug log

            if (!response.ok) {
                if (response.status === 401) {
                    // Clear tokens and redirect to login
                    localStorage.removeItem("av_access_token");
                    localStorage.removeItem("av_refresh_token");
                    throw new Error("Session expired. Please log in again.");
                }
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

            // Handle authentication errors
            if (
                error.message.includes("Authentication required") ||
                error.message.includes("Session expired")
            ) {
                localStorage.removeItem("av_access_token");
                localStorage.removeItem("av_refresh_token");
                // Redirect to login or trigger re-login
                window.location.href = "/";
            }
        }
    };

    const handleStartSync = async () => {
        try {
            if (!selectedDriveFolderId) {
                alert("Please select a Google Drive folder first.");
                return;
            }

            const selection = await handleFileOrFolderSelect("readwrite");
            if (!selection) {
                return;
            }

            if (selection.totalItems === 0) {
                alert("Please select at least one file or folder to sync");
                return;
            }

            // For sync, we'll process one item at a time
            for (const folder of selection.folders) {
                setSelectedFolder(folder.path);
                setIsSyncing(true);
                await startSync(selectedDriveFolderId, folder.path, true);
            }

            for (const file of selection.files) {
                setSelectedFolder(file.path);
                setIsSyncing(true);
                await startSync(selectedDriveFolderId, file.path, false);
            }

            alert("Sync started successfully!");
        } catch (error) {
            console.error("Error starting sync:", error);
            alert(`Error starting sync: ${error.message}`);
            setIsSyncing(false);
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
            if (!pullFolderPath) {
                alert("Please select a local folder to save the files.");
                return;
            }

            setIsSyncing(true);
            // Start pull operation with both folder IDs
            await startPull(selectedDriveFolderId, pullFolderPath);
            setIsSyncing(false);
            alert("Pull completed successfully!");
        } catch (error) {
            console.error("Error starting pull:", error);
            alert(`Error starting pull: ${error.message}`);
            setIsSyncing(false);
        }
    };

    const handleFileOrFolderSelect = async (mode = "readwrite") => {
        try {
            // Ask user if they want to select files or folders
            const selectType = window.confirm(
                "Click OK to select folders, or Cancel to select files"
            );

            let handles = [];
            if (selectType) {
                // User wants to select folders
                const dirHandle = await window.showDirectoryPicker({
                    mode: mode,
                    startIn: "desktop",
                });
                handles = [dirHandle];
            } else {
                // User wants to select files
                handles = await window.showOpenFilePicker({
                    multiple: true,
                    types: [
                        {
                            description: "All Files",
                            accept: {
                                "*/*": [],
                            },
                        },
                    ],
                    excludeAcceptAllOption: false,
                });
            }

            const files = [];
            const folders = [];

            // Process each selected handle
            for (const handle of handles) {
                try {
                    const permission = await handle.requestPermission({
                        mode: mode,
                    });

                    if (permission !== "granted") {
                        throw new Error(`Permission denied for ${handle.name}`);
                    }

                    const path = await getFullPath(handle);

                    if (selectType) {
                        // It's a folder
                        folders.push({
                            handle,
                            path,
                            name: handle.name,
                            isDirectory: true,
                        });
                    } else {
                        // It's a file
                        const info = await handle.getFile();
                        files.push({
                            handle,
                            path,
                            name: handle.name,
                            type: info.type,
                            size: info.size,
                            lastModified: info.lastModified,
                            isDirectory: false,
                        });
                    }
                } catch (error) {
                    console.error(`Error processing ${handle.name}:`, error);
                }
            }

            return {
                files,
                folders,
                totalItems: files.length + folders.length,
            };
        } catch (error) {
            if (error.name === "AbortError") {
                console.log("User cancelled selection");
                return null;
            }
            console.error("Error in file/folder selection:", error);
            throw error;
        }
    };

    const handleStartPush = async () => {
        try {
            if (!selectedDriveFolderId) {
                alert("Please select a Google Drive folder first.");
                return;
            }

            setIsSyncing(true);
            setUploadProgress(0);
            setCurrentFile("");
            setProcessedFiles(0);
            setTotalFiles(0);

            const selection = await handleFileOrFolderSelect("read");
            if (!selection) {
                setIsSyncing(false);
                return;
            }

            const allFiles = [];
            const allFolders = [...selection.folders];

            // Process files directly selected
            for (const file of selection.files) {
                const fileHandle = file.handle;
                const fileInfo = await fileHandle.getFile();
                allFiles.push({
                    name: fileInfo.name,
                    path: file.path,
                    lastModified: fileInfo.lastModified,
                    size: fileInfo.size,
                    type: fileInfo.type,
                    content: await fileInfo.arrayBuffer(),
                });
            }

            // Process folders and their contents
            for (const folder of selection.folders) {
                async function processDirectory(
                    directoryHandle,
                    basePath = ""
                ) {
                    for await (const entry of directoryHandle.values()) {
                        const entryPath = basePath
                            ? `${basePath}/${entry.name}`
                            : entry.name;

                        if (entry.kind === "file") {
                            setCurrentFile(`Scanning: ${entryPath}`);
                            const file = await entry.getFile();
                            allFiles.push({
                                name: entry.name,
                                path: entryPath,
                                lastModified: file.lastModified,
                                size: file.size,
                                type: file.type,
                                content: await file.arrayBuffer(),
                            });
                        } else if (entry.kind === "directory") {
                            allFolders.push({
                                name: entry.name,
                                path: entryPath,
                            });
                            await processDirectory(entry, entryPath);
                        }
                    }
                }
                await processDirectory(folder.handle);
            }

            setTotalFiles(allFiles.length);

            const accessToken = localStorage.getItem("av_access_token");
            const refreshToken = localStorage.getItem("av_refresh_token");

            const response = await fetch("/api/push", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-auth-tokens": JSON.stringify({
                        av_access_token: accessToken,
                        av_refresh_token: refreshToken,
                    }),
                },
                body: JSON.stringify({
                    targetFolderId: selectedDriveFolderId,
                    folders: allFolders,
                    files: allFiles.map((f, index) => {
                        setProcessedFiles(index + 1);
                        setCurrentFile(`Uploading: ${f.path}`);
                        setUploadProgress(
                            ((index + 1) / allFiles.length) * 100
                        );
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

            setUploadProgress(100);
            setCurrentFile("Completed");
            alert("Push completed successfully!");
        } catch (error) {
            console.error("Error starting push:", error);
            alert(`Error starting push: ${error.message}`);
        } finally {
            setIsSyncing(false);
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

    const handlePullFolderSelect = async () => {
        try {
            const dirHandle = await window.showDirectoryPicker({
                mode: "readwrite",
            });

            // Get permission to read/write to the directory
            const permission = await dirHandle.requestPermission({
                mode: "readwrite",
            });
            if (permission !== "granted") {
                throw new Error("Permission to access the folder was denied");
            }

            // Get the full path
            const fullPath = await getFullPath(dirHandle);

            // Verify the path with the user
            if (confirm(`Confirm saving files to: ${fullPath}`)) {
                setPullFolderPath(fullPath);
                console.log("Selected pull folder path:", fullPath); // Debug log
            } else {
                throw new Error("Path selection cancelled by user");
            }
        } catch (error) {
            console.error("Error selecting pull folder:", error);
            alert(`Error selecting pull folder: ${error.message}`);
        }
    };

    // Helper function to get the full path
    const getFullPath = async (dirHandle) => {
        try {
            // First try to get the path from the user
            const userPath = prompt(
                "Please enter or confirm the full path where you want to save the files:",
                `C:\\Users\\${process.env.USERNAME || "User"}\\Downloads\\${
                    dirHandle.name
                }`
            );

            if (!userPath) {
                throw new Error("No path provided");
            }

            // Clean up the path - ensure proper Windows path format
            const cleanPath = userPath
                .trim()
                .replace(/[\\/]+/g, "\\") // Replace multiple slashes or backslashes with a single backslash
                .replace(/\\$/, ""); // Remove trailing slash if present

            // Validate the path format
            if (!/^[a-zA-Z]:\\/.test(cleanPath)) {
                throw new Error(
                    "Invalid path format. Path must start with drive letter (e.g., C:\\)"
                );
            }

            return cleanPath;
        } catch (error) {
            console.error("Error getting path:", error);
            throw new Error("Failed to get a valid folder path");
        }
    };

    //component for recursive folder display
    function FolderTree({ folder, onSelect, selectedId, level = 0 }) {
        const [isExpanded, setIsExpanded] = useState(false);

        return (
            <div style={{ marginLeft: `${level * 20}px` }}>
                <div className="flex items-center py-1 hover:bg-gray-100 rounded">
                    <div
                        className="flex items-center flex-1 cursor-pointer"
                        onClick={() => onSelect(folder.id)}
                    >
                        <span className="w-4 text-gray-500 mr-2">
                            {folder.children.length > 0 ? (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setIsExpanded(!isExpanded);
                                    }}
                                    className="focus:outline-none"
                                >
                                    {isExpanded ? "▼" : "▶"}
                                </button>
                            ) : (
                                <span className="ml-4"></span>
                            )}
                        </span>
                        <span
                            className={`px-2 py-1 rounded ${
                                selectedId === folder.id
                                    ? "bg-blue-100 text-blue-700"
                                    : ""
                            }`}
                        >
                            📁 {folder.name}
                        </span>
                    </div>
                </div>
                {isExpanded && folder.children.length > 0 && (
                    <div>
                        {folder.children.map((child) => (
                            <FolderTree
                                key={child.id}
                                folder={child}
                                onSelect={onSelect}
                                selectedId={selectedId}
                                level={level + 1}
                            />
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // helper function to find folder names
    function findFolderName(folders, targetId) {
        for (const folder of folders) {
            if (folder.id === targetId) {
                return folder.name;
            }
            if (folder.children.length > 0) {
                const name = findFolderName(folder.children, targetId);
                if (name) return name;
            }
        }
        return null;
    }

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
                    <div className="mt-2 w-full max-w-md border rounded p-4 bg-white">
                        <p className="mb-2">
                            Found {driveFolders.length} folders
                        </p>
                        <div className="max-h-60 overflow-y-auto">
                            {driveFolders.map((folder) => (
                                <FolderTree
                                    key={folder.id}
                                    folder={folder}
                                    onSelect={setSelectedDriveFolderId}
                                    selectedId={selectedDriveFolderId}
                                />
                            ))}
                        </div>
                        {selectedDriveFolderId && (
                            <p className="mt-2 text-sm text-gray-600">
                                Selected folder:{" "}
                                {findFolderName(
                                    driveFolders,
                                    selectedDriveFolderId
                                )}
                            </p>
                        )}
                    </div>
                ) : (
                    <p className="mt-2 text-gray-600">
                        No folders found. Click to fetch folders.
                    </p>
                )}
            </div>

            <div className="mb-4">
                <button
                    onClick={handlePullFolderSelect}
                    className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
                >
                    Select Local Folder for Pull
                </button>
                {pullFolderPath && (
                    <p className="mt-2">
                        Selected local folder: {pullFolderPath}
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
                disabled={!selectedDriveFolderId || !pullFolderPath}
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
