"use server";

import { getServerSession } from "next-auth/next";
import { authOptions } from "../../pages/api/auth/[...nextauth]";
import { google } from "googleapis";
import fs from "fs";
import path from "path";
import chokidar from "chokidar";
import dotenv from "dotenv";
import { promises as fsPromises } from "fs";

dotenv.config();

let watcher = null;

// Helper function to log messages with a timestamp
function log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
}

// Helper function to initialize Google Drive client
async function initializeDrive() {
    const session = await getServerSession(authOptions);
    if (!session?.accessToken) {
        throw new Error("Not authenticated");
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: session.accessToken });

    return google.drive({ version: "v3", auth: oauth2Client });
}

async function createOrGetDriveFolder(drive, dirHandle, parentId = null) {
    const folderName = dirHandle.name;
    log(
        `Creating/Getting folder: ${folderName} ${
            parentId ? `under parent: ${parentId}` : "(root)"
        }`
    );

    try {
        // Search for existing folder
        const searchQuery = parentId
            ? `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
            : `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

        const response = await drive.files.list({
            q: searchQuery,
            fields: "files(id, name)",
        });

        if (response.data.files.length > 0) {
            const folderId = response.data.files[0].id;
            log(`Found existing folder: ${folderName} (${folderId})`);
            return folderId;
        }

        // Create new folder
        const folderMetadata = {
            name: folderName,
            mimeType: "application/vnd.google-apps.folder",
            parents: parentId ? [parentId] : undefined,
        };

        const folder = await drive.files.create({
            resource: folderMetadata,
            fields: "id",
        });

        log(`Created new folder: ${folderName} (${folder.data.id})`);
        return folder.data.id;
    } catch (error) {
        log(
            `Error in createOrGetDriveFolder for ${folderName}: ${error.message}`
        );
        throw error;
    }
}

async function uploadLargeFile(drive, filePath, folderId) {
    const fileName = path.basename(filePath);
    const fileSize = fs.statSync(filePath).size;
    const chunkSize = 5 * 1024 * 1024; // 5MB chunks

    const fileMetadata = {
        name: fileName,
        parents: [folderId],
    };

    // Check if file already exists
    const existingFileResponse = await drive.files.list({
        q: `name='${fileName}' and '${folderId}' in parents`,
        fields: "files(id, modifiedTime)",
    });

    try {
        if (existingFileResponse.data.files.length > 0) {
            const driveFile = existingFileResponse.data.files[0];
            const localMTime = fs.statSync(filePath).mtime.toISOString();

            if (new Date(driveFile.modifiedTime) >= new Date(localMTime)) {
                log(`${fileName} is already up-to-date in Google Drive.`);
                return;
            }

            // Initialize resumable upload session for update
            const res = await drive.files.update(
                {
                    fileId: driveFile.id,
                    media: {
                        body: fs.createReadStream(filePath, {
                            highWaterMark: chunkSize,
                        }),
                    },
                    uploadType: "resumable",
                },
                {
                    // Configure axios for resumable upload
                    onUploadProgress: (evt) => {
                        const progress = (evt.bytesRead / fileSize) * 100;
                        log(
                            `Updating ${fileName}: ${Math.round(
                                progress
                            )}% complete`
                        );
                    },
                }
            );

            log(`Updated ${fileName} in Google Drive.`);
            return res.data.id;
        } else {
            // Initialize resumable upload session for new file
            const res = await drive.files.create(
                {
                    resource: fileMetadata,
                    media: {
                        body: fs.createReadStream(filePath, {
                            highWaterMark: chunkSize,
                        }),
                    },
                    fields: "id",
                    uploadType: "resumable",
                },
                {
                    // Configure axios for resumable upload
                    onUploadProgress: (evt) => {
                        const progress = (evt.bytesRead / fileSize) * 100;
                        log(
                            `Uploading ${fileName}: ${Math.round(
                                progress
                            )}% complete`
                        );
                    },
                }
            );

            log(`Uploaded ${fileName} to Google Drive.`);
            return res.data.id;
        }
    } catch (error) {
        if (error.code === "ECONNRESET" || error.code === "ETIMEDOUT") {
            // Implement retry logic
            log(`Upload interrupted for ${fileName}. Retrying...`);
            // You could implement exponential backoff here
            return uploadLargeFile(drive, filePath, folderId);
        }

        log(`Error uploading ${fileName}: ${error.message}`);
        throw error;
    }
}

