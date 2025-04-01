// src/routes/callLogs.js
import express from 'express';
import { admin } from '../config/firebase.js'; // Import the initialized admin object
import { parseISO, parse, isValid } from 'date-fns'; // Import parsing functions

const router = express.Router();
const db = admin.database();
const logsRef = db.ref('logs');

const DEFAULT_PAGE_SIZE = 100;

function firebaseTimestampToDate(timestamp) {
    return new Date(timestamp);
}

router.get('/call-logs', async (req, res) => {
    const {
        callSid,
        startDate: startDateStr,
        endDate: endDateStr,
        page,
    } = req.query;
    const pageSize = parseInt(req.query.pageSize) || DEFAULT_PAGE_SIZE;
    const pageNumber = parseInt(page) || 1;

    let startDate, endDate;

    try {
        let query = logsRef;
        let allLogsData = {};

        if (callSid) {
            const snapshot = await query.child(callSid).once('value');
            const callLogs = snapshot.val();
            if (callLogs) {
                return res.json({ [callSid]: callLogs });
            } else {
                return res
                    .status(404)
                    .json({ message: `No logs found for CallSid: ${callSid}` });
            }
        } else {
            const snapshot = await query.once('value');
            allLogsData = snapshot.val() || {};
        }

        let filteredLogs = {};

        if (startDateStr && endDateStr) {
            // Try parsing with ISO 8601 first
            startDate = parseISO(startDateStr);
            endDate = parseISO(endDateStr);

            if (!isValid(startDate) || !isValid(endDate)) {
                // If ISO parsing fails, try a more common format (adjust as needed)
                startDate = parse(
                    startDateStr,
                    'yyyy-MM-dd HH:mm:ss',
                    new Date()
                );
                endDate = parse(endDateStr, 'yyyy-MM-dd HH:mm:ss', new Date());

                if (!isValid(startDate) || !isValid(endDate)) {
                    return res
                        .status(400)
                        .json({
                            message:
                                'Invalid date format. Please use YYYY-MM-DD HH:mm:ss or a similar format.',
                        });
                }
            }
            // Now 'startDate' and 'endDate' are JavaScript Date objects
            const start = startDate.getTime();
            const end = endDate.getTime();

            for (const callSidKey in allLogsData) {
                const callLogs = allLogsData[callSidKey];
                filteredLogs[callSidKey] = {};
                for (const logId in callLogs) {
                    const log = callLogs[logId];
                    if (
                        log.timestamp &&
                        firebaseTimestampToDate(log.timestamp).getTime() >=
                            start &&
                        firebaseTimestampToDate(log.timestamp).getTime() <= end
                    ) {
                        filteredLogs[callSidKey][logId] = log;
                    }
                }
                // Remove empty CallSid entries if no logs fall within the date range
                if (Object.keys(filteredLogs[callSidKey]).length === 0) {
                    delete filteredLogs[callSidKey];
                }
            }
        } else {
            filteredLogs = allLogsData;
        }

        // Pagination for all logs or date-filtered logs
        const allFilteredLogsArray = Object.entries(filteredLogs).flatMap(
            ([callSidKey, callLogs]) =>
                Object.values(callLogs).map(log => ({
                    callSid: callSidKey,
                    ...log,
                }))
        );

        const startIndex = (pageNumber - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const paginatedLogs = allFilteredLogsArray.slice(startIndex, endIndex);

        const totalLogs = allFilteredLogsArray.length;
        const totalPages = Math.ceil(totalLogs / pageSize);

        return res.json({
            logs: paginatedLogs,
            totalLogs,
            totalPages,
            currentPage: pageNumber,
            pageSize,
        });
    } catch (error) {
        console.error('Error fetching call logs:', error);
        return res.status(500).json({ message: 'Failed to fetch call logs' });
    }
});

export default router;
