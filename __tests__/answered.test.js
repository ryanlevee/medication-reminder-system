import request from 'supertest';
import express from 'express';
import twilio from 'twilio';

// --- Mocks ---

// Mock Twilio, including TwiML generation
let mockTwimlInstance; // To hold the instance for assertion checks
const mockParameter = jest.fn();
const mockStream = jest.fn(() => ({ parameter: mockParameter }));
const mockStart = jest.fn(() => ({ stream: mockStream }));
const mockPlay = jest.fn();
const mockGatherPlay = jest.fn(); // Separate mock for gather.play
const mockGather = jest.fn(() => ({ play: mockGatherPlay }));
const mockHangup = jest.fn();
const mockToString = jest.fn();

jest.mock('twilio', () => {
    const MockVoiceResponse = jest.fn(() => {
        // Store the latest instance
        mockTwimlInstance = {
            start: mockStart,
            play: mockPlay,
            gather: mockGather,
            hangup: mockHangup,
            toString: mockToString,
        };
        return mockTwimlInstance;
    });

    // Mock the top-level client constructor (needed by calls.js)
    const mockTwilioClient = jest.fn(() => ({
        // Add other client properties if needed by other routes in calls.js
    }));

    // Attach the twiml namespace and VoiceResponse class mock
    mockTwilioClient.twiml = {
        VoiceResponse: MockVoiceResponse,
    };

    return mockTwilioClient;
});

