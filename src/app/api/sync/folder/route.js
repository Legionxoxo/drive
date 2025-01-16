import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const STATUS_FILE = path.join(process.cwd(), ".sync_status");

export async function POST(request) {
    try {
        const { folderName, folderContents } = await request.json();

        // Create absolute path
        const absolutePath = path.resolve(folderName);

        // Verify the folder exists and we have access
        if (!fs.existsSync(absolutePath)) {
            return NextResponse.json(
                { error: "Folder not found" },
                { status: 400 }
            );
        }

        try {
            // Test folder access by reading its contents
            const dirContents = fs.readdirSync(absolutePath);
            console.log("Found directory contents:", dirContents);

            // Save the folder path along with other sync status
            const status = fs.existsSync(STATUS_FILE)
                ? JSON.parse(fs.readFileSync(STATUS_FILE, "utf-8"))
                : {};

            const updatedStatus = {
                ...status,
                selectedFolder: absolutePath,
            };

            fs.writeFileSync(STATUS_FILE, JSON.stringify(updatedStatus));

            return NextResponse.json({
                success: true,
                folderPath: absolutePath,
            });
        } catch (error) {
            console.error("Error accessing folder:", error);
            return NextResponse.json(
                { error: "Cannot access folder" },
                { status: 403 }
            );
        }
    } catch (error) {
        console.error("Error in folder selection:", error);
        return NextResponse.json(
            { error: "Failed to save folder path" },
            { status: 500 }
        );
    }
}
