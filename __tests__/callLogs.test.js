jest.setTimeout(15000);
import request from 'supertest';
import express from 'express';

// --- Mocks ---

// --- Define Controllable Mocks ---
const mockDbRef = {
    child: jest.fn(),
    once: jest.fn(),
};
const mockRefFn = jest.fn(() => mockDbRef);
const mockDatabaseFn = jest.fn(() => ({
    ref: mockRefFn,
}));

// --- Mock config/firebase.js ---
jest.mock('../src/config/firebase.js', () => ({
    admin: {
        database: mockDatabaseFn,
        initializeApp: jest.fn(),
        credential: { cert: jest.fn() },
    },
}));

// --- Mock local firebase utils ---
jest.mock('../src/utils/firebase.js', () => ({
    logToFirebase: jest.fn().mockResolvedValue(undefined),
    logErrorToFirebase: jest.fn().mockResolvedValue(undefined),
}));
// will dynamically import logErrorToFirebase in beforeEach

// --- Mock Error classes ---
const createMockError = (name, defaultMessage, defaultStatusCode) => {
    return class extends Error {
        constructor(message) {
            super(message || defaultMessage);
            this.name = name;
            this.statusCode = defaultStatusCode; // Always assign default
            Error.captureStackTrace(this, this.constructor);
            Object.setPrototypeOf(this, this.constructor.prototype);
        }
    };
};
jest.mock('../src/errors/BadRequestError.js', () =>
    createMockError('BadRequestError', 'Bad Request', 400)
);
jest.mock('../src/errors/NotFoundError.js', () =>
    createMockError('NotFoundError', 'Not Found', 404)
);
jest.mock('../src/errors/FirebaseError.js', () =>
    createMockError('FirebaseError', 'Firebase Error', 500)
);

// --- Mock Data ---
const now = new Date('2025-04-01T12:00:00.000Z').getTime();
const mockFirebaseData = {
    logs: {
        CA_SID_1: {
            logid_1a: { event: 'call_initiated', timestamp: now - 60000 }, // 11:59:00 UTC
            logid_1b: { event: 'call_answered', timestamp: now - 55000 }, // 11:59:05 UTC
            logid_1c: { event: 'recording_handled', timestamp: now - 30000 }, // 11:59:30 UTC
        },
        CA_SID_2: {
            logid_2a: { event: 'call_initiated', timestamp: now - 120000 }, // 11:58:00 UTC
            logid_2b: {
                event: 'call_status_update',
                status: 'completed',
                answeredBy: 'unknown',
                timestamp: now - 90000,
            }, // 11:58:30 UTC
        },
        CA_SID_3: {
            logid_3a: { event: 'call_initiated', timestamp: now - 3600000 }, // 11:00:00 UTC
        },
    },
};

