import request from 'supertest';
import express from 'express';
import twilio from 'twilio';

// --- Mocks ---

// Mock Twilio TwiML generation
let mockTwimlInstance;
const mockParameter = jest.fn();
const mockStream = jest.fn(() => ({ parameter: mockParameter }));
const mockStart = jest.fn(() => ({ stream: mockStream }));
const mockPlay = jest.fn();
const mockGatherPlay = jest.fn(); // Separate mock for gather.play
const mockGather = jest.fn(() => ({ play: mockGatherPlay }));
const mockToString = jest.fn();

jest.mock('twilio', () => {
    const MockVoiceResponse = jest.fn(() => {
        mockTwimlInstance = {
            start: mockStart,
            play: mockPlay,
            gather: mockGather,
            toString: mockToString,
            // Mock other methods if needed by other routes potentially using this mock setup
            hangup: jest.fn(),
            say: jest.fn(),
        };
        return mockTwimlInstance;
    });

    const mockTwilioClient = jest.fn(() => ({})); // Mock constructor if needed elsewhere

    mockTwilioClient.twiml = {
        VoiceResponse: MockVoiceResponse,
    };

    return mockTwilioClient;
});

// Mock firebase-admin (only needed because utils/firebase uses it indirectly)
jest.mock('firebase-admin', () => ({
    initializeApp: jest.fn(),
    credential: { cert: jest.fn() },
    database: jest.fn(() => ({
        ref: jest.fn().mockReturnThis(), // Allow chaining like ref().push()
        push: jest.fn().mockResolvedValue({ key: 'mockKey' }),
        ServerValue: { TIMESTAMP: 'mockTimestamp' },
    })),
}));

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

// Import the router *after* all mocks are set up
import incomingCallsRouter from '../src/routes/incomingCalls.js';

// --- Test Setup ---

describe('POST /incoming-call', () => {
    let app;
    const mockHost = 'mock-ngrok-domain.io'; // Mock host header for wss URL

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

        // Set a default mock return value for TwiML toString
        mockToString.mockReturnValue('<Response>DefaultMockTwiml</Response>');

        app = express();
        app.use(express.urlencoded({ extended: true })); // Use urlencoded parser
        app.use('/', incomingCallsRouter); // Mount the specific router
    });

    // --- Tests ---
    const mockCallSid = 'CA_INCOMING_MOCK_SID';
    const mockFromNumber = '+15559876543';
    const mockToNumber = '+15551234567';

    it('should handle incoming call, generate correct TwiML, and log to Firebase', async () => {
        const expectedTwiml = `<Response><Start><Stream url="wss://${mockHost}/live"><Parameter name="CallSid" value="${mockCallSid}"/></Stream></Start><Play>${process.env.NGROK_URL}/reminder.mpeg</Play><Gather input="speech" speechTimeout="2" maxSpeechTime="12" action="/handle-speech"><Play>${process.env.NGROK_URL}/beep.mpeg</Play></Gather></Response>`;
        mockToString.mockReturnValue(expectedTwiml); // Set specific expected TwiML

        const response = await request(app)
            .post('/incoming-call')
            .set('Host', mockHost) // Set host header
            .type('form')
            .send({
                CallSid: mockCallSid,
                From: mockFromNumber,
                To: mockToNumber,
            });

        expect(response.statusCode).toBe(200);
        expect(response.header['content-type']).toMatch(/text\/xml/);
        expect(response.text).toBe(expectedTwiml);

        // Verify TwiML methods were called correctly
        expect(mockStart).toHaveBeenCalledTimes(1);
        expect(mockStream).toHaveBeenCalledWith({
            url: `wss://${mockHost}/live`,
        });
        expect(mockParameter).toHaveBeenCalledWith({
            name: 'CallSid',
            value: mockCallSid,
        });
        expect(mockPlay).toHaveBeenCalledWith(
            `${process.env.NGROK_URL}/reminder.mpeg`
        );
        expect(mockGather).toHaveBeenCalledWith({
            input: 'speech',
            speechTimeout: 2,
            maxSpeechTime: 12,
            action: '/handle-speech',
        });
        expect(mockGatherPlay).toHaveBeenCalledWith(
            `${process.env.NGROK_URL}/beep.mpeg`
        );

        // Verify Firebase logging
        expect(logToFirebase).toHaveBeenCalledWith(mockCallSid, {
            event: 'call_incoming',
            status: 'Incoming call.',
            from: mockFromNumber,
            to: mockToNumber,
        });
        expect(logErrorToFirebase).not.toHaveBeenCalled();
    });

    it('should still send TwiML response even if Firebase logging fails', async () => {
        const expectedTwiml = `<Response><Start><Stream url="wss://${mockHost}/live"><Parameter name="CallSid" value="${mockCallSid}"/></Stream></Start><Play>${process.env.NGROK_URL}/reminder.mpeg</Play><Gather input="speech" speechTimeout="2" maxSpeechTime="12" action="/handle-speech"><Play>${process.env.NGROK_URL}/beep.mpeg</Play></Gather></Response>`;
        mockToString.mockReturnValue(expectedTwiml); // Set specific expected TwiML

        // Make logToFirebase fail
        const firebaseError = new Error('Firebase log failed');
        logToFirebase.mockRejectedValueOnce(firebaseError);

        const response = await request(app)
            .post('/incoming-call')
            .set('Host', mockHost)
            .type('form')
            .send({
                CallSid: mockCallSid,
                From: mockFromNumber,
                To: mockToNumber,
            });

        // Verify success in sending TwiML
        expect(response.statusCode).toBe(200);
        expect(response.header['content-type']).toMatch(/text\/xml/);
        expect(response.text).toBe(expectedTwiml);

        // Verify TwiML was generated
        expect(mockStart).toHaveBeenCalledTimes(1);
        expect(mockPlay).toHaveBeenCalledTimes(1);
        expect(mockGather).toHaveBeenCalledTimes(1);

        // Verify logToFirebase was attempted
        expect(logToFirebase).toHaveBeenCalledTimes(1);

        // Verify the error WAS logged via logErrorToFirebase by the catch block
        expect(logErrorToFirebase).toHaveBeenCalledWith(
            'incomingCalls', // Category used in the route's catch block
            expect.objectContaining({
                name: 'InternalServerError', // Error type created in catch block
                message: 'Error logging incoming call to Firebase',
            })
        );
    });
});
