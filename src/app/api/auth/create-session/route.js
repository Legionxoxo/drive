import { NextRequest, NextResponse } from "next/server";

export async function POST(request) {
    try {
        // Just get session ID from your API
        const response = await fetch(
            "https://login.myairvault.com/api/v1/session/create",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
            }
        );

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error("Session creation error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