// Helper function to handle retries with exponential backoff
async function retryWithBackoff(fn, maxRetries = 5) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            const waitTime = Math.min(1000 * Math.pow(2, i), 10000);
            await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
    }
}

async function downloadLargeFile(drive, fileId, fileName, targetPath) {
    const filePath = path.join(targetPath, fileName);
    const dest = fs.createWriteStream(filePath);

    try {
        const response = await drive.files.get(
            { fileId: fileId, alt: "media" },
            { responseType: "stream" }
        );

        response.data.pipe(dest);

        return new Promise((resolve, reject) => {
            dest.on("finish", () => {
                log(`Downloaded ${fileName} to ${filePath}`);
                resolve();
            });
            dest.on("error", (error) => {
                log(`Error downloading ${fileName}: ${error.message}`);
                reject(error);
            });
        });
    } catch (error) {
        log(`Error getting file ${fileName}: ${error.message}`);
        throw error;
    }
}

async function initialUpload(drive, folderId, SYNC_FOLDER) {
    const files = fs.readdirSync(SYNC_FOLDER);
    for (const file of files) {
        const filePath = path.join(SYNC_FOLDER, file);
        if (fs.statSync(filePath).isFile()) {
            await uploadLargeFile(drive, filePath, folderId);
        }
    }
}

async function initialDownload(drive, folderId, SYNC_FOLDER) {
    const response = await drive.files.list({
        q: `'${folderId}' in parents`,
        fields: "files(id, name, modifiedTime)",
    });

    const localFiles = fs.existsSync(SYNC_FOLDER)
        ? new Set(
              fs
                  .readdirSync(SYNC_FOLDER)
                  .filter((file) =>
                      fs.statSync(path.join(SYNC_FOLDER, file)).isFile()
                  )
          )
        : new Set();

    for (const file of response.data.files) {
        const filePath = path.join(SYNC_FOLDER, file.name);

        // Check if the file exists locally
        if (!localFiles.has(file.name)) {
            await downloadLargeFile(drive, file.id, file.name, SYNC_FOLDER);
        } else {
            // Check if the local file is outdated compared to the file in Drive
            const localMTime = fs.statSync(filePath).mtime.toISOString();
            if (new Date(file.modifiedTime) > new Date(localMTime)) {
                log(`Updating ${file.name} as the local version is outdated.`);
                await downloadLargeFile(drive, file.id, file.name, SYNC_FOLDER);
            }
        }
    }
}

async function deleteFile(drive, fileName, folderId) {
    const response = await drive.files.list({
        q: `name='${fileName}' and '${folderId}' in parents`,
        fields: "files(id, name)",
    });

    if (response.data.files.length > 0) {
        await drive.files.deleteFile({ fileId: response.data.files[0].id });
        log(`Deleted ${fileName} from Google Drive.`);
    }
}

// New function to get directory contents
async function getDirectoryContents(folderPath) {
    const items = [];

    async function traverse(currentPath) {
        try {
            const entries = await fsPromises.readdir(currentPath, {
                withFileTypes: true,
            });

            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);
                const stats = await fsPromises.stat(fullPath);
                const relativePath = path.relative(folderPath, fullPath);

                if (entry.isDirectory()) {
                    // Add directory
                    items.push({
                        name: entry.name,
                        fullPath,
                        relativePath,
                        modifiedTime: stats.mtime,
                        isDirectory: true,
                    });
                    // Traverse subdirectory
                    await traverse(fullPath);
                } else if (entry.isFile()) {
                    // Add file
                    items.push({
                        name: entry.name,
                        fullPath,
                        relativePath,
                        modifiedTime: stats.mtime,
                        size: stats.size,
                        isDirectory: false,
                    });
                }
            }
        } catch (error) {
            log(`Error traversing directory ${currentPath}: ${error.message}`);
            throw error;
        }
    }

    await traverse(folderPath);
    return items;
}

