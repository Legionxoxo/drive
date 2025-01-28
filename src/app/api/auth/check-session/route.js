import { NextRequest, NextResponse } from "next/server";
import { authConfig } from "../../../../config/auth";

export async function POST(request) {
    try {
        const { session_id } = await request.json();

        if (!session_id) {
            return NextResponse.json(
                { error: "Session ID is required" },
                { status: 400 }
            );
        }

        const response = await fetch(`${authConfig.baseUrl}/session/get`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                session_id,
                client_id: authConfig.clientId,
                client_secret: authConfig.clientSecret,
            }),
        });

        const data = await response.json();

        if (data.authenticated && data.user_details) {
            // Add tokens to user details
            return NextResponse.json({
                authenticated: true,
                user_details: {
                    ...data.user_details,
                    access_token: data.access_token,
                    refresh_token: data.refresh_token,
                },
            });
        }

        return NextResponse.json(data);
    } catch (error) {
        console.error("Session check error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
