import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const STATUS_FILE = path.join(process.cwd(), ".sync_status");

export async function GET() {
    let isSyncing = false;
    let lastSynced = null;
    let selectedFolder = null;

    if (fs.existsSync(STATUS_FILE)) {
        const status = JSON.parse(fs.readFileSync(STATUS_FILE, "utf-8"));
        isSyncing = status.isSyncing;
        lastSynced = status.lastSynced;
        selectedFolder = status.selectedFolder;
    }

    return NextResponse.json({ isSyncing, lastSynced, selectedFolder });
}