// Add this new function to handle directory traversal
async function handleDirectoryEntry(dirHandle, items = [], parentPath = "") {
    try {
        // Verify we have a valid directory handle
        if (!dirHandle || typeof dirHandle.entries !== "function") {
            throw new Error("Invalid directory handle");
        }

        // Use entries() instead of values()
        for await (const [name, handle] of dirHandle.entries()) {
            const entryPath = parentPath ? `${parentPath}/${name}` : name;

            if (handle.kind === "file") {
                try {
                    const file = await handle.getFile();
                    items.push({
                        name,
                        fullPath: entryPath,
                        relativePath: entryPath,
                        modifiedTime: new Date(file.lastModified),
                        size: file.size,
                        isDirectory: false,
                        handle: handle,
                    });
                    log(`Found file: ${name}`);
                } catch (error) {
                    log(`Error processing file ${name}: ${error.message}`);
                }
            } else if (handle.kind === "directory") {
                try {
                    // Add directory to items
                    items.push({
                        name,
                        fullPath: entryPath,
                        relativePath: entryPath,
                        isDirectory: true,
                        handle: handle,
                    });
                    log(`Found directory: ${name}`);
                    // Recursively process subdirectory
                    await handleDirectoryEntry(handle, items, entryPath);
                } catch (error) {
                    log(`Error processing directory ${name}: ${error.message}`);
                }
            }
        }
        return items;
    } catch (error) {
        log(`Error in handleDirectoryEntry: ${error.message}`);
        throw error;
    }
}

export async function startSync(syncFolder) {
    log("Starting sync process");
    if (!syncFolder) {
        throw new Error("No folder selected for syncing");
    }

    const folderPath = path.resolve(syncFolder);
    log(`Using sync folder: ${folderPath}`);

    try {
        const drive = await initializeDrive();

        // Create base folder if it doesn't exist
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }

        // Create or get the root folder in Drive
        const rootFolderId = await createOrGetDriveFolder(drive, {
            name: path.basename(folderPath),
        });
        log(`Created/Found root folder with ID: ${rootFolderId}`);

        // Store folder IDs for quick lookup
        const folderIds = new Map();
        folderIds.set(folderPath, rootFolderId);

        // Initial sync: Create folder structure and upload files
        log("Starting initial folder structure creation and file upload...");
        const items = await getDirectoryContents(folderPath);

        // First pass: Create all folders
        for (const item of items) {
            if (item.isDirectory) {
                try {
                    const parentPath = path.dirname(item.fullPath);
                    const parentId = folderIds.get(parentPath);

                    if (!parentId) {
                        log(`Parent folder ID not found for ${item.fullPath}`);
                        continue;
                    }

                    log(
                        `Creating folder: ${item.name} in parent: ${parentPath}`
                    );
                    const folderId = await createOrGetDriveFolder(
                        drive,
                        { name: item.name },
                        parentId
                    );
                    folderIds.set(item.fullPath, folderId);
                    log(
                        `Created/Found folder ${item.name} with ID: ${folderId}`
                    );
                } catch (error) {
                    log(`Error creating folder ${item.name}: ${error.message}`);
                }
            }
        }

        // Second pass: Upload all files
        for (const item of items) {
            if (!item.isDirectory) {
                try {
                    const parentPath = path.dirname(item.fullPath);
                    const parentId = folderIds.get(parentPath);

                    if (!parentId) {
                        log(
                            `Parent folder ID not found for file ${item.fullPath}`
                        );
                        continue;
                    }

                    log(
                        `Processing file: ${item.name} in folder: ${parentPath}`
                    );
                    await uploadLargeFile(drive, item.fullPath, parentId);
                } catch (error) {
                    log(`Error uploading file ${item.name}: ${error.message}`);
                }
            }
        }

        log("Initial upload completed");

        // Set up watcher for file changes
        if (watcher) {
            await watcher.close();
        }

        watcher = chokidar.watch(folderPath, {
            ignored: /(^|[\/\\])\../, // ignore dotfiles
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 2000,
                pollInterval: 100,
            },
        });

        // Helper function to get or create parent folder ID
        async function getParentFolderId(filePath) {
            const parentPath = path.dirname(filePath);
            let parentId = folderIds.get(parentPath);

            if (!parentId) {
                // Create parent folder structure if it doesn't exist
                const relativePath = path.relative(folderPath, parentPath);
                const pathParts = relativePath.split(path.sep);
                let currentPath = folderPath;
                let currentParentId = rootFolderId;

                for (const part of pathParts) {
                    if (!part) continue;
                    currentPath = path.join(currentPath, part);
                    let folderId = folderIds.get(currentPath);

                    if (!folderId) {
                        folderId = await createOrGetDriveFolder(
                            drive,
                            { name: part },
                            currentParentId
                        );
                        folderIds.set(currentPath, folderId);
                    }
                    currentParentId = folderId;
                }
                parentId = currentParentId;
            }

            return parentId;
        }

        watcher
            .on("addDir", async (dirPath) => {
                try {
                    if (dirPath === folderPath) return; // Skip root folder
                    log(`Directory added: ${dirPath}`);
                    const parentId = await getParentFolderId(dirPath);
                    const folderId = await createOrGetDriveFolder(
                        drive,
                        { name: path.basename(dirPath) },
                        parentId
                    );
                    folderIds.set(dirPath, folderId);
                } catch (error) {
                    log(
                        `Error handling added directory ${dirPath}: ${error.message}`
                    );
                }
            })
            .on("add", async (filePath) => {
                try {
                    log(`File added: ${filePath}`);
                    const parentId = await getParentFolderId(filePath);
                    await uploadLargeFile(drive, filePath, parentId);
                } catch (error) {
                    log(
                        `Error handling added file ${filePath}: ${error.message}`
                    );
                }
            })
            .on("change", async (filePath) => {
                try {
                    log(`File changed: ${filePath}`);
                    const parentId = await getParentFolderId(filePath);
                    await uploadLargeFile(drive, filePath, parentId);
                } catch (error) {
                    log(
                        `Error handling changed file ${filePath}: ${error.message}`
                    );
                }
            })
            .on("unlink", async (filePath) => {
                try {
                    log(`File deleted: ${filePath}`);
                    const parentId = await getParentFolderId(filePath);
                    await deleteFile(drive, path.basename(filePath), parentId);
                } catch (error) {
                    log(
                        `Error handling deleted file ${filePath}: ${error.message}`
                    );
                }
            })
            .on("unlinkDir", async (dirPath) => {
                try {
                    log(`Directory deleted: ${dirPath}`);
                    const parentId = await getParentFolderId(dirPath);
                    await deleteFile(drive, path.basename(dirPath), parentId);
                    folderIds.delete(dirPath);
                } catch (error) {
                    log(
                        `Error handling deleted directory ${dirPath}: ${error.message}`
                    );
                }
            });

        // Update sync status
        const statusPath = path.join(process.cwd(), ".sync_status");
        fs.writeFileSync(
            statusPath,
            JSON.stringify({
                isSyncing: true,
                lastSynced: new Date().toISOString(),
                selectedFolder: folderPath,
            })
        );

        log("Sync process started successfully");
    } catch (error) {
        log(`Error during sync process: ${error.message}`);
        throw error;
    }
}

