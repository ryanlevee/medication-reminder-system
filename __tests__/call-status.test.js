import request from 'supertest';
import express from 'express';

// Define mocks INSIDE jest.mock
jest.mock('twilio', () => {
    // 1. Define the mock function to control *inside* the factory
    const mockMessagesCreateInternal = jest.fn();

    // 2. Define the instance object *inside*, referencing the internal mock
    const mockTwilioClientInstanceInternal = {
        messages: { create: mockMessagesCreateInternal },
        // Add other client parts if needed
        calls: {
            create: jest.fn().mockResolvedValue({ sid: 'CA_MOCK_SID_IGNORE' }),
        },
    };

    // 3. Define the mock constructor *inside*
    const mockTwilioConstructor = jest.fn(
        () => mockTwilioClientInstanceInternal
    );

    // 4. Attach the internal mock function to the constructor itself
    //    to access it from tests after importing the mocked module.
    mockTwilioConstructor._mockMessagesCreate = mockMessagesCreateInternal;

    // 5. Mock TwiML parts
    const MockVoiceResponse = jest.fn(() => ({
        toString: jest.fn().mockReturnValue('<Response></Response>'),
        say: jest.fn(),
        hangup: jest.fn(),
    }));
    mockTwilioConstructor.twiml = { VoiceResponse: MockVoiceResponse };

    // 6. Return the mock constructor
    return mockTwilioConstructor;
});

// Import the mocked twilio module after jest.mock has run
import twilio from 'twilio';

// 7. Retrieve the reference to the internal mock function via the attached property
const mockMessagesCreate = twilio._mockMessagesCreate;

// Mock firebase-admin
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
            this.stack = stack || new Error().stack;
            Object.setPrototypeOf(this, new.target.prototype);
        }
    };
};
jest.mock('../src/errors/InternalServerError.js', () =>
    createMockError('InternalServerError', 'Internal Server Error', 500)
);
jest.mock('../src/errors/TwilioApiError.js', () =>
    createMockError('TwilioApiError', 'Twilio API Error', 500)
);

// Mock import.meta for elevenLabsService.js
jest.mock('../src/services/elevenLabsService.js', () => ({
    __esModule: true,
    elevenLabsTextToSpeech: jest
        .fn()
        .mockResolvedValue('path/to/mock/audio.mp3'),
}));

// Import the router after all mocks are set up
import callsRouter from '../src/routes/calls.js';

// --- Test Setup ---

