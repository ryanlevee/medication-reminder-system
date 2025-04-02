jest.setTimeout(15000);
import request from 'supertest';
import express from 'express';
// No direct Twilio usage in this route, but import router

// Mock import.meta for elevenLabsService.js
jest.mock('../src/services/elevenLabsService.js', () => ({
    __esModule: true,
    elevenLabsTextToSpeech: jest
        .fn()
        .mockResolvedValue('path/to/mock/audio.mp3'),
}));

import callsRouter from '../src/routes/calls.js';

// --- Mocks ---

// Mock firebase-admin (copied from previous tests)
jest.mock('firebase-admin', () => {
    const databaseMock = jest.fn(() => ({
        ref: jest.fn(() => ({
            push: jest.fn().mockResolvedValue({ key: 'mockKey' }),
        })),
        ServerValue: { TIMESTAMP: 'mockTimestamp' },
    }));
    databaseMock.ServerValue = { TIMESTAMP: 'mockTimestamp' };
    const credentialMock = {
        cert: jest.fn(() => ({ projectId: 'mock-project-id' })),
    };
    const initializeAppMock = jest.fn(() => ({ database: databaseMock }));
    return {
        initializeApp: initializeAppMock,
        credential: credentialMock,
        database: databaseMock,
    };
});

// Mock local firebase utils
jest.mock('../src/utils/firebase.js', () => ({
    logToFirebase: jest.fn().mockResolvedValue(undefined),
    logErrorToFirebase: jest.fn().mockResolvedValue(undefined),
}));
import { logToFirebase, logErrorToFirebase } from '../src/utils/firebase.js';

// Mock Error classes
const createMockError = (name, defaultMessage, defaultStatusCode) => {
    return class extends Error {
        constructor(message, statusCode, stack) {
            super(message || defaultMessage);
            this.name = name;
            this.statusCode = statusCode || defaultStatusCode;
            this.isOperational = true; // Assuming operational for testing purposes
            this.stack = stack || new Error().stack;
            Object.setPrototypeOf(this, new.target.prototype);
        }
    };
};
// Mock the specific error used by the route
jest.mock('../src/errors/BadRequestError.js', () =>
    createMockError('BadRequestError', 'Bad Request', 400)
);
// Mock InternalServerError for the catch-all block
jest.mock('../src/errors/InternalServerError.js', () =>
    createMockError('InternalServerError', 'Internal Server Error', 500)
);

// --- Test Setup ---

