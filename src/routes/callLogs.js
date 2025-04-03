/**
 * @fileoverview Express router for handling call log retrieval requests.
 * Provides an endpoint to fetch call logs stored in Firebase Realtime Database,
 * supporting filtering by Call SID, date range, and pagination.
 * When retrieving multiple logs, the response augments each log entry with
 * `finalTranscript` and `recordingUrl` fields if found for the associated call.
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
import { logErrorToFirebase } from '../utils/firebase.js';

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
 * When fetching multiple logs (not by specific CallSid), each log entry in the response's `logs` array
 * is augmented with `finalTranscript` and `recordingUrl` fields if that information exists
 * anywhere within the logs for that specific CallSid.
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
 * "logs": [
 * {
 * "callSid": "CA...",
 * "logId": "-LogKey...",
 * "timestamp": 1678886400000,
 * "event": "call_initiated",
 * // ... other log data ...
 * "finalTranscript": "Yes I took my meds...", // Added if available for this callSid
 * "recordingUrl": "[https://api.twilio.com/](https://api.twilio.com/)..." // Added if available for this callSid
 * },
 * // ... more log objects
 * ],
 * "totalLogs": number,
 * "totalPages": number,
 * "currentPage": number,
 * "pageSize": number
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
        page,
    } = req.query;
    const pageSize = parseInt(req.query.pageSize, 10) || DEFAULT_PAGE_SIZE;
    const pageNumber = parseInt(page, 10) || 1;
    let startDate, endDate;

    try {
        let query = logsRef;
        let allLogsData = {}; // Raw log data from Firebase { callSid: { logId: logData } }

        // --- Filtering Logic ---

        // 1. Filter by specific CallSid (return immediately if found)
        if (callSid) {
            console.log(`Workspaceing logs for specific CallSid: ${callSid}`);
            const snapshot = await query.child(callSid).once('value');
            const specificCallLogs = snapshot.val();
            if (specificCallLogs) {
                return res.json({ [callSid]: specificCallLogs }); // Return raw logs for specific SID
            } else {
                throw new NotFoundError(
                    `No logs found for CallSid: ${callSid}`
                );
            }
        } else {
            // Fetch all logs if no specific CallSid is given
            console.log('Fetching all call logs for potential filtering...');
            const snapshot = await query.once('value');
            allLogsData = snapshot.val() || {};
        }

        // --- Date Filtering and Data Processing (if fetching all logs) ---
        let filteredCallSids = Object.keys(allLogsData); // Start with all CallSids

        // 2. Filter by Date Range (only if both dates are provided)
        if (startDateStr && endDateStr) {
            console.log(
                `Applying date filter: ${startDateStr} to ${endDateStr}`
            );
            // (Date parsing logic remains the same as before)
            startDate = parseISO(startDateStr);
            endDate = parseISO(endDateStr);
            if (!isValid(startDate) || !isValid(endDate)) {
                const formatString = 'yyyy-MM-dd HH:mm:ss';
                startDate = parse(startDateStr, formatString, new Date());
                endDate = parse(endDateStr, formatString, new Date());
                if (!isValid(startDate) || !isValid(endDate)) {
                    throw new BadRequestError(
                        "Invalid date format. Please use ISO 8601 (e.g., '2023-10-27T10:00:00Z') or 'yyyy-MM-dd HH:mm:ss'."
                    );
                }
            }
            const startTimestamp = startDate.getTime();
            const endTimestamp = endDate.getTime();

            // Filter the CallSids based on whether *any* log within them falls in the range
            // This approach keeps all logs for a call if at least one matches the date range.
            // Alternatively, you could filter individual log entries here.
            filteredCallSids = filteredCallSids.filter(sidKey => {
                const callLogs = allLogsData[sidKey];
                for (const logId in callLogs) {
                    const log = callLogs[logId];
                    if (log.timestamp) {
                        const logTime = firebaseTimestampToDate(
                            log.timestamp
                        ).getTime();
                        if (
                            logTime >= startTimestamp &&
                            logTime <= endTimestamp
                        ) {
                            return true; // Keep this CallSid if any log matches
                        }
                    }
                }
                return false; // Discard this CallSid if no logs match
            });
            console.log(
                `CallSids remaining after date filter: ${filteredCallSids.length}`
            );
        }

        // 3. Process Logs: Extract summary info and flatten
        let processedLogsWithSummary = {}; // { callSid: { logs: {...}, finalTranscript: '...', recordingUrl: '...' } }

        // Iterate only through the filtered CallSids
        for (const sidKey of filteredCallSids) {
            const originalLogs = allLogsData[sidKey];
            if (!originalLogs) continue; // Should not happen if filtering worked, but safety check

            processedLogsWithSummary[sidKey] = {
                logs: originalLogs,
                finalTranscript: null,
                recordingUrl: null,
            };

            // Find the latest transcript and recording URL for this call
            let latestTranscriptTime = 0;
            let latestRecordingTime = 0;

            for (const logId in originalLogs) {
                const log = originalLogs[logId];
                const logTime = log.timestamp || 0;

                if (
                    log.event === 'deepgram_transcript_final' &&
                    log.transcript &&
                    logTime >= latestTranscriptTime
                ) {
                    processedLogsWithSummary[sidKey].finalTranscript =
                        log.transcript;
                    latestTranscriptTime = logTime;
                }
                if (
                    log.event === 'recording_handled' &&
                    log.recordingUrl &&
                    logTime >= latestRecordingTime
                ) {
                    processedLogsWithSummary[sidKey].recordingUrl =
                        log.recordingUrl;
                    latestRecordingTime = logTime;
                }
            }
        }

        // Flatten into a single array for sorting and pagination, adding summary fields
        const allFilteredLogsArray = Object.entries(
            processedLogsWithSummary
        ).flatMap(([callSidKey, callData]) =>
            Object.entries(callData.logs).map(([logId, log]) => ({
                callSid: callSidKey,
                logId: logId,
                finalTranscript: callData.finalTranscript, // Add summary field
                recordingUrl: callData.recordingUrl, // Add summary field
                ...log,
            }))
        );

        // --- Sorting and Pagination Logic ---

        // Sort logs by timestamp (descending - newest first)
        allFilteredLogsArray.sort(
            (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
        );

        // Calculate pagination indices
        const totalLogs = allFilteredLogsArray.length;
        const totalPages = Math.ceil(totalLogs / pageSize);
        // Ensure pageNumber is within valid range
        const currentPage = Math.max(1, Math.min(pageNumber, totalPages || 1));
        const startIndex = (currentPage - 1) * pageSize;
        const endIndex = Math.min(startIndex + pageSize, totalLogs);

        // Slice the array to get logs for the requested page
        const paginatedLogs = allFilteredLogsArray.slice(startIndex, endIndex);

        console.log(
            `Returning page ${currentPage}/${totalPages} with ${paginatedLogs.length} logs (pageSize: ${pageSize}, total matching: ${totalLogs})`
        );

        // --- Response ---
        return res.json({
            logs: paginatedLogs,
            totalLogs,
            totalPages,
            currentPage: currentPage, // Return the potentially adjusted current page
            pageSize,
        });
    } catch (error) {
        console.error('Error fetching call logs:', error);
        // Error handling remains the same as before
        if (
            error instanceof BadRequestError ||
            error instanceof NotFoundError
        ) {
            return res
                .status(error.statusCode)
                .json({ message: error.message });
        } else if (error instanceof FirebaseError) {
            return res.status(500).json({
                message: 'Failed to fetch call logs due to a database error.',
                error: error.message,
            });
        } else {
            await logErrorToFirebase('callLogsRoute', error).catch(logErr => {
                console.error('Failed to log error to Firebase:', logErr);
            });
            return res.status(500).json({
                message:
                    'An unexpected error occurred while fetching call logs.',
            });
        }
    }
});

export default router;
