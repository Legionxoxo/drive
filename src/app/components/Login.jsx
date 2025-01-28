"use client";

import { useAuth } from "../hooks/useAuth";

export default function Loginbutton() {
    const { login, isLoading, error } = useAuth();

    return (
        <div className="flex flex-col items-center gap-4">
            <button
                onClick={login}
                disabled={isLoading}
                className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
            >
                {isLoading ? "Signing in..." : "Sign in with AirVault"}
            </button>
            {error && <p className="text-red-500">{error}</p>}
        </div>
    );
}
