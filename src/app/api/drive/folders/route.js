import { NextResponse } from "next/server";
import { google } from "googleapis";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]/route";

export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.accessToken) {
            return NextResponse.json(
                { error: "Not authenticated" },
                { status: 401 }
            );
        }

        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({ access_token: session.accessToken });

        const drive = google.drive({ version: "v3", auth: oauth2Client });

        // List all folders, including those in root and shared folders
        const response = await drive.files.list({
            q: "mimeType='application/vnd.google-apps.folder' and trashed=false",
            fields: "nextPageToken, files(id, name, parents)",
            pageSize: 1000,
            orderBy: "name",
        });

        const folders = response.data.files.map((file) => ({
            id: file.id,
            name: file.name,
            parentId: file.parents ? file.parents[0] : null,
        }));

        return NextResponse.json({
            folders,
            success: true,
        });
    } catch (error) {
        console.error("Error fetching folders:", error);
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
