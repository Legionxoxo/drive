"use client";

import { useState, useEffect } from "react";
import { startPull, startPush, startSync, stopSync } from "../actions/sync";

export default function SyncStatus() {
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastSynced, setLastSynced] = useState(null);

    useEffect(() => {
        const checkSyncStatus = async () => {
            const response = await fetch("/api/sync/status");
            const data = await response.json();
            setIsSyncing(data.isSyncing);
            setLastSynced(data.lastSynced);
        };

        checkSyncStatus();
        const interval = setInterval(checkSyncStatus, 5000);

        return () => clearInterval(interval);
    }, []);

    const handleStartSync = async () => {
        await startSync();
        setIsSyncing(true);
    };

    const handleStopSync = async () => {
        await stopSync();
        setIsSyncing(false);
        console.log("stopped");
    };
    const handleStartPull = async () => {
        await startPull();
        setIsSyncing(false);
    };
    const handleStartPush = async () => {
        await startPush();
        setIsSyncing(false);
    };

    return (
        <div className="flex flex-col items-center">
            <p className="mb-4">
                Status: {isSyncing ? "Syncing" : "Not syncing"}
            </p>
            {lastSynced && (
                <p className="mb-4">
                    Last synced: {new Date(lastSynced).toLocaleString()}
                </p>
            )}
            <button onClick={handleStartSync} className="mb-4">
                start sync
            </button>
            <button onClick={handleStopSync} className="mb-4">
                stop sync
            </button>
            <button onClick={handleStartPush} className="mb-4">
                start Push
            </button>
            <button onClick={handleStartPull} className="mb-4">
                Start Pull
            </button>
        </div>
    );
}
