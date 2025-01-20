This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

-   [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
-   [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

# sync.js - Google Drive Sync Module

## Overview

This module provides functionality to synchronize files and folders between a local system and Google Drive. It supports bidirectional sync with real-time file watching, checksums for file comparison, and handles large file uploads.

## Key Features

-   Bidirectional synchronization (local ↔ Google Drive)
-   Real-time file watching and automatic sync
-   Checksum-based file comparison to avoid unnecessary uploads
-   Support for large file uploads with progress tracking
-   Folder structure preservation
-   Retry mechanism with exponential backoff
-   Detailed logging with timestamps

## Main Functions

### `startSync(driveFolderId, syncFolder)`

Initiates a bidirectional sync between a local folder and Google Drive folder.

-   Creates folder structure if it doesn't exist
-   Uploads initial files
-   Sets up real-time file watching
-   Handles file changes, additions.
-   On local storage deletions, goes to trash in drive.

### `startPush(dirHandle)`

Pushes local files to Google Drive.

-   Creates folder structure in Drive
-   Uploads files with checksum verification
-   Skips identical files based on checksums

### `startPull(driveFolderId, localFolderPath)`

Downloads files from Google Drive to local system.

-   Creates local folder structure
-   Downloads files with checksum verification
-   Skips identical files based on checksums

### `stopSync()`

Stops the sync process and closes file watchers.

## Helper Functions

### File Operations

-   `uploadLargeFile()`: Handles large file uploads with progress tracking
-   `downloadLargeFile()`: Handles file downloads from Drive
-   `deleteFile()`: Removes files from Drive
-   `calculateFileChecksum()`: Generates MD5 checksums for file comparison

### Directory Operations

-   `createOrGetDriveFolder()`: Creates or retrieves folders in Drive
-   `getDirectoryContents()`: Lists local directory contents
-   `handleDirectoryEntry()`: Processes directory entries recursively

### Utility Functions

-   `initializeDrive()`: Sets up Google Drive API client
-   `retryWithBackoff()`: Implements exponential backoff for failed operations
-   `log()`: Provides formatted logging with timestamps
-   `formatFileSize()`: Converts bytes to human-readable sizes

## Requirements

-   Google Drive API credentials
-   NextAuth.js for authentication
-   Node.js file system access
-   Chokidar for file watching
-   Crypto for checksum calculation
