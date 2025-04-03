/**
 * @fileoverview Firebase Admin SDK configuration and initialization.
 * Loads the service account key based on a path specified in environment variables
 * and initializes the Firebase Admin SDK for use throughout the application.
 *
 * @requires dotenv - For loading environment variables from a .env file.
 * @requires firebase-admin - The Firebase Admin SDK.
 * @requires node:fs - Node.js File System module for reading the key file.
 * @requires node:path - Node.js Path module for resolving file paths.
 */

import dotenv from 'dotenv';
import admin from 'firebase-admin';
import fs from 'node:fs'; // Import Node.js file system module
import path from 'node:path'; // Import Node.js path module

// Load environment variables from .env file
dotenv.config();

// --- Load Service Account Key ---

/**
 * Path to the Firebase service account key JSON file.
 * Loaded from the FIREBASE_SERVICE_ACCOUNT_PATH environment variable.
 * @type {string | undefined}
 */
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
let serviceAccount; // Variable to hold the parsed service account object

// Validate that the environment variable is set
if (!serviceAccountPath) {
    console.error(
        'FATAL ERROR: FIREBASE_SERVICE_ACCOUNT_PATH environment variable is not set. Firebase Admin SDK cannot be initialized.'
    );
    process.exit(1);
} else {
    try {
        // Resolve the path relative to the project root (assuming .env is in root)
        // Adjust if your path convention is different.
        const absolutePath = path.resolve(process.cwd(), serviceAccountPath);
        console.log(
            `Attempting to load Firebase service account key from: ${absolutePath}`
        );

        // Read the file synchronously (happens at startup, so sync is acceptable)
        const serviceAccountJson = fs.readFileSync(absolutePath, 'utf8');
        // Parse the JSON file content
        serviceAccount = JSON.parse(serviceAccountJson);
        console.log(
            `Successfully loaded Firebase service account key for project: ${serviceAccount?.project_id}`
        );
    } catch (error) {
        console.error(
            `Failed to read or parse Firebase service account key from path specified in FIREBASE_SERVICE_ACCOUNT_PATH (${serviceAccountPath}):`,
            error
        );
        // Set serviceAccount to null or undefined to prevent initialization attempt below
        serviceAccount = undefined;
        // Optionally exit: process.exit(1);
    }
}

// --- Initialize Firebase Admin SDK ---

// Only attempt initialization if the service account was loaded successfully
if (serviceAccount) {
    try {
        // Validate that the database URL is also set
        if (!process.env.FIREBASE_DATABASE_URL) {
            throw new Error(
                'FIREBASE_DATABASE_URL environment variable is not set.'
            );
        }

        // Initialize the Firebase Admin SDK
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount), // Use the loaded service account object
            databaseURL: process.env.FIREBASE_DATABASE_URL,
        });
        console.log('Firebase Admin SDK initialized successfully.');
    } catch (error) {
        console.error('Failed to initialize Firebase Admin SDK:', error);
        // In a real application, handle this failure appropriately (e.g., exit, disable features)
        // process.exit(1);
    }
} else {
    console.error(
        'Firebase Admin SDK initialization skipped because the service account key could not be loaded.'
    );
}

/**
 * The initialized Firebase Admin SDK instance.
 * Provides access to Firebase services like Realtime Database, Firestore, Auth, etc.
 * Note: This might be null/partially initialized if setup failed. Check initialization status in dependent modules if needed.
 * @type {admin.app.App}
 */
export { admin };
