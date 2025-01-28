import { NextResponse } from "next/server";
import { authConfig } from "../../../../config/auth";

export async function POST(request) {
    try {
        const body = await request.json();
        const { session_id } = body;

        if (!session_id) {
            return NextResponse.json(
                { error: "Session ID is required", success: false },
                { status: 400 }
            );
        }

        console.log("Fetching Google tokens for session:", session_id);

        // Ensure URL is properly constructed
        const baseUrl = authConfig.baseUrl.endsWith("/")
            ? authConfig.baseUrl.slice(0, -1)
            : authConfig.baseUrl;

        const endpoint = authConfig.endpoints.tokens.startsWith("/")
            ? authConfig.endpoints.tokens
            : "/" + authConfig.endpoints.tokens;

        const tokenUrl = `${baseUrl}${endpoint}`;
        console.log("Making token request to:", tokenUrl);

        const response = await fetch(tokenUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify({
                session_id: session_id,
            }),
        });

        // Log response details
        console.log("Token response status:", response.status);
        console.log(
            "Token response headers:",
            Object.fromEntries(response.headers.entries())
        );

        // Get the raw response text first
        const rawText = await response.text();
        console.log("Raw token response:", rawText);

        // If we got HTML instead of JSON, return a clear error
        if (rawText.trim().startsWith("<!DOCTYPE")) {
            return NextResponse.json(
                {
                    error: "Invalid auth service response",
                    details:
                        "Received HTML instead of JSON. The auth service endpoint might be incorrect.",
                    url: tokenUrl,
                    status: response.status,
                    success: false,
                },
                { status: 502 }
            );
        }

        let data;
        try {
            data = JSON.parse(rawText);
        } catch (parseError) {
            console.error("Failed to parse token response:", parseError);
            return NextResponse.json(
                {
                    error: "Invalid response format",
                    details: "Failed to parse response from auth service",
                    rawResponse: rawText.substring(0, 200), // Only send first 200 chars for safety
                    url: tokenUrl,
                    success: false,
                },
                { status: 500 }
            );
        }

        console.log("Parsed token data:", {
            success: data.success,
            error: data.error,
            message: data.message,
            access_token: data.access_token ? "Present" : "Missing",
            refresh_token: data.refresh_token ? "Present" : "Missing",
            expires_in: data.expires_in,
        });

        if (!response.ok) {
            return NextResponse.json(
                {
                    error: "Auth service error",
                    details:
                        data.error || data.message || `HTTP ${response.status}`,
                    status: response.status,
                    url: tokenUrl,
                    success: false,
                },
                { status: response.status }
            );
        }

        if (!data.success) {
            return NextResponse.json(
                {
                    error: "Failed to get tokens",
                    details: data.error || data.message || "Unknown error",
                    url: tokenUrl,
                    success: false,
                },
                { status: 400 }
            );
        }

        // Return the tokens
        return NextResponse.json({
            success: true,
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_in: data.expires_in || 3600,
        });
    } catch (error) {
        console.error("Error in tokens route:", error);
        return NextResponse.json(
            {
                error: "Failed to get tokens",
                details: error.message,
                success: false,
            },
            { status: 500 }
        );
    }
}
