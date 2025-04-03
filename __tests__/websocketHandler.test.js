import { EventEmitter } from 'events';
import path from 'path';

// --- Mocks ---

// Mock dotenv FIRST
jest.mock('dotenv', () => ({ config: jest.fn() }));

// Define Controllable Mock Functions Globally
const mockLogToFirebase = jest.fn().mockResolvedValue(undefined);
const mockLogErrorToFirebase = jest.fn().mockResolvedValue(undefined);

// Mock @deepgram/sdk
jest.mock('@deepgram/sdk', () => {
    const { EventEmitter: DeepgramEventEmitter } = require('events');

    const mockSendInternal = jest.fn();
    const mockFinalizeInternal = jest.fn();

    // Setup connection object using these single mocks
    const mockConnectionInternal = new DeepgramEventEmitter();
    mockConnectionInternal.send = mockSendInternal; // single send mock
    mockConnectionInternal.finalize = mockFinalizeInternal; // single finalize mock

    const mockListenLiveInternal = jest.fn(() => mockConnectionInternal);
    const mockClientInternal = { listen: { live: mockListenLiveInternal } };
    const MockCreateClient = jest.fn(() => mockClientInternal);

    MockCreateClient._listenLive = mockListenLiveInternal;
    MockCreateClient._send = mockSendInternal; // Expose the single send mock
    MockCreateClient._finalize = mockFinalizeInternal; // Expose the single finalize mock

    // Return the structure for the mocked module's exports
    return {
        createClient: MockCreateClient, // Export the mock constructor function
        LiveTranscriptionEvents: {
            Open: 'open',
            Close: 'close',
            Transcript: 'transcript',
            Error: 'error',
        },
    };
});

// Mock Firebase utils (referencing outer mocks)
jest.mock('../src/utils/firebase.js', () => ({
    logToFirebase: mockLogToFirebase,
    logErrorToFirebase: mockLogErrorToFirebase,
}));

// Mock fs/promises (defining mock inside factory)
jest.mock('fs/promises', () => {
    const mockWriteFileInternal = jest.fn(); // For fs mock
    return { writeFile: mockWriteFileInternal };
});

// Mock Error classes
const createMockError = (name, defaultMessage, defaultStatusCode) => {
    return class extends Error {
        constructor(message, statusCode, stack) {
            super(message || defaultMessage); // Call parent Error constructor
            this.name = name;
            this.statusCode = statusCode || defaultStatusCode;
            this.stack = stack || new Error().stack;
            Object.setPrototypeOf(this, this.constructor.prototype);
        }
    };
};

jest.mock('../src/errors/InternalServerError.js', () => ({
    __esModule: true,
    default: createMockError(
        'InternalServerError',
        'Internal Server Error',
        500
    ),
}));
import InternalServerError from '../src/errors/InternalServerError.js';

// --- Import Handler ---
import { handleWebSocketConnection } from '../src/websocketHandler.js';
import { createClient as createDeepgramClientMock } from '@deepgram/sdk';
const mockListenLive = createDeepgramClientMock._listenLive; 
const mockDeepgramSend = createDeepgramClientMock._send;  
const mockDeepgramFinalize = createDeepgramClientMock._finalize; 