describe('POST /handle-recording', () => {
    let app;

    // --- Console Output Suppression ---
    let consoleLogSpy;
    let consoleErrorSpy;

    beforeEach(() => {
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    // --- App and Mock Setup ---
    beforeEach(() => {
        jest.clearAllMocks(); // Reset mocks

        app = express();
        app.use(express.urlencoded({ extended: true })); // Use urlencoded parser
        app.use(express.json()); // Use json parser as route returns JSON
        app.use('/', callsRouter);
    });

    // --- Tests ---
    const mockCallSid = 'CA_REC_MOCK_SID';
    const mockRecordingSid = 'RE_MOCK_SID_123';
    const mockRecordingUrl = 'https://api.twilio.com/mock/recording/url.mp3';
    const mockRecordingDuration = '15';

    it('should process valid recording data, log to Firebase, and return success JSON', async () => {
        const response = await request(app)
            .post('/handle-recording')
            .type('form')
            .send({
                CallSid: mockCallSid,
                RecordingSid: mockRecordingSid,
                RecordingUrl: mockRecordingUrl,
                RecordingDuration: mockRecordingDuration,
            });

        expect(response.statusCode).toBe(200);
        expect(response.body).toEqual({
            CallSid: mockCallSid,
            RecordingSid: mockRecordingSid,
            message: 'Recording processed.',
        });

        // Verify Firebase logging
        expect(logToFirebase).toHaveBeenCalledWith(mockCallSid, {
            event: 'recording_handled',
            recordingUrl: mockRecordingUrl,
            recordingSid: mockRecordingSid,
            duration: mockRecordingDuration,
            status: 'Recording processed.',
        });
        expect(logErrorToFirebase).not.toHaveBeenCalled();
    });

    it('should return 400 Bad Request if RecordingSid is missing', async () => {
        const response = await request(app)
            .post('/handle-recording')
            .type('form')
            .send({
                CallSid: mockCallSid,
                // RecordingSid: missing
                RecordingUrl: mockRecordingUrl,
                RecordingDuration: mockRecordingDuration,
            });

        expect(response.statusCode).toBe(400); // Expecting BadRequestError status
        expect(response.body.message).toBe('Error processing recording.'); // Message from the thrown BadRequestError

        // Verify nothing was logged
        expect(logToFirebase).not.toHaveBeenCalled();
        // Verify the BadRequestError was logged by the catch block
        expect(logErrorToFirebase).toHaveBeenCalledWith(
            'calls', // Error category
            expect.objectContaining({
                name: 'BadRequestError',
                message: 'Error processing recording.',
                statusCode: 400,
            })
        );
    });

    it('should return 400 Bad Request if RecordingUrl is missing', async () => {
        const response = await request(app)
            .post('/handle-recording')
            .type('form')
            .send({
                CallSid: mockCallSid,
                RecordingSid: mockRecordingSid,
                // RecordingUrl: missing
                RecordingDuration: mockRecordingDuration,
            });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe('Error processing recording.');

        expect(logToFirebase).not.toHaveBeenCalled();
        expect(logErrorToFirebase).toHaveBeenCalledWith(
            'calls',
            expect.objectContaining({
                name: 'BadRequestError',
                statusCode: 400,
            })
        );
    });

    it('should still return success JSON even if Firebase logging fails', async () => {
        // Mock Firebase failure
        const firebaseError = new Error('Firebase write failed');
        logToFirebase.mockRejectedValueOnce(firebaseError);

        const response = await request(app)
            .post('/handle-recording')
            .type('form')
            .send({
                CallSid: mockCallSid,
                RecordingSid: mockRecordingSid,
                RecordingUrl: mockRecordingUrl,
                RecordingDuration: mockRecordingDuration,
            });

        // Should still succeed from the client's perspective
        expect(response.statusCode).toBe(200);
        expect(response.body).toEqual({
            CallSid: mockCallSid,
            RecordingSid: mockRecordingSid,
            message: 'Recording processed.',
        });

        // Verify logging was attempted
        expect(logToFirebase).toHaveBeenCalledTimes(1);
        // Verify the internal Firebase error wasn't logged via logErrorToFirebase
        expect(logErrorToFirebase).not.toHaveBeenCalled();
    });

    it('should return 200 OK even if Firebase logging fails (internal handling)', async () => {
        // Simulate an error during the logToFirebase call
        const firebaseLogError = new Error('Simulated Firebase Log Error');
        logToFirebase.mockImplementationOnce(() => {
            throw firebaseLogError;
        });

        const response = await request(app)
            .post('/handle-recording')
            .type('form')
            .send({
                CallSid: mockCallSid,
                RecordingSid: mockRecordingSid,
                RecordingUrl: mockRecordingUrl,
                RecordingDuration: mockRecordingDuration,
            });

        // EXPECT 200 because the inner catch handles the logging error
        expect(response.statusCode).toBe(200);
        // Should still send the success message
        expect(response.body.message).toBe('Recording processed.');

        // Verify logToFirebase was attempted
        expect(logToFirebase).toHaveBeenCalledTimes(1);

        // Verify the OUTER catch block's logErrorToFirebase was NOT called
        expect(logErrorToFirebase).not.toHaveBeenCalled();

        // Optional: If you want to assert the console message was printed,
        // ensure your consoleErrorSpy is active and use:
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'Error logging recording info to Firebase:',
            firebaseLogError
        );
    });
});