describe('POST /call-status', () => {
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
        jest.clearAllMocks(); // Reset mocks for isolation

        app = express();
        app.use(express.urlencoded({ extended: true })); // Use urlencoded parser
        // Apply JSON parser as well, as this route can return JSON
        app.use(express.json());
        app.use('/', callsRouter);
    });

    // --- Tests ---
    const mockCallSid = 'CA_STATUS_MOCK_SID';
    const mockToNumber = '+15551234567';
    const mockFromNumber = process.env.TWILIO_PHONE_NUMBER_PAID; // Use env variable expected by code
    const mockSmsSid = 'SM_MOCK_SID_123';
    const unansweredText =
        "We called to check on your medication but couldn't reach you. Please call us back or take your medications if you haven't done so."; // From calls.js

    it('should send SMS and log when CallStatus is completed and AnsweredBy is unknown', async () => {
        // Mock successful SMS creation
        mockMessagesCreate.mockResolvedValue({
            sid: mockSmsSid,
            body: unansweredText,
        }); // Include body for console log check

        const response = await request(app)
            .post('/call-status')
            .type('form')
            .send({
                CallSid: mockCallSid,
                CallStatus: 'completed',
                AnsweredBy: 'unknown',
                To: mockToNumber,
            });

        expect(response.statusCode).toBe(200);
        expect(response.body).toEqual({
            CallSid: mockCallSid,
            smsSid: mockSmsSid,
            message: 'SMS text sent.',
        });

        // Verify SMS sending
        expect(twilio).toHaveBeenCalledTimes(1); // Verify the client was instantiated
        expect(mockMessagesCreate).toHaveBeenCalledWith({
            body: unansweredText,
            to: mockToNumber,
            from: mockFromNumber,
        });

        // Verify Firebase logging
        expect(logToFirebase).toHaveBeenCalledWith(mockCallSid, {
            event: 'call_status_update',
            status: 'Call status: completed',
            answeredBy: 'unknown',
            to: mockToNumber,
        });
        expect(logErrorToFirebase).not.toHaveBeenCalled();
    });

    it('should return 200 OK without action if CallStatus is not completed', async () => {
        const response = await request(app)
            .post('/call-status')
            .type('form')
            .send({
                CallSid: mockCallSid,
                CallStatus: 'ringing', // Not 'completed'
                AnsweredBy: 'unknown',
                To: mockToNumber,
            });

        expect(response.statusCode).toBe(200);
        expect(response.text).toBe('OK'); // Default OK text for sendStatus(200)
        expect(response.body).toEqual({}); // Body should be empty

        // Verify no SMS or logging occurred
        expect(mockMessagesCreate).not.toHaveBeenCalled();
        expect(logToFirebase).not.toHaveBeenCalled();
        expect(logErrorToFirebase).not.toHaveBeenCalled();
    });

    it('should return 200 OK without action if AnsweredBy is not unknown', async () => {
        const response = await request(app)
            .post('/call-status')
            .type('form')
            .send({
                CallSid: mockCallSid,
                CallStatus: 'completed',
                AnsweredBy: 'human', // Not 'unknown'
                To: mockToNumber,
            });

        expect(response.statusCode).toBe(200);
        expect(response.text).toBe('OK');
        expect(response.body).toEqual({});

        // Verify no SMS or logging occurred
        expect(mockMessagesCreate).not.toHaveBeenCalled();
        expect(logToFirebase).not.toHaveBeenCalled();
        expect(logErrorToFirebase).not.toHaveBeenCalled();
    });

    it('should handle SMS sending failure with 500 error and log error', async () => {
        const smsError = new Error('Twilio SMS Failed');
        smsError.status = 500; // Mimic Twilio error structure if needed
        mockMessagesCreate.mockRejectedValue(smsError); // Make SMS sending fail

        const response = await request(app)
            .post('/call-status')
            .type('form')
            .send({
                CallSid: mockCallSid,
                CallStatus: 'completed',
                AnsweredBy: 'unknown',
                To: mockToNumber,
            });

        expect(response.statusCode).toBe(500);
        expect(response.body.error).toBe('Failed to send SMS.'); // Check error message from route

        // Verify SMS was attempted
        expect(mockMessagesCreate).toHaveBeenCalledTimes(1);

        // Verify Firebase error logging
        expect(logToFirebase).not.toHaveBeenCalled(); // Should fail before logging success
        expect(logErrorToFirebase).toHaveBeenCalledWith(
            'calls', // Error category used in the route
            expect.objectContaining({
                name: 'TwilioApiError', // Error type created in catch block
                message: 'Error sending SMS',
                statusCode: 500,
            })
        );
    });

    it('should still send SMS successfully even if Firebase logging fails', async () => {
        // Mock successful SMS creation
        mockMessagesCreate.mockResolvedValue({
            sid: mockSmsSid,
            body: unansweredText,
        });
        // Mock Firebase logging failure
        const firebaseError = new Error('Firebase write failed');
        logToFirebase.mockRejectedValueOnce(firebaseError);

        const response = await request(app)
            .post('/call-status')
            .type('form')
            .send({
                CallSid: mockCallSid,
                CallStatus: 'completed',
                AnsweredBy: 'unknown',
                To: mockToNumber,
            });

        // Expect the main operation (SMS sending) to succeed
        expect(response.statusCode).toBe(200);
        expect(response.body).toEqual({
            CallSid: mockCallSid,
            smsSid: mockSmsSid,
            message: 'SMS text sent.',
        });

        // Verify SMS was sent
        expect(mockMessagesCreate).toHaveBeenCalledTimes(1);

        // Verify Firebase logging was attempted
        expect(logToFirebase).toHaveBeenCalledTimes(1);
        // Ensure the specific Firebase logging error wasn't logged via logErrorToFirebase
        // (The route catches and console.errors it, but doesn't re-log it via the util)
        expect(logErrorToFirebase).not.toHaveBeenCalled();
    });
});
