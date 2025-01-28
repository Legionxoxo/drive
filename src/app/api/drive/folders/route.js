import { NextResponse } from "next/server";
import { google } from "googleapis";
import { authConfig } from "../../../../config/auth";

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

            // Fetch folders
            const driveResponse = await drive.files.list({
                q: "mimeType='application/vnd.google-apps.folder' and trashed=false",
                fields: "files(id, name, parents)",
                pageSize: 1000,
                orderBy: "name",
            });

            const folders = driveResponse.data.files.map((folder) => ({
                id: folder.id,
                name: folder.name,
                parentId: folder.parents ? folder.parents[0] : null,
            }));

            return NextResponse.json({
                folders,
                success: true,
                count: folders.length,
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
