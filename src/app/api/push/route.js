import { NextResponse } from "next/server";
import { google } from "googleapis";
import { Readable } from "stream";

// Helper function to convert array buffer to readable stream
function arrayBufferToStream(buffer) {
    const readable = new Readable();
    readable._read = () => {}; // _read is required
    readable.push(Buffer.from(buffer));
    readable.push(null);
    return readable;
}

function log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
}

export async function POST(request) {
    try {
        const { av_access_token, av_refresh_token } = JSON.parse(
            request.headers.get("x-auth-tokens") || "{}"
        );

        if (!av_access_token) {
            return NextResponse.json(
                { error: "Not authenticated" },
                { status: 401 }
            );
        }

        const { targetFolderId, folders, files } = await request.json();

        if (!targetFolderId) {
            return NextResponse.json(
                { error: "No target Drive folder ID provided" },
                { status: 400 }
            );
        }

        // Initialize Google Drive client
        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({ access_token: av_access_token });
        const drive = google.drive({ version: "v3", auth: oauth2Client });

        // Verify target folder exists
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

        // Upload files
        for (const file of files) {
            try {
                const media = {
                    mimeType: file.type,
                    body: arrayBufferToStream(file.content),
                };

                const fileMetadata = {
                    name: file.name,
                    parents: [targetFolderId],
                };

                await drive.files.create({
                    resource: fileMetadata,
                    media,
                    fields: "id",
                });

                log(`Uploaded file: ${file.name}`);
            } catch (error) {
                log(`Error uploading file: ${file.name} - ${error.message}`);
                return NextResponse.json(
                    { error: `Failed to upload file: ${file.name}` },
                    { status: 500 }
                );
            }
        }

        log("Push operation completed successfully");
        return NextResponse.json({
            success: true,
            message: "Files uploaded successfully",
        });
    } catch (error) {
        log(`Error in push operation: ${error.message}`);
        return NextResponse.json(
            { error: error.message || "Failed to push files" },
            { status: 500 }
        );
    }
}
