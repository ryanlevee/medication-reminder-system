import { isValid, parse, parseISO } from 'date-fns';
import express from 'express';
import { admin } from '../config/firebase.js';
import BadRequestError from '../errors/BadRequestError.js';
import FirebaseError from '../errors/FirebaseError.js';
import NotFoundError from '../errors/NotFoundError.js';
import { logErrorToFirebase } from '../utils/firebase.js';

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
                throw new NotFoundError(
                    `No logs found for CallSid: ${callSid}`
                );
            }
        } else {
            const snapshot = await query.once('value');
            allLogsData = snapshot.val() || {};
        }

        let filteredLogs = {};

        if (startDateStr && endDateStr) {
            startDate = parseISO(startDateStr);
            endDate = parseISO(endDateStr);

            if (!isValid(startDate) || !isValid(endDate)) {
                startDate = parse(
                    startDateStr,
                    'yyyy-MM-dd HH:mm:ss',
                    new Date()
                );
                endDate = parse(endDateStr, 'yyyy-MM-dd HH:mm:ss', new Date());

                if (!isValid(startDate) || !isValid(endDate)) {
                    throw new BadRequestError(
                        'Invalid date format. Please use ISO 8601 or YYYY-MM-DD HH:mm:ss.'
                    );
                }
            }
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
                if (Object.keys(filteredLogs[callSidKey]).length === 0) {
                    delete filteredLogs[callSidKey];
                }
            }
        } else {
            filteredLogs = allLogsData;
        }

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
            });
        } else {
            await logErrorToFirebase('callLogs', error);
            return res.status(500).json({
                message: 'Failed to fetch call logs from the database.',
            });
        }
    }
});

export default router;
