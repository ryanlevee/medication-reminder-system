/*
file: __tests__/handle-speech.test.js
*/
import request from 'supertest';
import express from 'express';
import twilio from 'twilio'; // Import the mocked version

// --- Mocks ---

// Mock Twilio TwiML generation (similar to answered.test.js)
let mockTwimlInstance;
const mockSay = jest.fn();
const mockHangup = jest.fn();
const mockToString = jest.fn();

jest.mock('twilio', () => {
    const MockVoiceResponse = jest.fn(() => {
        mockTwimlInstance = {
            say: mockSay,
            hangup: mockHangup,
            toString: mockToString,
        };
        return mockTwimlInstance;
    });

    // Mock the top-level client constructor (not directly used by /handle-speech but good practice)
    const mockTwilioClient = jest.fn(() => ({}));

    // Attach the twiml namespace and VoiceResponse class mock
    mockTwilioClient.twiml = {
        VoiceResponse: MockVoiceResponse,
    };

    return mockTwilioClient;
});

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

// Mock Error classes (needed for error logging tests)
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

// Mock import.meta for elevenLabsService.js
jest.mock('../src/services/elevenLabsService.js', () => ({
    __esModule: true,
    elevenLabsTextToSpeech: jest
        .fn()
        .mockResolvedValue('path/to/mock/audio.mp3'),
}));

// Import the router *after* all mocks are set up
import callsRouter from '../src/routes/calls.js';

// --- Test Setup ---

describe('POST /handle-speech', () => {
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

        // Default TwiML response for tests that don't specify one
        mockToString.mockReturnValue('<Response>DefaultMockTwiml</Response>');

        app = express();
        app.use(express.urlencoded({ extended: true })); // Use urlencoded parser
        app.use('/', callsRouter);
    });

    // --- Tests ---
    const mockCallSid = 'CA_SPEECH_MOCK_SID'; // Consistent SID for related logs

    it('should handle valid SpeechResult with thank you message and hangup', async () => {
        const speechResult = 'Yes I have taken my medications';
        const expectedTwiml =
            '<Response><Say>Thank you. Goodbye.</Say><Hangup/></Response>';
        mockToString.mockReturnValue(expectedTwiml);

        const response = await request(app)
            .post('/handle-speech')
            .type('form')
            .send({ CallSid: mockCallSid, SpeechResult: speechResult });

        expect(response.statusCode).toBe(200);
        expect(response.header['content-type']).toMatch(/text\/xml/);
        expect(response.text).toBe(expectedTwiml);

        // Verify TwiML generation
        expect(mockSay).toHaveBeenCalledWith('Thank you. Goodbye.');
        expect(mockHangup).toHaveBeenCalledTimes(1);

        // Verify no error logging occurred
        expect(logErrorToFirebase).not.toHaveBeenCalled();
        // Note: This route doesn't explicitly log successful speech handling to Firebase
        expect(logToFirebase).not.toHaveBeenCalled();
    });

    it('should handle missing SpeechResult with retry message and hangup', async () => {
        const expectedTwiml =
            '<Response><Say>No speech detected. Please try again.</Say><Hangup/></Response>';
        mockToString.mockReturnValue(expectedTwiml);

        const response = await request(app)
            .post('/handle-speech')
            .type('form')
            // Sending without SpeechResult
            .send({ CallSid: mockCallSid });

        expect(response.statusCode).toBe(200);
        expect(response.header['content-type']).toMatch(/text\/xml/);
        expect(response.text).toBe(expectedTwiml);

        // Verify TwiML generation
        expect(mockSay).toHaveBeenCalledWith(
            'No speech detected. Please try again.'
        );
        expect(mockHangup).toHaveBeenCalledTimes(1);

        // Verify no error logging occurred
        expect(logErrorToFirebase).not.toHaveBeenCalled();
        expect(logToFirebase).not.toHaveBeenCalled();
    });

    it('should handle internal errors during TwiML generation gracefully', async () => {
        const speechResult = 'Some speech';
        const error = new Error('TwiML generation failed');
        // Make one of the TwiML methods throw an error
        mockSay.mockImplementationOnce(() => {
            throw error;
        });

        const response = await request(app)
            .post('/handle-speech')
            .type('form')
            .send({ CallSid: mockCallSid, SpeechResult: speechResult });

        // Expect a 500 error response
        expect(response.statusCode).toBe(500);
        expect(response.body.message).toBe('Error processing speech input.');

        // Verify error was logged to Firebase
        expect(logErrorToFirebase).toHaveBeenCalledWith(
            'calls', // Error category used in the route
            expect.objectContaining({
                name: 'InternalServerError', // Error type created in the catch block
                message: 'Error processing speech input.',
                statusCode: 500,
            })
        );
        // Verify TwiML response wasn't sent
        expect(mockToString).not.toHaveBeenCalled();
    });
});
