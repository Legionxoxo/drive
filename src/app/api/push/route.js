import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../pages/api/auth/[...nextauth]";
import { google } from "googleapis";
import { Readable } from "stream";

// Helper function to create a readable stream from array buffer
function arrayBufferToStream(buffer) {
    const readable = new Readable();
    readable._read = () => {}; // _read is required
    readable.push(Buffer.from(buffer));
    readable.push(null);
    return readable;
}

// Helper function for logging
function log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
}

export async function POST(request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.accessToken) {
            return NextResponse.json(
                { error: "Not authenticated" },
                { status: 401 }
            );
        }

        const { rootFolder, folders, files, targetFolderId } =
            await request.json();
        log(`Starting push operation to folder ID: ${targetFolderId}`);
        log(`Processing ${folders.length} folders and ${files.length} files`);

        if (!targetFolderId) {
            return NextResponse.json(
                { error: "No target Drive folder ID provided" },
                { status: 400 }
            );
        }

        // Initialize Google Drive client
        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({ access_token: session.accessToken });
        const drive = google.drive({ version: "v3", auth: oauth2Client });

        // Verify target folder exists and is accessible
        try {
            const folderCheck = await drive.files.get({
                fileId: targetFolderId,
                fields: "name,mimeType",
            });
            log(`Target folder verified: ${folderCheck.data.name}`);
        } catch (error) {
            log(`Error accessing target folder: ${error.message}`);
            return NextResponse.json(
                { error: "Cannot access target folder in Drive" },
                { status: 400 }
            );
        }

        // Store folder IDs for quick lookup
        const folderIds = new Map();
        folderIds.set("", targetFolderId);

        // First pass: Create all folders
        log("Creating folder structure...");
        for (const folder of folders) {
            try {
                const parentPath = folder.path
                    .split("/")
                    .slice(0, -1)
                    .join("/");
                const parentId = folderIds.get(parentPath) || targetFolderId;
                log(
                    `Processing folder: ${folder.name} in path: ${folder.path}`
                );

                // Create folder in Drive
                const folderMetadata = {
                    name: folder.name,
                    mimeType: "application/vnd.google-apps.folder",
                    parents: [parentId],
                };

                // Check if folder already exists
                const existingFolder = await drive.files.list({
                    q: `name='${folder.name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
                    fields: "files(id, name)",
                });

                let folderId;
                if (existingFolder.data.files.length > 0) {
                    folderId = existingFolder.data.files[0].id;
                    log(`Using existing folder: ${folder.name} (${folderId})`);
                } else {
                    const response = await drive.files.create({
                        resource: folderMetadata,
                        fields: "id, name",
                    });
                    folderId = response.data.id;
                    log(`Created new folder: ${folder.name} (${folderId})`);
                }

                folderIds.set(folder.path, folderId);
            } catch (error) {
                log(`Error creating folder ${folder.path}: ${error.message}`);
            }
        }

        // Second pass: Upload all files
        log("Uploading files...");
        for (const file of files) {
            try {
                const parentPath = file.path.split("/").slice(0, -1).join("/");
                const parentId = folderIds.get(parentPath) || targetFolderId;
                log(`Processing file: ${file.name} in path: ${file.path}`);

                // Create file metadata
                const fileMetadata = {
                    name: file.name,
                    parents: [parentId],
                };

                // Check if file already exists
                const existingFile = await drive.files.list({
                    q: `name='${file.name}' and '${parentId}' in parents and trashed=false`,
                    fields: "files(id, name)",
                });

                // Create media object with stream
                const media = {
                    mimeType: file.type || "application/octet-stream",
                    body: arrayBufferToStream(file.content),
                };

                if (existingFile.data.files.length > 0) {
                    // Update existing file
                    log(`Updating existing file: ${file.name}`);
                    await drive.files.update({
                        fileId: existingFile.data.files[0].id,
                        media: media,
                        fields: "id, name",
                    });
                    log(`Updated file: ${file.name}`);
                } else {
                    // Create new file
                    log(`Creating new file: ${file.name}`);
                    const created = await drive.files.create({
                        resource: fileMetadata,
                        media: media,
                        fields: "id, name",
                    });
                    log(`Created file: ${file.name} (${created.data.id})`);
                }
            } catch (error) {
                log(`Error processing file ${file.path}: ${error.message}`);
                // Continue with other files even if one fails
            }
        }

        log("Push operation completed successfully");
        return NextResponse.json({
            success: true,
            message: `Successfully processed ${folders.length} folders and ${files.length} files`,
        });
    } catch (error) {
        log(`Error in push operation: ${error.message}`);
        return NextResponse.json(
            { error: error.message || "Failed to push files" },
            { status: 500 }
        );
    }
}
