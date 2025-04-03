/**
 * @fileoverview Firebase Admin SDK configuration and initialization.
 * This file initializes the Firebase Admin SDK using the service account credentials
 * and database URL specified in the environment variables and private JSON key file.
 * It exports the initialized admin instance for use throughout the application.
 *
 * @requires dotenv - For loading environment variables from a .env file.
 * @requires firebase-admin - The Firebase Admin SDK.
 * @requires ../private/medication-reminder-syst-aa149-firebase-adminsdk-fbsvc-65cf0d6678.json - Firebase service account key.
 */

import dotenv from 'dotenv';
import admin from 'firebase-admin';
// Make sure the path to your service account key is correct.
// It's often recommended to keep sensitive files outside the src directory
// and load the path from environment variables or a config file.
import serviceAccount from '../private/medication-reminder-syst-aa149-firebase-adminsdk-fbsvc-65cf0d6678.json' with { type: 'json' };

// Load environment variables from .env file
dotenv.config();

/**
 * Initializes the Firebase Admin SDK.
 * Reads the service account credentials and database URL to configure the SDK.
 * @throws {Error} If initialization fails (e.g., missing credentials or invalid config).
 */
try {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
    console.log('Firebase Admin SDK initialized successfully.');
} catch (error) {
    console.error('Failed to initialize Firebase Admin SDK:', error);
    // Depending on your application's needs, you might want to exit the process
    // if Firebase initialization fails, as it's likely a critical dependency.
    // process.exit(1);
}

/**
 * The initialized Firebase Admin SDK instance.
 * Provides access to Firebase services like Realtime Database, Firestore, Auth, etc.
 * @type {admin.app.App}
 */
export { admin };
