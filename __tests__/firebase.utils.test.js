// Import the REAL FirebaseError class first
import FirebaseError from '../src/errors/FirebaseError.js';

// --- Mocks ---

// Define mocks INSIDE jest.mock
jest.mock('firebase-admin', () => {
    const mockPushInternal = jest.fn();
    const mockRefInternal = jest.fn(() => ({ push: mockPushInternal })); // ref() returns object with push()
    const mockDatabaseInternal = jest.fn(() => ({ ref: mockRefInternal })); // database() returns object with ref()

    const mockAdmin = {
        // database property holds the database() function mock
        // It also needs the ServerValue property attached
        database: Object.assign(mockDatabaseInternal, {
            ServerValue: { TIMESTAMP: 'mock_firebase_timestamp' },
        }),
        initializeApp: jest.fn(),
        credential: { cert: jest.fn() },

        // Expose inner mocks needed for assertions
        _mockPush: mockPushInternal, // The push() function mock
        _mockRef: mockRefInternal, // The ref() function mock
        _mockDatabase: mockDatabaseInternal, // The database() function mock
    };
    return mockAdmin;
});

// Import the mocked admin AFTER jest.mock
import admin from 'firebase-admin';

// Retrieve references to inner mocks
const mockPush = admin._mockPush;
const mockRef = admin._mockRef;
const mockDatabase = admin._mockDatabase; // The mock for the database() function itself

// DO NOT mock FirebaseError here anymore
// jest.mock('../src/errors/FirebaseError.js');

// Import the utils under test AFTER mocks are fully set up
import { logToFirebase, logErrorToFirebase } from '../src/utils/firebase.js';

// --- Test Setup ---
describe('Firebase Utilities', () => {
    // --- Console Spies (optional, but good practice) ---
    let consoleLogSpy;
    let consoleErrorSpy;
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

    beforeEach(() => {
        // Reset the calls/state of the mocks we care about
        mockPush.mockClear();
        mockRef.mockClear();
        // We don't clear mockDatabase itself anymore, as its single call during module load is expected
        // jest.clearAllMocks(); // Use this if other general mocks need clearing
    });

    // --- Tests for logToFirebase ---
    describe('logToFirebase', () => {
        const callSid = 'UNIT_TEST_SID_1';
        const logData = { event: 'test_event', detail: 'some data' };

        it('should call db.ref() with correct path', async () => {
            mockPush.mockResolvedValue({ key: 'newLogKey' });
            await logToFirebase(callSid, logData);
            // FIX: Don't check if database() was called again. Check ref() was called.
            // expect(mockDatabase).toHaveBeenCalledTimes(1);
            expect(mockRef).toHaveBeenCalledTimes(1);
            expect(mockRef).toHaveBeenCalledWith(`logs/${callSid}`);
        });

        it('should call push with timestamp and log data', async () => {
            mockPush.mockResolvedValue({ key: 'newLogKey' });
            await logToFirebase(callSid, logData);
            expect(mockPush).toHaveBeenCalledTimes(1);
            // Check ServerValue access via the mock structure
            expect(mockPush).toHaveBeenCalledWith({
                timestamp: 'mock_firebase_timestamp',
                ...logData,
            });
        });

        it('should resolve successfully on successful push', async () => {
            mockPush.mockResolvedValue({ key: 'newLogKey' });
            await expect(
                logToFirebase(callSid, logData)
            ).resolves.toBeUndefined();
        });

        it('should throw the real FirebaseError if push fails', async () => {
            const pushError = new Error('Database push failed');
            mockPush.mockRejectedValue(pushError);
            await expect(logToFirebase(callSid, logData)).rejects.toThrow(
                FirebaseError
            );
            await expect(logToFirebase(callSid, logData)).rejects.toMatchObject(
                {
                    message: 'Error writing to Firebase',
                    statusCode: 500,
                }
            );
        });
    });

    // --- Tests for logErrorToFirebase ---
    describe('logErrorToFirebase', () => {
        const callSidOrContext = 'UNIT_TEST_CONTEXT';
        const testError = new Error('Something went wrong');
        testError.name = 'TestError';
        testError.stack = 'mock stack trace line 1\nline 2';

        it('should call db.ref() with correct error path', async () => {
            mockPush.mockResolvedValue({ key: 'newErrorKey' });
            await logErrorToFirebase(callSidOrContext, testError);
            // FIX: Check ref() call, not database()
            // expect(mockDatabase).toHaveBeenCalledTimes(1);
            expect(mockRef).toHaveBeenCalledTimes(1);
            expect(mockRef).toHaveBeenCalledWith(`errors/${callSidOrContext}`);
        });

        it('should call push with timestamp and error details', async () => {
            mockPush.mockResolvedValue({ key: 'newErrorKey' });
            await logErrorToFirebase(callSidOrContext, testError);
            expect(mockPush).toHaveBeenCalledTimes(1);
            // Check ServerValue access via mock
            expect(mockPush).toHaveBeenCalledWith({
                timestamp: 'mock_firebase_timestamp',
                name: testError.name,
                message: testError.message,
                stack: testError.stack,
            });
        });

        it('should resolve successfully on successful push', async () => {
            mockPush.mockResolvedValue({ key: 'newErrorKey' });
            await expect(
                logErrorToFirebase(callSidOrContext, testError)
            ).resolves.toBeUndefined();
        });

        it('should throw the real FirebaseError if push fails', async () => {
            const pushError = new Error('Database error log push failed');
            mockPush.mockRejectedValue(pushError);
            await expect(
                logErrorToFirebase(callSidOrContext, testError)
            ).rejects.toThrow(FirebaseError);
            await expect(
                logErrorToFirebase(callSidOrContext, testError)
            ).rejects.toMatchObject({
                message: 'Error writing error log to Firebase',
                statusCode: 500,
            });
        });
    });
});
