/**
 * @fileoverview Express router for handling call log retrieval requests.
 * Provides an endpoint to fetch call logs stored in Firebase Realtime Database,
 * supporting filtering by Call SID, date range, and pagination.
 *
 * @requires date-fns - For robust date parsing and validation.
 * @requires express - Web framework for Node.js.
 * @requires ../config/firebase - Firebase Admin SDK instance.
 * @requires ../errors/BadRequestError - Custom error for invalid client requests (e.g., bad dates).
 * @requires ../errors/FirebaseError - Custom error for Firebase database issues.
 * @requires ../errors/NotFoundError - Custom error for when requested resources (logs) are not found.
 * @requires ../utils/firebase - Utility functions for Firebase logging (specifically error logging here).
 */

import { isValid, parse, parseISO } from 'date-fns';
import express from 'express';
import { admin } from '../config/firebase.js';
import BadRequestError from '../errors/BadRequestError.js';
import FirebaseError from '../errors/FirebaseError.js';
import NotFoundError from '../errors/NotFoundError.js';
import { logErrorToFirebase } from '../utils/firebase.js'; // Assuming logErrorToFirebase is used, otherwise remove.

const router = express.Router();
const db = admin.database();
const logsRef = db.ref('logs'); // Reference to the 'logs' node in Firebase RTDB

const DEFAULT_PAGE_SIZE = 100; // Default number of logs per page

/**
 * Converts a Firebase timestamp (number of milliseconds since epoch) to a JavaScript Date object.
 *
 * @param {number} timestamp - The timestamp value from Firebase (milliseconds since epoch).
 * @returns {Date} The corresponding JavaScript Date object.
 */
function firebaseTimestampToDate(timestamp) {
    // Firebase timestamps are typically numbers representing milliseconds since epoch
    return new Date(timestamp);
}

/**
 * @route GET /call-logs
 * @description Retrieves call logs from the Firebase Realtime Database.
 * Allows filtering by Call SID, a date range, and supports pagination.
 * If `callSid` is provided, it returns logs only for that specific call.
 * If `startDate` and `endDate` are provided, it filters logs within that time range (inclusive).
 * Dates can be in ISO 8601 format or 'yyyy-MM-dd HH:mm:ss'.
 * Pagination is controlled by `page` (page number, defaults to 1) and `pageSize` (logs per page, defaults to 100).
 *
 * @param {string} [req.query.callSid] - Optional. The specific Twilio Call SID to filter logs by.
 * @param {string} [req.query.startDate] - Optional. The start date for filtering (ISO 8601 or 'yyyy-MM-dd HH:mm:ss'). Requires endDate.
 * @param {string} [req.query.endDate] - Optional. The end date for filtering (ISO 8601 or 'yyyy-MM-dd HH:mm:ss'). Requires startDate.
 * @param {string|number} [req.query.page] - Optional. The page number for pagination (defaults to 1).
 * @param {string|number} [req.query.pageSize] - Optional. The number of logs per page (defaults to 100).
 *
 * @returns {object} res - Express response object.
 * On success:
 * - If `callSid` is specified and found: Returns JSON `{ [callSid]: callLogsObject }`.
 * - Otherwise: Returns JSON object with pagination info:
 * ```json
 * {
 * "logs": [Array<object>], // Array of log objects for the current page
 * "totalLogs": number,     // Total number of logs matching the filters
 * "totalPages": number,    // Total number of pages
 * "currentPage": number,   // Current page number
 * "pageSize": number       // Number of logs requested per page
 * }
 * ```
 * On error:
 * - 400 Bad Request: If date format is invalid.
 * - 404 Not Found: If `callSid` is specified but no logs are found for it.
 * - 500 Internal Server Error: If there's a Firebase error or other unexpected server error.
 *
 * @throws {BadRequestError} If date formats in query parameters are invalid.
 * @throws {NotFoundError} If logs for a specific `callSid` are requested but not found.
 * @throws {FirebaseError} If there's an issue communicating with Firebase.
 * @throws {InternalServerError} For other unexpected errors during processing.
 */
