"use server";

import { getServerSession } from "next-auth/next";
import { authOptions } from "../../pages/api/auth/[...nextauth]";
import { google } from "googleapis";
import fs from "fs";
import path from "path";
import chokidar from "chokidar";
import dotenv from "dotenv";

dotenv.config();

const SYNC_FOLDER =
    process.env.SYNC_FOLDER || path.join(process.cwd(), "sync_folder");
const DRIVE_FOLDER_NAME = path.basename(SYNC_FOLDER);
let watcher = null;

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

async function createOrGetDriveFolder(drive) {
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

async function downloadLargeFile(drive, fileId, fileName) {
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

async function initialUpload(drive, folderId) {
    const files = fs.readdirSync(SYNC_FOLDER);
    for (const file of files) {
        const filePath = path.join(SYNC_FOLDER, file);
        if (fs.statSync(filePath).isFile()) {
            await uploadLargeFile(drive, filePath, folderId);
        }
    }
}

async function initialDownload(drive, folderId) {
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
            await downloadLargeFile(drive, file.id, file.name);
        } else {
            // Check if the local file is outdated compared to the file in Drive
            const localMTime = fs.statSync(filePath).mtime.toISOString();
            if (new Date(file.modifiedTime) > new Date(localMTime)) {
                log(`Updating ${file.name} as the local version is outdated.`);
                await downloadLargeFile(drive, file.id, file.name);
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

export async function startSync() {
    log("Starting sync process");
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
        throw new Error("Not authenticated");
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: session.accessToken });

    const drive = google.drive({ version: "v3", auth: oauth2Client });

    if (!fs.existsSync(SYNC_FOLDER)) {
        fs.mkdirSync(SYNC_FOLDER);
    }

    const folderId = await createOrGetDriveFolder(drive);
    await initialUpload(drive, folderId);
    await initialDownload(drive, folderId);

    watcher = chokidar.watch(SYNC_FOLDER, {
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

export async function startPush() {
    log("Starting push sync to Google Drive...");

    try {
        // Initialize Drive client
        const drive = await initializeDrive();

        // Create or get folder ID
        const folderId = await createOrGetDriveFolder(drive);

        // Get all local files
        if (!fs.existsSync(SYNC_FOLDER)) {
            fs.mkdirSync(SYNC_FOLDER, { recursive: true });
            log("Created sync folder as it didn't exist");
            return;
        }

        const localFiles = fs
            .readdirSync(SYNC_FOLDER)
            .filter((file) =>
                fs.statSync(path.join(SYNC_FOLDER, file)).isFile()
            );

        log(`Found ${localFiles.length} files in local folder`);

        // Get existing files in Drive folder
        const response = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: "files(id, name, modifiedTime)",
            pageSize: 1000,
        });

        const driveFiles = response.data.files.reduce((acc, file) => {
            acc[file.name] = {
                id: file.id,
                modifiedTime: new Date(file.modifiedTime),
            };
            return acc;
        }, {});

        // Process each local file
        for (const fileName of localFiles) {
            const filePath = path.join(SYNC_FOLDER, fileName);
            const localModifiedTime = fs.statSync(filePath).mtime;
            const driveFile = driveFiles[fileName];

            if (!driveFile || localModifiedTime > driveFile.modifiedTime) {
                const fileSize = fs.statSync(filePath).size;
                log(`Uploading ${fileName} (${formatFileSize(fileSize)})...`);
                await uploadLargeFile(drive, filePath, folderId);
            } else {
                log(`Skipping ${fileName} - Drive copy is up to date`);
            }
        }

        log("Push sync completed successfully");
    } catch (error) {
        log(`Error during push sync: ${error.message}`);
        throw error;
    }
}

export async function startPull() {
    log("Starting pull sync from Google Drive...");

    try {
        // Initialize Drive client
        const drive = await initializeDrive();

        // Create or get folder ID
        const folderId = await createOrGetDriveFolder(drive);

        // Create sync folder if it doesn't exist
        if (!fs.existsSync(SYNC_FOLDER)) {
            fs.mkdirSync(SYNC_FOLDER, { recursive: true });
        }

        // Get all files from the Drive folder
        const response = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: "files(id, name, modifiedTime, size)",
            pageSize: 1000,
        });

        const driveFiles = response.data.files;
        log(`Found ${driveFiles.length} files in Google Drive`);
        log(JSON.stringify(driveFiles, null, 2));

        // Get local files info
        const localFiles = fs.existsSync(SYNC_FOLDER)
            ? fs
                  .readdirSync(SYNC_FOLDER)
                  .filter((file) =>
                      fs.statSync(path.join(SYNC_FOLDER, file)).isFile()
                  )
                  .reduce((acc, file) => {
                      acc[file] = fs.statSync(
                          path.join(SYNC_FOLDER, file)
                      ).mtime;
                      return acc;
                  }, {})
            : {};

        // Process each file from Google Drive
        for (const file of driveFiles) {
            const localPath = path.join(SYNC_FOLDER, file.name);
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
                await downloadLargeFile(drive, file.id, file.name);
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

// The existing helper function for file size formatting
function formatFileSize(bytes) {
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    if (bytes === 0) return "0 Byte";
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + " " + sizes[i];
}
