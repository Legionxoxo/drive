import { NextResponse } from "next/server";
import { headers } from "next/headers";
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

        // Ensure URL is properly constructed
        const baseUrl = authConfig.baseUrl.endsWith("/")
            ? authConfig.baseUrl.slice(0, -1)
            : authConfig.baseUrl;

        const endpoint = authConfig.endpoints.tokens.startsWith("/")
            ? authConfig.endpoints.tokens
            : "/" + authConfig.endpoints.tokens;

        const refreshUrl = `${baseUrl}${endpoint}`;

        console.log("Auth configuration:", {
            baseUrl: authConfig.baseUrl,
            endpoint: authConfig.endpoints.tokens,
            constructedUrl: refreshUrl,
        });

        console.log("Making refresh request to:", refreshUrl);
        console.log("With session ID:", session_id);

        const response = await fetch(refreshUrl, {
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
        console.log("Response status:", response.status);
        console.log(
            "Response headers:",
            Object.fromEntries(response.headers.entries())
        );

        // Log raw response for debugging
        const rawText = await response.text();
        console.log("Raw refresh response:", rawText);

        // If we got HTML instead of JSON, return a clear error
        if (rawText.trim().startsWith("<!DOCTYPE")) {
            return NextResponse.json(
                {
                    error: "Invalid auth service response",
                    details:
                        "Received HTML instead of JSON. The auth service endpoint might be incorrect.",
                    url: refreshUrl,
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
            console.error("Failed to parse refresh response:", parseError);
            return NextResponse.json(
                {
                    error: "Invalid response format",
                    details: "Failed to parse response from auth service",
                    rawResponse: rawText.substring(0, 200), // Only send first 200 chars for safety
                    url: refreshUrl,
                    success: false,
                },
                { status: 500 }
            );
        }

        console.log("Parsed response data:", {
            status: response.status,
            success: data.success,
            error: data.error,
            message: data.message,
            access_token:
                data.access_token || data.google_token ? "Present" : "Missing",
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
                    url: refreshUrl,
                    success: false,
                },
                { status: response.status }
            );
        }

        if (!data.success) {
            return NextResponse.json(
                {
                    error: "Failed to refresh tokens",
                    details: data.error || data.message || "Unknown error",
                    url: refreshUrl,
                    success: false,
                },
                { status: 400 }
            );
        }

        const accessToken = data.access_token || data.google_token;
        if (!accessToken) {
            return NextResponse.json(
                {
                    error: "Invalid token response",
                    details: "No access token received from auth service",
                    success: false,
                },
                { status: 400 }
            );
        }

        // Return the tokens
        return NextResponse.json({
            success: true,
            access_token: accessToken,
            refresh_token: data.refresh_token,
            expires_in: data.expires_in || 3600,
        });
    } catch (error) {
        console.error("Error in refresh route:", error);
        return NextResponse.json(
            {
                error: "Failed to refresh tokens",
                details: error.message,
                success: false,
            },
            { status: 500 }
        );
    }
}