router.get('/call-logs', async (req, res) => {
    const {
        callSid,
        startDate: startDateStr,
        endDate: endDateStr,
        page, // Page number requested
    } = req.query;
    // Parse pageSize, defaulting if invalid or missing
    const pageSize = parseInt(req.query.pageSize, 10) || DEFAULT_PAGE_SIZE;
    // Parse page number, defaulting if invalid or missing
    const pageNumber = parseInt(page, 10) || 1;
    let startDate, endDate;

    try {
        let query = logsRef; // Start with the base reference to all logs
        let allLogsData = {}; // To hold logs retrieved from Firebase

        // --- Filtering Logic ---

        // 1. Filter by specific CallSid
        if (callSid) {
            console.log(`Workspaceing logs for specific CallSid: ${callSid}`);
            const snapshot = await query.child(callSid).once('value');
            const callLogs = snapshot.val();
            if (callLogs) {
                // If found, return only these logs immediately (pagination doesn't apply here)
                return res.json({ [callSid]: callLogs });
            } else {
                // If CallSid specified but not found, throw 404
                throw new NotFoundError(
                    `No logs found for CallSid: ${callSid}`
                );
            }
        } else {
            // Fetch all logs if no specific CallSid is given
            console.log('Fetching all call logs for potential filtering...');
            const snapshot = await query.once('value');
            allLogsData = snapshot.val() || {}; // Use empty object if no logs exist
        }

        let filteredLogs = {}; // To hold logs after date filtering (if applied)

        // 2. Filter by Date Range (only if both dates are provided)
        if (startDateStr && endDateStr) {
            console.log(
                `Applying date filter: ${startDateStr} to ${endDateStr}`
            );
            // Attempt parsing ISO 8601 first
            startDate = parseISO(startDateStr);
            endDate = parseISO(endDateStr);

            // If ISO parsing fails or results in invalid dates, try 'yyyy-MM-dd HH:mm:ss'
            if (!isValid(startDate) || !isValid(endDate)) {
                console.log(
                    'ISO parsing failed or invalid, trying yyyy-MM-dd HH:mm:ss format...'
                );
                const formatString = 'yyyy-MM-dd HH:mm:ss';
                startDate = parse(startDateStr, formatString, new Date());
                endDate = parse(endDateStr, formatString, new Date());

                // If both parsing attempts fail, throw BadRequestError
                if (!isValid(startDate) || !isValid(endDate)) {
                    throw new BadRequestError(
                        "Invalid date format. Please use ISO 8601 (e.g., '2023-10-27T10:00:00Z') or 'yyyy-MM-dd HH:mm:ss'."
                    );
                }
            }

            const startTimestamp = startDate.getTime();
            const endTimestamp = endDate.getTime();

            // Iterate through all fetched logs and filter by timestamp
            for (const callSidKey in allLogsData) {
                const callLogs = allLogsData[callSidKey]; // Logs for a specific CallSid
                const logsForThisCallSid = {};
                for (const logId in callLogs) {
                    const log = callLogs[logId];
                    // Check if the log has a timestamp and falls within the range
                    if (
                        log.timestamp &&
                        firebaseTimestampToDate(log.timestamp).getTime() >=
                            startTimestamp &&
                        firebaseTimestampToDate(log.timestamp).getTime() <=
                            endTimestamp
                    ) {
                        logsForThisCallSid[logId] = log; // Add log if it matches
                    }
                }
                // Only include CallSids that have matching logs after filtering
                if (Object.keys(logsForThisCallSid).length > 0) {
                    filteredLogs[callSidKey] = logsForThisCallSid;
                }
            }
        } else {
            // No date filter applied, use all fetched logs
            filteredLogs = allLogsData;
        }

        // --- Pagination Logic ---

        // Flatten the filtered logs into a single array for pagination
        // Each element includes the callSid it belongs to
        const allFilteredLogsArray = Object.entries(filteredLogs).flatMap(
            ([callSidKey, callLogs]) =>
                Object.entries(callLogs).map(([logId, log]) => ({
                    callSid: callSidKey,
                    logId: logId, // Include logId for potential use
                    ...log,
                }))
        );

        // Sort logs by timestamp (descending - newest first) before pagination
        // Assuming log.timestamp exists and is a number
        allFilteredLogsArray.sort(
            (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
        );

        // Calculate pagination indices
        const totalLogs = allFilteredLogsArray.length;
        const totalPages = Math.ceil(totalLogs / pageSize);
        const startIndex = (pageNumber - 1) * pageSize;
        // endIndex is exclusive for slice
        const endIndex = Math.min(startIndex + pageSize, totalLogs); // Ensure endIndex doesn't exceed array bounds

        // Slice the array to get logs for the requested page
        const paginatedLogs = allFilteredLogsArray.slice(startIndex, endIndex);

        console.log(
            `Returning page ${pageNumber}/${totalPages} with ${paginatedLogs.length} logs (pageSize: ${pageSize}, total matching: ${totalLogs})`
        );

        // --- Response ---
        return res.json({
            logs: paginatedLogs,
            totalLogs,
            totalPages,
            currentPage: pageNumber,
            pageSize,
        });
    } catch (error) {
        console.error('Error fetching call logs:', error);

        // Handle known operational errors first
        if (
            error instanceof BadRequestError ||
            error instanceof NotFoundError
        ) {
            return res
                .status(error.statusCode)
                .json({ message: error.message });
        } else if (error instanceof FirebaseError) {
            // Handle specific Firebase errors
            return res.status(500).json({
                message: 'Failed to fetch call logs due to a database error.',
                error: error.message, // Optionally include original error message
            });
        } else {
            // Handle unexpected errors
            // Log the detailed error for debugging
            await logErrorToFirebase('callLogsRoute', error).catch(logErr => {
                console.error('Failed to log error to Firebase:', logErr);
            });
            return res.status(500).json({
                message:
                    'An unexpected error occurred while fetching call logs.',
                // Avoid sending detailed stack traces to the client in production
                // error: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    }
});

export default router;
