import { getServerSession } from "next-auth/next";
import { authOptions } from "../pages/api/auth/[...nextauth]";
import SyncStatus from "./components/Sync";
import Loginbutton from "./components/Login";

export default async function Home() {
    const session = await getServerSession(authOptions);

    return (
        <main className="flex min-h-screen flex-col items-center justify-center p-24">
            <h1 className="text-4xl font-bold mb-8">Google Drive Sync</h1>
            {session ? <SyncStatus /> : <Loginbutton />}
        </main>
    );
}