export async function stopSync() {
    log("Stopping sync process");
    if (watcher) {
        await watcher.close();
        watcher = null;
        log("Sync stopped");
    }
}

export async function startPush(dirHandle) {
    log("Starting push sync to Google Drive...");
    if (!dirHandle) {
        throw new Error("No folder selected for syncing");
    }

    try {
        // Verify we have the necessary permissions
        const permission = await dirHandle.requestPermission({ mode: "read" });
        if (permission !== "granted") {
            throw new Error("Permission to read directory was denied");
        }

        log(`Selected folder: ${dirHandle.name}`);

        // Initialize Drive client
        const drive = await initializeDrive();

        // Create root folder in Drive
        const rootFolderId = await createOrGetDriveFolder(drive, dirHandle);
        log(`Created/Found root folder with ID: ${rootFolderId}`);

        // Get all items in the directory
        const items = await handleDirectoryEntry(dirHandle);
        log(`Found ${items.length} total items`);

        // Create a map for folder IDs
        const folderIds = new Map();
        folderIds.set("", rootFolderId); // Root folder

        // First pass: Create folder structure
        log("Creating folder structure...");
        for (const item of items) {
            if (item.isDirectory) {
                try {
                    const parentPath = path.dirname(item.relativePath);
                    const parentId = folderIds.get(parentPath) || rootFolderId;

                    log(
                        `Creating folder: ${item.name} in parent: ${parentPath}`
                    );
                    const folderId = await createOrGetDriveFolder(
                        drive,
                        item.handle,
                        parentId
                    );
                    folderIds.set(item.relativePath, folderId);
                    log(`Created folder ${item.name} with ID: ${folderId}`);
                } catch (error) {
                    log(`Error creating folder ${item.name}: ${error.message}`);
                }
            }
        }

        // Second pass: Upload files
        log("Uploading files...");
        for (const item of items) {
            if (!item.isDirectory) {
                try {
                    const parentPath = path.dirname(item.relativePath);
                    const parentId = folderIds.get(parentPath) || rootFolderId;

                    log(
                        `Processing file: ${item.name} in folder: ${parentPath}`
                    );

                    // Check if file exists in Drive
                    const existingFile = await drive.files.list({
                        q: `name='${item.name}' and '${parentId}' in parents and trashed=false`,
                        fields: "files(id, modifiedTime)",
                    });

                    const file = await item.handle.getFile();

                    if (existingFile.data.files.length === 0) {
                        log(`Uploading new file: ${item.name}`);
                        await uploadFileFromHandle(drive, file, parentId);
                    } else {
                        const driveFile = existingFile.data.files[0];
                        const driveModified = new Date(driveFile.modifiedTime);
                        const localModified = new Date(file.lastModified);

                        if (localModified > driveModified) {
                            log(`Updating existing file: ${item.name}`);
                            await uploadFileFromHandle(drive, file, parentId);
                        } else {
                            log(`Skipping up-to-date file: ${item.name}`);
                        }
                    }
                } catch (error) {
                    log(`Error processing file ${item.name}: ${error.message}`);
                }
            }
        }

        log("Push sync completed successfully");
    } catch (error) {
        log(`Error during push sync: ${error.message}`);
        throw error;
    }
}