// --- Test Suite ---
describe('WebSocket Handler Logic', () => {
    let mockWs;
    let mockReq;
    let dependencies;
    let consoleLogSpy, consoleErrorSpy;
    let pathJoinSpy;

    // beforeEach/afterEach for spies
    beforeEach(() => {
        jest.clearAllMocks(); // Standard practice so whatever

        // Spies setup
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        pathJoinSpy = jest
            .spyOn(path, 'join')
            .mockReturnValue('/mock/path/to/src/public/test_output.mpeg');

        // Create mock WS
        mockWs = new EventEmitter();
        mockReq = {};

        // Need to get the mocked createClient function handle
        const {
            createClient: createDeepgramClientMockFn,
        } = require('@deepgram/sdk');
        const mockClient = createDeepgramClientMockFn(); // Call the mock factory function

        // Prepare dependencies
        dependencies = {
            deepgram: mockClient,
            logToFirebase: mockLogToFirebase,
            logErrorToFirebase: mockLogErrorToFirebase,
        };

        // Reset specific mock states (clearAllMocks should handle jest.fn())
        mockLogToFirebase.mockResolvedValue(undefined);
        mockLogErrorToFirebase.mockResolvedValue(undefined);
        // If listen.live needs specific return value setup for each test:
        const listenLiveMock = dependencies.deepgram.listen.live;
        const newMockConn = new EventEmitter();
        newMockConn.send = mockDeepgramSend; // Ensure methods use global mocks
        newMockConn.finalize = mockDeepgramFinalize;
        listenLiveMock.mockReturnValue(newMockConn);
    });

    afterEach(() => {
        // Restore spies
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        pathJoinSpy.mockRestore();
    });

    // --- Tests ---

    it('should call deepgram.listen.live on new connection', () => {
        handleWebSocketConnection(mockWs, mockReq, dependencies);
        const listenLiveMock = dependencies.deepgram.listen.live; // Get mock from dependency
        expect(listenLiveMock).toHaveBeenCalledTimes(1);
        expect(listenLiveMock).toHaveBeenCalledWith(
            expect.objectContaining({ encoding: 'mulaw' })
        );
    });

    it('should log when Deepgram connection opens', () => {
        handleWebSocketConnection(mockWs, mockReq, dependencies);
        const listenLiveMock = dependencies.deepgram.listen.live;
        const dgConnectionInstance = listenLiveMock.mock.results[0].value;
        expect(dgConnectionInstance).toBeDefined();
        dgConnectionInstance.emit('open');
        expect(consoleLogSpy).toHaveBeenCalledWith(
            'Deepgram ListenLiveClient opened.'
        );
    });

    it('should process "start" message and store SIDs (tested indirectly)', () => {
        handleWebSocketConnection(mockWs, mockReq, dependencies);
        const callSid = 'WS_CALL_123';
        const streamSid = 'WS_STR_456';
        const startMsg = JSON.stringify({
            event: 'start',
            start: { callSid, streamSid },
        });
        expect(() => mockWs.emit('message', startMsg)).not.toThrow();
        expect(consoleLogSpy).toHaveBeenCalledWith(
            `WebSocket stream started for CallSid: ${callSid}, StreamSid: ${streamSid}`
        );
    });

    it('should send decoded audio buffer to deepgram on "media" message', () => {
        handleWebSocketConnection(mockWs, mockReq, dependencies);
        const audioPayload = Buffer.from('test audio bytes').toString('base64');
        const mediaMsg = JSON.stringify({
            event: 'media',
            media: { payload: audioPayload },
        });
        mockWs.emit('message', mediaMsg);
        expect(mockDeepgramSend).toHaveBeenCalledTimes(1); // Check global mock
        expect(mockDeepgramSend).toHaveBeenCalledWith(
            Buffer.from('test audio bytes')
        );
    });

    it('should accumulate final transcripts and log on Deepgram Close', async () => {
        const testCallSid = 'WS_TRANSCRIPT_TEST';
        const testStreamSid = 'STREAM_ABC';
        handleWebSocketConnection(mockWs, mockReq, dependencies);
        mockWs.emit(
            'message',
            JSON.stringify({
                event: 'start',
                start: { callSid: testCallSid, streamSid: testStreamSid },
            })
        );
        const listenLiveMock = dependencies.deepgram.listen.live;
        const dgConnectionInstance = listenLiveMock.mock.results[0].value;

        dgConnectionInstance.emit('transcript', {
            is_final: true,
            channel: { alternatives: [{ transcript: 'First part. ' }] },
        });
        dgConnectionInstance.emit('transcript', {
            is_final: true,
            channel: { alternatives: [{ transcript: 'Second part.' }] },
        });
        dgConnectionInstance.emit('close');
        await new Promise(setImmediate);

        expect(mockLogToFirebase).toHaveBeenCalledTimes(1);
        // Expect double space...
        expect(mockLogToFirebase).toHaveBeenCalledWith(
            testCallSid,
            expect.objectContaining({ transcript: 'First part.  Second part.' })
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
            `Logging transcript for ${testCallSid}: "First part.  Second part."`
        );
    });

    it('should log error if logging transcript fails', async () => {
        const testCallSid = 'WS_LOG_FAIL_TEST';
        const logFailError = new Error('DB write failed');
        mockLogToFirebase.mockRejectedValueOnce(logFailError);

        handleWebSocketConnection(mockWs, mockReq, dependencies);
        mockWs.emit(
            'message',
            JSON.stringify({
                event: 'start',
                start: { callSid: testCallSid, streamSid: 'STREAM_LOGFAIL' },
            })
        );
        const listenLiveMock = dependencies.deepgram.listen.live;
        const dgConnectionInstance = listenLiveMock.mock.results[0].value;
        dgConnectionInstance.emit('transcript', {
            is_final: true,
            channel: { alternatives: [{ transcript: 'Data.' }] },
        });
        dgConnectionInstance.emit('close');
        await new Promise(setImmediate);

        expect(mockLogToFirebase).toHaveBeenCalledTimes(1);
        expect(mockLogErrorToFirebase).toHaveBeenCalledTimes(1);
        expect(mockLogErrorToFirebase).toHaveBeenCalledWith(
            testCallSid,
            expect.objectContaining({
                message: 'Error logging Deepgram transcript to Firebase',
                name: 'InternalServerError',
            })
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            `Error logging Deepgram transcript for ${testCallSid}:`,
            logFailError
        );
    });

    it('should log error on Deepgram Error event', async () => {
        const testCallSid = 'WS_DG_ERROR_TEST';
        const deepgramError = new Error('Deepgram connection error');
        handleWebSocketConnection(mockWs, mockReq, dependencies);
        mockWs.emit(
            'message',
            JSON.stringify({
                event: 'start',
                start: { callSid: testCallSid, streamSid: 'STREAM_DG_ERR' },
            })
        );
        const listenLiveMock = dependencies.deepgram.listen.live;
        const dgConnectionInstance = listenLiveMock.mock.results[0].value;

        dgConnectionInstance.emit('error', deepgramError);
        await new Promise(setImmediate);

        expect(mockLogErrorToFirebase).toHaveBeenCalledTimes(1);
        expect(mockLogErrorToFirebase).toHaveBeenCalledWith(
            testCallSid,
            expect.objectContaining({
                message: 'Deepgram ListenLiveClient error',
            })
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'Deepgram ListenLiveClient error:',
            deepgramError
        );
    });

    it('should call deepgramConnection.finalize on WebSocket close', () => {
        handleWebSocketConnection(mockWs, mockReq, dependencies);
        mockWs.emit('close');
        expect(mockDeepgramFinalize).toHaveBeenCalledTimes(1); // Check global mock
        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining('WebSocket connection closed for CallSid:')
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining(
                'Deepgram connection finalized due to WebSocket close'
            )
        );
    });

    it('should call deepgramConnection.finalize and log on WebSocket error', async () => {
        const testCallSid = 'WS_WSERR_TEST';
        const wsError = new Error('WebSocket disconnected');
        handleWebSocketConnection(mockWs, mockReq, dependencies);
        mockWs.emit(
            'message',
            JSON.stringify({
                event: 'start',
                start: { callSid: testCallSid, streamSid: 'STREAM_WSERR' },
            })
        );
        mockWs.on('error', () => {}); // dummy listener

        mockWs.emit('error', wsError);
        await new Promise(resolve => setTimeout(resolve, 20)); // slight delay, not really needed but keeping just as a safeguard 

        // Assertions
        expect(mockDeepgramFinalize).toHaveBeenCalledTimes(1); 
        expect(mockLogErrorToFirebase).toHaveBeenCalledTimes(1); 
        expect(mockLogErrorToFirebase).toHaveBeenCalledWith(
            testCallSid,
            expect.objectContaining({ message: 'WebSocketServer Error' })
        );
        // expect(consoleErrorSpy).toHaveBeenCalledWith(
        //     `WebSocket error for ${testCallSid}:`,
        //     wsError
        // );
    });

    it('should handle invalid JSON message gracefully and log error', async () => {
        const testCallSid = 'unknown_callsid'; // Because 'start' processing will fail
        handleWebSocketConnection(mockWs, mockReq, dependencies);
        const invalidJson = '{"event":"media", payload:';

        mockWs.emit('message', invalidJson);
        await new Promise(setImmediate);

        expect(mockDeepgramSend).not.toHaveBeenCalled();
        expect(mockLogErrorToFirebase).toHaveBeenCalledTimes(1); 
        expect(mockLogErrorToFirebase).toHaveBeenCalledWith(
            testCallSid,
            expect.objectContaining({
                message: 'Error processing WebSocket message',
            })
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'Error processing WebSocket message:',
            expect.any(SyntaxError)
        );
    });
});
