import { NextResponse } from "next/server";
import { google } from "googleapis";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../../pages/api/auth/[...nextauth]";

export async function GET() {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.accessToken) {
            console.error("No access token found in session");
            return NextResponse.json(
                { error: "Not authenticated" },
                { status: 401 }
            );
        }

        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({ access_token: session.accessToken });

        const drive = google.drive({ version: "v3", auth: oauth2Client });

        // First, get all folders
        const response = await drive.files.list({
            q: "mimeType='application/vnd.google-apps.folder' and trashed=false",
            fields: "files(id, name, parents)",
            pageSize: 1000,
            orderBy: "name",
        });

        console.log("Fetched folders:", response.data.files); // Debug log

        const folders = response.data.files.map((folder) => ({
            id: folder.id,
            name: folder.name,
            parentId: folder.parents ? folder.parents[0] : null,
        }));

        return NextResponse.json({
            folders,
            success: true,
            count: folders.length,
        });
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
