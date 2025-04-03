/**
 * @fileoverview Utility functions for logging data and errors to Firebase Realtime Database.
 * Provides centralized functions to push general log entries and structured error objects
 * under specific Call SIDs in the database.
 *
 * @requires firebase-admin - Firebase Admin SDK, used here to access the database instance and server timestamp.
 * @requires ../errors/FirebaseError - Custom error class for Firebase-related errors.
 */

import admin from 'firebase-admin'; // Assuming admin is initialized elsewhere (e.g., in src/config/firebase.js)
import FirebaseError from '../errors/FirebaseError.js'; // Ensure path is correct

/**
 * Firebase Realtime Database instance obtained from the initialized Firebase Admin SDK.
 * @type {admin.database.Database}
 */
const db = admin.database();

/**
 * Logs general data associated with a specific Call SID to the Firebase Realtime Database.
 * Each call creates a new unique entry under the `/logs/{callSid}/` path using `push()`.
 * Includes a server-side timestamp for each log entry.
 *
 * @async
 * @function logToFirebase
 * @param {string} callSid - The Call SID to associate the log entry with. Used as a key in the database path.
 * @param {object} logData - The data object to be logged. Should contain serializable data (no undefined values).
 * @returns {Promise<void>} A promise that resolves when the data has been successfully pushed to Firebase, or rejects on error.
 * @throws {FirebaseError} If the database write operation fails.
 */
async function logToFirebase(callSid, logData) {
    // Basic validation
    if (!callSid || typeof callSid !== 'string') {
        console.error('logToFirebase Error: Invalid or missing callSid.');
        // Optionally throw an error or return early
        throw new Error('logToFirebase requires a valid callSid string.');
    }
    if (!logData || typeof logData !== 'object') {
        console.error(
            `logToFirebase Error for ${callSid}: Invalid or missing logData.`
        );
        throw new Error('logToFirebase requires a valid logData object.');
    }

    console.log(`Logging data to Firebase for ${callSid}:`, logData); // Log what's being sent

    try {
        // Get a reference to the specific path under 'logs' for the given Call SID.
        const logsRef = db.ref(`logs/${callSid}`);
        // Use push() to generate a unique key for this log entry and save the data.
        // Include a server-side timestamp for accurate event time ordering.
        await logsRef.push({
            timestamp: admin.database.ServerValue.TIMESTAMP, // Firebase server-generated timestamp
            ...logData, // Spread the provided log data object
        });
        // console.log(`Successfully logged data for ${callSid}.`); // Optional success log
    } catch (error) {
        // Catch errors during the Firebase database operation.
        console.error(
            `Error writing log data to Firebase for ${callSid}:`,
            error
        );
        // Wrap the original error in a custom FirebaseError for consistent error handling.
        throw new FirebaseError(
            `Error writing log to Firebase for ${callSid}: ${error.message}`,
            500, // Assuming 500 for database errors
            error.stack
        );
    }
}

/**
 * Logs structured error information associated with a specific Call SID to the Firebase Realtime Database.
 * Each call creates a new unique entry under the `/errors/{callSid}/` path using `push()`.
 * Includes a server-side timestamp, error name, message, and stack trace.
 *
 * @async
 * @function logErrorToFirebase
 * @param {string} callSid - The Call SID associated with the error, or a general identifier (e.g., 'server_startup'). Used as a key in the database path.
 * @param {Error|BaseError|object} error - The error object to log. Should ideally have `name`, `message`, and `stack` properties.
 * @returns {Promise<void>} A promise that resolves when the error data has been successfully pushed to Firebase, or rejects on error.
 * @throws {FirebaseError} If the database write operation for the error log itself fails.
 */
async function logErrorToFirebase(callSid, error) {
    // Basic validation
    if (!callSid || typeof callSid !== 'string') {
        console.error('logErrorToFirebase Error: Invalid or missing callSid.');
        callSid = 'unknown_sid_error'; // Use a placeholder if invalid
    }
    if (!error || typeof error !== 'object') {
        console.error(
            `logErrorToFirebase Error for ${callSid}: Invalid or missing error object.`
        );
        // Create a placeholder error object if none was provided
        error = new Error(
            'logErrorToFirebase called with invalid error object'
        );
    }

    // Log locally first for immediate visibility
    console.error(
        `Logging error to Firebase for ${callSid}:`,
        error.message || error // Log message or the object itself
    );

    try {
        // Get a reference to the specific path under 'errors' for the given Call SID.
        const errorLogsRef = db.ref(`errors/${callSid}`);
        // Push the structured error data.
        await errorLogsRef.push({
            timestamp: admin.database.ServerValue.TIMESTAMP || null, // Firebase server-generated timestamp
            name: error.name || 'Error', // Error name (e.g., 'TypeError', 'FirebaseError')
            message: error.message || 'Unknown error message', // The error description
            stack: error.stack || 'Stack trace not available', // Full stack trace for debugging
            // Optionally add other properties from custom errors if they exist
            statusCode: error.statusCode || 500,
            isOperational: error.isOperational || null,
        });
        // console.log(`Successfully logged error for ${callSid}.`); // Optional success log
    } catch (firebaseError) {
        // Catch errors during the Firebase write operation *for the error log itself*.
        // This is a critical failure, as error reporting failed.
        console.error(
            `!!! CRITICAL: Error writing error log itself to Firebase for ${callSid}:`,
            firebaseError
        );
        console.error('Original Error that failed to log:', error); // Log the original error that couldn't be logged

        // Throw a new FirebaseError indicating the failure to log the error.
        throw new FirebaseError(
            `CRITICAL: Failed to write error log to Firebase for ${callSid}. DB Error: ${firebaseError.message}`,
            500,
            firebaseError.stack
        );
    }
}

export { logToFirebase, logErrorToFirebase };
