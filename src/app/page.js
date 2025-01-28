"use client";

import { useAuth } from "./hooks/useAuth";
import SyncStatus from "./components/Sync";
import Loginbutton from "./components/Login";

export default function Home() {
    const { user } = useAuth();

    return (
        <main className="flex min-h-screen flex-col items-center justify-center p-24">
            <h1 className="text-4xl font-bold mb-8">Google Drive Sync</h1>
            {user ? <SyncStatus /> : <Loginbutton />}
        </main>
    );
}
