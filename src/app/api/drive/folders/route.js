import { NextResponse } from "next/server";
import { google } from "googleapis";

export async function GET(request) {
    try {
        // Get tokens from headers
        const accessToken = request.headers.get("Authorization")?.split(" ")[1];
        const refreshToken = request.headers.get("X-Refresh-Token");

        console.log("access token", accessToken);

        if (!accessToken || !refreshToken) {
            return NextResponse.json(
                { error: "Authentication tokens required" },
                { status: 401 }
            );
        }
        // Initialize OAuth2 client
        const oauth2Client = new google.auth.OAuth2();

        // Set credentials
        oauth2Client.setCredentials({
            access_token: accessToken,
            refresh_token: refreshToken,
        });

        try {
            // Create drive client
            const drive = google.drive({ version: "v3", auth: oauth2Client });

            // First, get the 'My Drive' root folder ID
            const rootResponse = await drive.files.get({
                fileId: "root",
                fields: "id",
            });

            const myDriveId = rootResponse.data.id;

            // Fetch all folders in My Drive and their subfolders
            const driveResponse = await drive.files.list({
                q: "mimeType='application/vnd.google-apps.folder' and trashed=false",
                fields: "files(id, name, parents)",
                pageSize: 1000,
                orderBy: "name",
                spaces: "drive",
            });

            // Create a map of all folders
            const folderMap = new Map();
            driveResponse.data.files.forEach((folder) => {
                folderMap.set(folder.id, {
                    id: folder.id,
                    name: folder.name,
                    parentId: folder.parents ? folder.parents[0] : null,
                    children: [],
                });
            });

            // Build the hierarchy starting from My Drive
            const rootFolders = [];
            folderMap.forEach((folder) => {
                // If this folder's parent is in our map, add it as a child
                if (folder.parentId && folderMap.has(folder.parentId)) {
                    folderMap.get(folder.parentId).children.push(folder);
                }
                // If this folder's parent is My Drive, it's a root folder
                else if (folder.parentId === myDriveId) {
                    rootFolders.push(folder);
                }
            });

            // Sort folders alphabetically at each level
            const sortFolders = (folders) => {
                folders.sort((a, b) => a.name.localeCompare(b.name));
                folders.forEach((folder) => {
                    if (folder.children.length > 0) {
                        sortFolders(folder.children);
                    }
                });
            };
            sortFolders(rootFolders);

            return NextResponse.json({
                folders: rootFolders,
                success: true,
                count: rootFolders.length,
            });
        } catch (driveError) {
            console.error("Drive API Error:", driveError);

            if (driveError.code === 401 || driveError.code === 403) {
                return NextResponse.json(
                    {
                        error: "Drive API access denied",
                        details: driveError.message,
                        success: false,
                    },
                    { status: 403 }
                );
            }

            throw driveError;
        }
    } catch (error) {
        console.error("Error in GET /api/drive/folders:", error);
        return NextResponse.json(
            {
                error: "Failed to fetch folders",
                details: error.message,
                success: false,
            },
            { status: 500 }
        );
    }
}