// --- Test Setup ---
describe('GET /call-logs', () => {
    let app;
    let callLogsRouter;
    let logErrorToFirebase;

    // --- Console Spies ---
    let consoleLogSpy, consoleErrorSpy;
    beforeAll(() => {
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
    });
    afterAll(() => {
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    // --- App and Mock Setup ---
    beforeEach(async () => {
        // Reset mocks defined OUTSIDE
        mockDatabaseFn.mockClear();
        mockRefFn.mockClear();
        mockDbRef.child.mockClear();
        mockDbRef.once.mockClear();
        jest.clearAllMocks();

        // Dynamically Import Router and Utils
        const routerModule = await import('../src/routes/callLogs.js');
        callLogsRouter = routerModule.default;
        const utilsModule = await import('../src/utils/firebase.js');
        logErrorToFirebase = utilsModule.logErrorToFirebase;

        // Configure Mock Behavior
        mockDbRef.once.mockImplementation(async eventType => {
            if (eventType === 'value') {
                return { val: () => mockFirebaseData.logs };
            }
            return { val: () => null };
        });
        mockDbRef.child.mockImplementation(callSid => {
            const sidData = mockFirebaseData.logs[callSid] || null;
            return {
                once: jest.fn().mockImplementation(async eventType => {
                    if (eventType === 'value') {
                        return { val: () => sidData };
                    }
                    return { val: () => null };
                }),
            };
        });

        // Setup Express App
        app = express();
        app.use('/', callLogsRouter);
    });

    afterEach(() => {
        // Reset modules ONLY if using jest.doMock
        jest.resetModules();
    });

    // --- Tests ---

    it('should get all logs with default pagination when no query params are provided', async () => {
        const response = await request(app).get('/call-logs');
        expect(response.statusCode).toBe(200);
        expect(mockDatabaseFn).toHaveBeenCalledTimes(1);
        expect(mockRefFn).toHaveBeenCalledWith('logs');
        expect(mockDbRef.once).toHaveBeenCalledWith('value');
        expect(response.body.logs).toHaveLength(6);
    });

    it('should get logs for a specific callSid', async () => {
        const targetSid = 'CA_SID_2';
        const childOnceMock = jest
            .fn()
            .mockResolvedValue({ val: () => mockFirebaseData.logs[targetSid] });
        mockDbRef.child.mockImplementation(sid =>
            sid === targetSid
                ? { once: childOnceMock }
                : { once: jest.fn().mockResolvedValue({ val: () => null }) }
        );
        const response = await request(app).get(
            `/call-logs?callSid=${targetSid}`
        );
        expect(response.statusCode).toBe(200);
        expect(mockDatabaseFn).toHaveBeenCalledTimes(1);
        expect(mockRefFn).toHaveBeenCalledWith('logs');
        expect(mockDbRef.child).toHaveBeenCalledWith(targetSid);
        expect(childOnceMock).toHaveBeenCalledWith('value');
        expect(response.body[targetSid]).toBeDefined();
    });

    it('should return 404 if specific callSid is not found', async () => {
        const targetSid = 'CA_MISSING';
        const childOnceMock = jest.fn().mockResolvedValue({ val: () => null });
        mockDbRef.child.mockImplementation(sid =>
            sid === targetSid
                ? { once: childOnceMock }
                : { once: jest.fn().mockResolvedValue({ val: () => null }) }
        );
        const response = await request(app).get(
            `/call-logs?callSid=${targetSid}`
        );
        expect(response.statusCode).toBe(404);
        expect(mockDatabaseFn).toHaveBeenCalledTimes(1);
        expect(mockRefFn).toHaveBeenCalledWith('logs');
        expect(mockDbRef.child).toHaveBeenCalledWith(targetSid);
        expect(childOnceMock).toHaveBeenCalledWith('value');
        expect(logErrorToFirebase).not.toHaveBeenCalled();
    });

    it('should filter logs by date range (ISO format)', async () => {
        const startDate = new Date(now - 100000).toISOString(); // 11:58:20 UTC
        const endDate = new Date(now - 40000).toISOString(); // 11:59:20 UTC
        mockDbRef.once.mockResolvedValue({ val: () => mockFirebaseData.logs });

        const response = await request(app).get(
            `/call-logs?startDate=${startDate}&endDate=${endDate}`
        );
        expect(response.statusCode).toBe(200);
        expect(mockDatabaseFn).toHaveBeenCalledTimes(1);
        expect(mockRefFn).toHaveBeenCalledWith('logs');
        expect(mockDbRef.once).toHaveBeenCalledWith('value');
        expect(response.body.logs).toHaveLength(3);
    });

    it('should filter logs by date range (using ISO UTC strings)', async () => {
        // Define the range clearly in UTC using ISO 8601 format
        // Test range: 11:58:30 UTC to 11:59:30 UTC
        const startDate = '2025-04-01T11:58:30Z'; // Z denotes UTC
        const endDate = '2025-04-01T11:59:30Z'; // Z denotes UTC
        // Expected logs based on mock data timestamps relative to noon UTC:
        // logid_1a (11:59:00), logid_1b (11:59:05), logid_1c (11:59:30), logid_2b (11:58:30) -> 4 logs

        // Ensure the mock returns all data for filtering
        mockDbRef.once.mockResolvedValue({ val: () => mockFirebaseData.logs });

        // Make the request with the ISO strings
        const response = await request(app).get(
            `/call-logs?startDate=${startDate}&endDate=${endDate}`
        );

        // The route's `parseISO` should handle these correctly first time
        expect(response.statusCode).toBe(200);

        // Check mocks
        expect(mockDatabaseFn).toHaveBeenCalledTimes(1);
        expect(mockRefFn).toHaveBeenCalledWith('logs');
        expect(mockDbRef.once).toHaveBeenCalledWith('value');

        // Check the filtering result
        expect(response.body.logs).toHaveLength(4);
        expect(response.body.totalLogs).toBe(4);
        // Check that the expected events are present
        expect(response.body.logs.map(log => log.event)).toEqual(
            expect.arrayContaining([
                'call_initiated',
                'call_answered',
                'recording_handled',
                'call_status_update',
            ])
        );
        // Optionally, verify timestamps more precisely
        const startMs = new Date(startDate).getTime();
        const endMs = new Date(endDate).getTime();
        response.body.logs.forEach(log => {
            expect(log.timestamp).toBeGreaterThanOrEqual(startMs);
            expect(log.timestamp).toBeLessThanOrEqual(endMs);
        });
    });
    it('should return 400 for invalid date format', async () => {
        mockDbRef.once.mockResolvedValue({ val: () => mockFirebaseData.logs });

        const response = await request(app).get(
            `/call-logs?startDate=invalid-date&endDate=2025-01-01`
        );
        // Check assertion
        expect(response.statusCode).toBe(400);
        expect(mockDatabaseFn).toHaveBeenCalledTimes(1);
        expect(mockRefFn).toHaveBeenCalledWith('logs');
        expect(mockDbRef.once).toHaveBeenCalledWith('value');
        expect(response.body.message).toMatch(/Invalid date format/);
        expect(logErrorToFirebase).not.toHaveBeenCalled();
    });

    it('should handle pagination correctly', async () => {
        mockDbRef.once.mockResolvedValue({ val: () => mockFirebaseData.logs });

        const response = await request(app).get('/call-logs?page=2&pageSize=3');
        expect(response.statusCode).toBe(200);
        expect(mockDatabaseFn).toHaveBeenCalledTimes(1);
        expect(mockRefFn).toHaveBeenCalledWith('logs');
        expect(mockDbRef.once).toHaveBeenCalledWith('value');
        expect(response.body.logs).toHaveLength(3);
    });

    it('should handle Firebase read errors when getting all logs', async () => {
        const dbError = new Error('Firebase unavailable');
        mockDbRef.once.mockRejectedValue(dbError);

        const response = await request(app).get('/call-logs');
        expect(response.statusCode).toBe(500);
        expect(response.body.message).toBe(
            'Failed to fetch call logs from the database.'
        );
        expect(logErrorToFirebase).toHaveBeenCalledWith('callLogs', dbError);
    });

    it('should handle Firebase read errors when getting specific callSid', async () => {
        const dbError = new Error('Permission denied');
        mockDbRef.child.mockImplementation(callSid => {
            return { once: jest.fn().mockRejectedValue(dbError) };
        });

        const response = await request(app).get('/call-logs?callSid=CA_SID_1');
        expect(response.statusCode).toBe(500);
        expect(response.body.message).toBe(
            'Failed to fetch call logs from the database.'
        );
        expect(logErrorToFirebase).toHaveBeenCalledWith('callLogs', dbError);
    });
});
