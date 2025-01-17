import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
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

export async function POST(request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.accessToken) {
            return NextResponse.json(
                { error: "Not authenticated" },
                { status: 401 }
            );
        }

        const { rootFolder, folders, files } = await request.json();

        // Initialize Drive client
        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({ access_token: session.accessToken });
        const drive = google.drive({ version: "v3", auth: oauth2Client });

        // Create root folder
        const rootFolderMetadata = {
            name: rootFolder,
            mimeType: "application/vnd.google-apps.folder",
        };

        const rootFolderResponse = await drive.files.create({
            resource: rootFolderMetadata,
            fields: "id",
        });

        const rootFolderId = rootFolderResponse.data.id;
        const folderIds = new Map();
        folderIds.set("", rootFolderId);

        // Create all folders
        for (const folder of folders) {
            const parentPath = folder.path.split("/").slice(0, -1).join("/");
            const parentId = folderIds.get(parentPath) || rootFolderId;

            const folderMetadata = {
                name: folder.name,
                mimeType: "application/vnd.google-apps.folder",
                parents: [parentId],
            };

            const response = await drive.files.create({
                resource: folderMetadata,
                fields: "id",
            });

            folderIds.set(folder.path, response.data.id);
        }

        // Upload all files
        for (const file of files) {
            const parentPath = file.path.split("/").slice(0, -1).join("/");
            const parentId = folderIds.get(parentPath) || rootFolderId;

            const fileMetadata = {
                name: file.name,
                parents: [parentId],
            };

            const media = {
                mimeType: file.type || "application/octet-stream",
                body: arrayBufferToStream(file.content),
            };

            await drive.files.create({
                resource: fileMetadata,
                media: media,
                fields: "id",
            });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error in push operation:", error);
        return NextResponse.json(
            { error: error.message || "Failed to push files" },
            { status: 500 }
        );
    }
}
