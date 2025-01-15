import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const SYNC_FOLDER =
    process.env.SYNC_FOLDER || path.join(process.cwd(), "sync_folder");
const STATUS_FILE = path.join(SYNC_FOLDER, ".sync_status");

export async function GET() {
    let isSyncing = false;
    let lastSynced = null;

    if (fs.existsSync(STATUS_FILE)) {
        const status = JSON.parse(fs.readFileSync(STATUS_FILE, "utf-8"));
        isSyncing = status.isSyncing;
        lastSynced = status.lastSynced;
    }

    return NextResponse.json({ isSyncing, lastSynced });
}