// New function to handle file uploads from FileSystemFileHandle
async function uploadFileFromHandle(drive, file, folderId) {
    const fileMetadata = {
        name: file.name,
        parents: [folderId],
    };

    try {
        const media = {
            mimeType: file.type || "application/octet-stream",
            body: await file.stream(),
        };

        const response = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: "id",
        });

        log(`Uploaded ${file.name} successfully`);
        return response.data.id;
    } catch (error) {
        log(`Error uploading ${file.name}: ${error.message}`);
        throw error;
    }
}

export async function startPull(driveFolderId, localFolderPath) {
    log("Starting pull sync from Google Drive...");
    if (!driveFolderId) {
        throw new Error("No Google Drive folder selected for pulling");
    }
    if (!localFolderPath) {
        throw new Error("No local folder selected for pulling");
    }

    const normalizedPath = localFolderPath.replace(/\//g, path.sep);
    const folderPath = path.resolve(normalizedPath);
    log(`Using local sync folder: ${folderPath}`);

    try {
        const drive = await initializeDrive();

        // Create base folder if it doesn't exist
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }

        // Helper function to recursively fetch and download files
        async function pullFolderContents(folderId, currentPath) {
            // Get all items (files and folders) from the current Drive folder
            const response = await drive.files.list({
                q: `'${folderId}' in parents and trashed = false`,
                fields: "files(id, name, mimeType, modifiedTime, size)",
                pageSize: 1000,
            });

            const items = response.data.files;
            log(`Found ${items.length} items in folder ${currentPath}`);

            // Process each item
            for (const item of items) {
                const itemPath = path.join(currentPath, item.name);

                if (item.mimeType === "application/vnd.google-apps.folder") {
                    // Create local folder
                    if (!fs.existsSync(itemPath)) {
                        fs.mkdirSync(itemPath, { recursive: true });
                        log(`Created folder: ${itemPath}`);
                    }

                    // Recursively process subfolder
                    await pullFolderContents(item.id, itemPath);
                } else {
                    // Handle file
                    const localModifiedTime = fs.existsSync(itemPath)
                        ? fs.statSync(itemPath).mtime
                        : null;
                    const driveModifiedTime = new Date(item.modifiedTime);

                    if (
                        !localModifiedTime ||
                        driveModifiedTime > localModifiedTime
                    ) {
                        log(
                            `Downloading ${item.name} (${formatFileSize(
                                item.size
                            )}) to ${itemPath}`
                        );
                        await downloadLargeFile(
                            drive,
                            item.id,
                            item.name,
                            currentPath
                        );
                    } else {
                        log(`Skipping ${item.name} - local copy is up to date`);
                    }
                }
            }
        }

        // Start pulling from the root folder
        await pullFolderContents(driveFolderId, folderPath);
        log("Pull sync completed successfully");
    } catch (error) {
        log(`Error during pull sync: ${error.message}`);
        throw error;
    }
}

// Helper function for formatting file sizes
function formatFileSize(bytes) {
    if (bytes === undefined) return "Unknown size";
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    if (bytes === 0) return "0 Bytes";
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + " " + sizes[i];
}