// Mock firebase-admin (similar to call.test.js)
jest.mock('firebase-admin', () => {
    const databaseMock = jest.fn(() => ({
        ref: jest.fn(() => ({
            push: jest.fn().mockResolvedValue({ key: 'mockKey' }),
        })),
        ServerValue: {
            TIMESTAMP: 'mockTimestamp',
        },
    }));

    databaseMock.ServerValue = {
        TIMESTAMP: 'mockTimestamp',
    };

    const credentialMock = {
        cert: jest.fn(() => ({
            projectId: 'mock-project-id',
        })),
    };

    const initializeAppMock = jest.fn(() => ({
        database: databaseMock,
    }));

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

// Mock elevenLabsService (not used in /answered, but good practice if callsRouter imports it)
jest.mock('../src/services/elevenLabsService.js', () => ({
    __esModule: true,
    elevenLabsTextToSpeech: jest
        .fn()
        .mockResolvedValue('path/to/mock/audio.mp3'),
}));

// Import the router after all mocks are set up
import callsRouter from '../src/routes/calls.js';

// --- Console Output Suppression ---
let consoleLogSpy;
let consoleErrorSpy;

beforeEach(() => {
    // Suppress console.log and console.error before each test runs
    // This prevents logs from the application code (e.g., calls.js) from cluttering the test output
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    // Restore console.log and console.error after each test completes
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
});

// --- Existing Test Setup ---
let app;

beforeEach(() => {
    // Reset mocks for each test to ensure isolation
    jest.clearAllMocks();

    // Create a new Express app instance
    app = express();
    // Middleware to parse URL-encoded bodies (like those from Twilio webhooks)
    app.use(express.urlencoded({ extended: true }));
    // Mount the router
    app.use('/', callsRouter);

    // Set a default mock return value for toString for simplicity
    mockToString.mockReturnValue('<Response>DefaultMockTwiml</Response>');
});

// --- Tests ---

describe('POST /answered', () => {
    const mockCallSid = 'CA_ANSWERED_MOCK_SID';
    const mockHost = 'mock-ngrok-domain.io'; // Mock host header

    it('should handle "human" answer with TwiML for stream, play, gather, beep', async () => {
        const expectedTwiml = `<Response><Start><Stream url="wss://${mockHost}/live"><Parameter name="CallSid" value="${mockCallSid}"/></Stream></Start><Play>${process.env.NGROK_URL}/reminder.mpeg</Play><Gather input="speech" speechTimeout="2" maxSpeechTime="12" action="/handle-speech"><Play>${process.env.NGROK_URL}/beep.mpeg</Play></Gather></Response>`;
        mockToString.mockReturnValue(expectedTwiml); // Set expected TwiML for this test

        const response = await request(app)
            .post('/answered')
            .set('Host', mockHost) // Set host header for wss URL generation
            .type('form') // Twilio sends form data
            .send({ CallSid: mockCallSid, AnsweredBy: 'human' });

        expect(response.statusCode).toBe(200);
        expect(response.header['content-type']).toMatch(/text\/xml/);
        expect(response.text).toBe(expectedTwiml);

        // Verify TwiML methods were called
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
        ); // Check gather's play call

        // Verify Firebase logging
        expect(logToFirebase).toHaveBeenCalledWith(mockCallSid, {
            event: 'call_answered',
            status: 'Call answered by: human',
            twiml: expectedTwiml,
        });
        expect(logErrorToFirebase).not.toHaveBeenCalled();
    });

    // Test one of the machine scenarios (they share the same logic)
    it('should handle "machine_end_beep" answer with TwiML for voicemail prompt', async () => {
        const expectedTwiml = `<Response><Play>${process.env.NGROK_URL}/voicemail.mpeg</Play></Response>`;
        mockToString.mockReturnValue(expectedTwiml);

        const response = await request(app)
            .post('/answered')
            .set('Host', mockHost)
            .type('form')
            .send({ CallSid: mockCallSid, AnsweredBy: 'machine_end_beep' });

        expect(response.statusCode).toBe(200);
        expect(response.header['content-type']).toMatch(/text\/xml/);
        expect(response.text).toBe(expectedTwiml);

        // Verify TwiML methods
        expect(mockPlay).toHaveBeenCalledWith(
            `${process.env.NGROK_URL}/voicemail.mpeg`
        );
        expect(mockStart).not.toHaveBeenCalled();
        expect(mockGather).not.toHaveBeenCalled();

        // Verify Firebase logging
        expect(logToFirebase).toHaveBeenCalledWith(mockCallSid, {
            event: 'call_answered',
            status: 'Call answered by: machine_end_beep',
            twiml: expectedTwiml,
        });
        expect(logErrorToFirebase).not.toHaveBeenCalled();
    });

    it('should handle "unknown" answer by generating empty TwiML response', async () => {
        const expectedTwiml = '<Response></Response>'; // Empty response as no verbs added
        mockToString.mockReturnValue(expectedTwiml);

        const response = await request(app)
            .post('/answered')
            .set('Host', mockHost)
            .type('form')
            .send({ CallSid: mockCallSid, AnsweredBy: 'unknown' });

        expect(response.statusCode).toBe(200);
        expect(response.header['content-type']).toMatch(/text\/xml/);
        expect(response.text).toBe(expectedTwiml);

        // Verify no specific TwiML actions were taken in the switch
        expect(mockPlay).not.toHaveBeenCalled();
        expect(mockStart).not.toHaveBeenCalled();
        expect(mockGather).not.toHaveBeenCalled();

        // Verify Firebase logging
        expect(logToFirebase).toHaveBeenCalledWith(mockCallSid, {
            event: 'call_answered',
            status: 'Call answered by: unknown',
            twiml: expectedTwiml,
        });
        expect(logErrorToFirebase).not.toHaveBeenCalled();
    });

    it('should handle "fax" answer by generating empty TwiML response', async () => {
        const expectedTwiml = '<Response></Response>'; // Empty response as no verbs added
        mockToString.mockReturnValue(expectedTwiml);

        const response = await request(app)
            .post('/answered')
            .set('Host', mockHost)
            .type('form')
            .send({ CallSid: mockCallSid, AnsweredBy: 'fax' });

        expect(response.statusCode).toBe(200);
        expect(response.header['content-type']).toMatch(/text\/xml/);
        expect(response.text).toBe(expectedTwiml);

        // Verify no specific TwiML actions were taken in the switch
        expect(mockPlay).not.toHaveBeenCalled();
        expect(mockStart).not.toHaveBeenCalled();
        expect(mockGather).not.toHaveBeenCalled();

        // Verify Firebase logging
        expect(logToFirebase).toHaveBeenCalledWith(mockCallSid, {
            event: 'call_answered',
            status: 'Call answered by: fax',
            twiml: expectedTwiml,
        });
        expect(logErrorToFirebase).not.toHaveBeenCalled();
    });

    it('should handle unhandled "AnsweredBy" value with 500 error and log error', async () => {
        const unhandledAnsweredBy = 'some_unexpected_value';
        const response = await request(app)
            .post('/answered')
            .set('Host', mockHost)
            .type('form')
            .send({ CallSid: mockCallSid, AnsweredBy: unhandledAnsweredBy });

        expect(response.statusCode).toBe(500);
        expect(response.body.message).toBe(
            `Unhandled AnsweredBy: ${unhandledAnsweredBy}`
        );

        // Verify no TwiML was generated or sent
        expect(mockToString).not.toHaveBeenCalled(); // Should error before sending response

        // Verify Firebase error logging
        expect(logToFirebase).not.toHaveBeenCalled();
        expect(logErrorToFirebase).toHaveBeenCalledWith(
            'calls', // The route logs error under 'calls' category for this case
            expect.objectContaining({
                name: 'InternalServerError', // Assuming InternalServerError is used
                message: `Unhandled AnsweredBy: ${unhandledAnsweredBy}`,
                statusCode: 500,
            })
        );
    });

    it('should handle errors during Firebase logging gracefully', async () => {
        const expectedTwiml = `<Response><Play>${process.env.NGROK_URL}/voicemail.mpeg</Play></Response>`;
        mockToString.mockReturnValue(expectedTwiml);
        const firebaseError = new Error('Firebase write failed');
        logToFirebase.mockRejectedValueOnce(firebaseError); // Make logToFirebase fail

        const response = await request(app)
            .post('/answered')
            .set('Host', mockHost)
            .type('form')
            .send({ CallSid: mockCallSid, AnsweredBy: 'machine_end_silence' });

        // The route should still succeed in sending TwiML even if logging fails
        expect(response.statusCode).toBe(200);
        expect(response.header['content-type']).toMatch(/text\/xml/);
        expect(response.text).toBe(expectedTwiml);

        // Verify TwiML methods were called correctly
        expect(mockPlay).toHaveBeenCalledWith(
            `${process.env.NGROK_URL}/voicemail.mpeg`
        );

        // Verify logToFirebase was called
        expect(logToFirebase).toHaveBeenCalledWith(mockCallSid, {
            event: 'call_answered',
            status: 'Call answered by: machine_end_silence',
            twiml: expectedTwiml,
        });
        // Ensure the error wasn't logged via logErrorToFirebase in the main path
        expect(logErrorToFirebase).not.toHaveBeenCalled();
        // Note: We aren't testing the internal console.error call here, just that the route didn't crash.
    });
});
