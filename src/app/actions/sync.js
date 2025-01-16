"use server";

import { getServerSession } from "next-auth/next";
import { authOptions } from "../../pages/api/auth/[...nextauth]";
import { google } from "googleapis";
import fs from "fs";
import path from "path";
import chokidar from "chokidar";
import dotenv from "dotenv";

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

async function createOrGetDriveFolder(drive, SYNC_FOLDER) {
    const DRIVE_FOLDER_NAME = path.basename(SYNC_FOLDER); // Use the selected folder's name
    const folderMetadata = {
        name: DRIVE_FOLDER_NAME,
        mimeType: "application/vnd.google-apps.folder",
    };

    const response = await drive.files.list({
        q: `name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder'`,
        fields: "files(id, name)",
    });

    if (response.data.files.length > 0) {
        return response.data.files[0].id;
    } else {
        const folder = await drive.files.create({
            resource: folderMetadata,
            fields: "id",
        });
        return folder.data.id;
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

async function downloadLargeFile(drive, fileId, fileName, SYNC_FOLDER) {
    const filePath = path.join(SYNC_FOLDER, fileName);
    const dest = fs.createWriteStream(filePath);

    const response = await drive.files.get(
        { fileId: fileId, alt: "media" },
        { responseType: "stream" }
    );

    response.data.pipe(dest);

    return new Promise((resolve, reject) => {
        dest.on("finish", () => {
            log(`Downloaded ${fileName} from Google Drive.`);
            resolve();
        });
        dest.on("error", reject);
    });
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
        await drive.files.delete({ fileId: response.data.files[0].id });
        log(`Deleted ${fileName} from Google Drive.`);
    }
}

// Add this helper function to recursively get all files
async function getAllFiles(folderPath) {
    const files = [];

    async function scanDirectory(currentPath, relativePath = "") {
        const entries = fs.readdirSync(currentPath);

        for (const entry of entries) {
            const fullPath = path.join(currentPath, entry);
            const entryStats = fs.statSync(fullPath);

            if (entryStats.isDirectory()) {
                await scanDirectory(fullPath, path.join(relativePath, entry));
            } else if (entryStats.isFile()) {
                files.push({
                    fullPath,
                    relativePath: path.join(relativePath, entry),
                    modifiedTime: entryStats.mtime,
                    size: entryStats.size,
                });
            }
        }
    }

    await scanDirectory(folderPath);
    return files;
}

export async function startSync(syncFolder) {
    log("Starting sync process");
    if (!syncFolder) {
        throw new Error("No folder selected for syncing");
    }

    const folderPath = path.resolve(syncFolder);

    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
        throw new Error("Not authenticated");
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: session.accessToken });

    const drive = google.drive({ version: "v3", auth: oauth2Client });

    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath);
    }

    const folderId = await createOrGetDriveFolder(drive, folderPath);
    await initialUpload(drive, folderId, folderPath);
    await initialDownload(drive, folderId, folderPath);

    watcher = chokidar.watch(folderPath, {
        ignored: /(^|[\/\\])\../,
        persistent: true,
    });

    watcher
        .on("add", (filePath) => {
            log(`File added: ${filePath}`);
            uploadLargeFile(drive, filePath, folderId);
        })
        .on("change", (filePath) => {
            log(`File changed: ${filePath}`);
            uploadLargeFile(drive, filePath, folderId);
        })
        .on("unlink", (filePath) => {
            log(`File deleted: ${filePath}`);
            deleteFile(drive, path.basename(filePath), folderId);
        });

    log("Sync process started");
}

export async function stopSync() {
    log("Stopping sync process");
    if (watcher) {
        await watcher.close();
        watcher = null;
        log("Sync stopped");
    }
}

export async function startPush(syncFolder) {
    log("Starting push sync to Google Drive...");
    if (!syncFolder) {
        throw new Error("No folder selected for syncing");
    }

    const folderPath = path.resolve(syncFolder);
    log(`Using sync folder: ${folderPath}`);

    try {
        // Initialize Drive client
        const drive = await initializeDrive();

        // Create or get root folder ID
        const rootFolderId = await createOrGetDriveFolder(drive, folderPath);

        // Get all local files including those in subfolders
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
            log("Created sync folder as it didn't exist");
            return;
        }

        // Get all files recursively
        const localFiles = await getAllFiles(folderPath);
        log(`Found ${localFiles.length} files in total`);

        // Create a map to store folder IDs
        const folderIds = new Map();
        folderIds.set("", rootFolderId); // Root folder

        // Function to ensure folder exists in Drive
        async function ensureFolderExists(relativePath) {
            if (folderIds.has(relativePath)) {
                return folderIds.get(relativePath);
            }

            const parentPath = path.dirname(relativePath);
            const folderName = path.basename(relativePath);
            const parentId = await ensureFolderExists(parentPath);

            // Create folder in Drive
            const folderMetadata = {
                name: folderName,
                mimeType: "application/vnd.google-apps.folder",
                parents: [parentId],
            };

            const folder = await drive.files.create({
                resource: folderMetadata,
                fields: "id",
            });

            folderIds.set(relativePath, folder.data.id);
            return folder.data.id;
        }

        // Get existing files in Drive folder (recursively)
        async function getDriveFiles(folderId) {
            const allFiles = new Map();
            let pageToken = null;

            do {
                const response = await drive.files.list({
                    q: `'${folderId}' in parents and trashed = false`, // Exclude trashed files
                    fields: "nextPageToken, files(id, name, modifiedTime, parents)",
                    pageSize: 1000,
                    pageToken: pageToken,
                });

                for (const file of response.data.files) {
                    const filePath = file.parents
                        ? file.parents.join("/") + "/" + file.name
                        : file.name;
                    allFiles.set(filePath, {
                        id: file.id,
                        modifiedTime: new Date(file.modifiedTime),
                    });
                }

                pageToken = response.data.nextPageToken;
            } while (pageToken);

            return allFiles;
        }

        const driveFiles = await getDriveFiles(rootFolderId);

        // Process each local file
        for (const file of localFiles) {
            try {
                // Ensure parent folder exists in Drive
                const parentPath = path.dirname(file.relativePath);
                const parentId =
                    parentPath === "."
                        ? rootFolderId
                        : await ensureFolderExists(parentPath);

                const fileName = path.basename(file.fullPath);
                const driveFile = driveFiles.get(file.relativePath);

                if (!driveFile || file.modifiedTime > driveFile.modifiedTime) {
                    log(`Uploading ${file.relativePath}`);
                    await uploadLargeFile(drive, file.fullPath, parentId);
                } else {
                    log(
                        `Skipping ${file.relativePath} - Drive copy is up to date`
                    );
                }
            } catch (error) {
                log(`Error processing ${file.relativePath}: ${error.message}`);
            }
        }

        log("Push sync completed successfully");
    } catch (error) {
        log(`Error during push sync: ${error.message}`);
        throw error;
    }
}

export async function startPull(driveFolderId) {
    log("Starting pull sync from Google Drive...");
    if (!driveFolderId) {
        throw new Error("No Google Drive folder selected for pulling");
    }

    const folderPath = path.resolve("local_sync_folder"); // Define your local sync folder path
    log(`Using local sync folder: ${folderPath}`);

    try {
        // Initialize Drive client
        const drive = await initializeDrive();

        // Create sync folder if it doesn't exist
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }

        // Get all files from the selected Drive folder
        const response = await drive.files.list({
            q: `'${driveFolderId}' in parents and trashed = false`,
            fields: "files(id, name, modifiedTime, size)",
            pageSize: 1000,
        });

        const driveFiles = response.data.files;
        log(`Found ${driveFiles.length} files in Google Drive`);

        // Get local files info
        const localFiles = fs.existsSync(folderPath)
            ? fs
                  .readdirSync(folderPath)
                  .filter((file) =>
                      fs.statSync(path.join(folderPath, file)).isFile()
                  )
                  .reduce((acc, file) => {
                      acc[file] = fs.statSync(
                          path.join(folderPath, file)
                      ).mtime;
                      return acc;
                  }, {})
            : {};

        // Process each file from Google Drive
        for (const file of driveFiles) {
            const localPath = path.join(folderPath, file.name);
            const driveModifiedTime = new Date(file.modifiedTime);
            const localModifiedTime = localFiles[file.name]
                ? new Date(localFiles[file.name])
                : null;

            // If the file doesn't exist locally or the Drive file is newer, download it
            if (
                !localFiles[file.name] || // If the file is missing locally
                driveModifiedTime > localModifiedTime // If the file on Drive is newer
            ) {
                log(
                    `Downloading ${file.name} (${formatFileSize(file.size)})...`
                );
                await downloadLargeFile(drive, file.id, file.name, folderPath);
            } else {
                log(`Skipping ${file.name} - local copy is up to date`);
            }
        }

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

// The remaining methods (startPush, startPull, etc.) will follow the same approach, passing SYNC_FOLDER as a parameter where needed.
