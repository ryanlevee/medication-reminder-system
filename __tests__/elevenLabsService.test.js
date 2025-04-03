/*
file: __tests__/elevenLabsService.test.js
*/

import { EventEmitter } from 'events';
import path from 'path';

// --- Mocks ---
// Mock dotenv
jest.mock('dotenv', () => ({ config: jest.fn() }));

// Mock elevenlabs-node (Define mocks inside factory)
const mockTextToSpeechStreamInternal = jest.fn();
const mockElevenLabsInstanceInternal = {
    textToSpeechStream: mockTextToSpeechStreamInternal,
};
const mockConstructor = jest.fn(() => mockElevenLabsInstanceInternal);
mockConstructor._mockTextToSpeechStream = mockTextToSpeechStreamInternal;
jest.mock('elevenlabs-node', () => mockConstructor);

// Mock fs/promises (Define mock inside factory)
const mockWriteFileInternal = jest.fn();
jest.mock('fs/promises', () => ({
    writeFile: mockWriteFileInternal,
}));

// Mock Error classes...
const createMockError = (name, defaultMessage, defaultStatusCode) => {
    return class extends Error {
        constructor(message, statusCode, stack) {
            super(message || defaultMessage);
            this.name = name;
            this.statusCode = statusCode || defaultStatusCode;
            this.stack = stack || new Error().stack;
            Object.setPrototypeOf(this, this.constructor.prototype);
        }
    };
};
jest.mock('../src/errors/ElevenLabsApiError.js', () =>
    createMockError('ElevenLabsApiError', 'ElevenLabs API Error', 500)
);
jest.mock('../src/errors/InternalServerError.js', () =>
    createMockError('InternalServerError', 'Internal Server Error', 500)
);
// Error classes will be dynamically imported in beforeEach

// --- Test Setup ---
describe('ElevenLabs Service - elevenLabsTextToSpeech', () => {
    let elevenLabsTextToSpeech; // Will be dynamically imported
    let mockAudioStream;
    let pathJoinSpy;
    let fs; // Will hold dynamically imported mocked fs
    let mockTextToSpeechStream; // Will hold retrieved inner mock
    let mockWriteFile; // Will hold retrieved inner mock
    let ElevenLabsApiError, InternalServerError; // Will hold dynamic error classes

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

    beforeEach(async () => {
        // 1. Reset Jest's module cache
        jest.resetModules();

        // 2. Set environment variable *before* importing the service
        process.env.NGROK_URL = 'http://mock-ngrok.io';

        // 3. Reset global mock function state (needed after resetModules)
        // These point to the functions defined inside the jest.mock factories above
        mockTextToSpeechStreamInternal.mockClear();
        mockWriteFileInternal.mockClear().mockResolvedValue(undefined);
        mockConstructor.mockClear(); // Clear constructor calls if needed
        // jest.clearAllMocks(); // Optional: Usually not needed after resetModules + specific clears

        // 4. Dynamically import the service *after* setting env var and resetting
        // Babel should transform dynamic import() correctly in default environment
        const serviceModule = await import(
            '../src/services/elevenLabsService.js'
        );
        elevenLabsTextToSpeech = serviceModule.elevenLabsTextToSpeech;

        // 5. Dynamically import mocked dependencies to get current handles AFTER reset
        const ElevenLabsClientMock = (await import('elevenlabs-node')).default; // Constructor
        mockTextToSpeechStream = ElevenLabsClientMock._mockTextToSpeechStream; // Get inner mock

        fs = await import('fs/promises'); // Get mocked fs object
        mockWriteFile = fs.writeFile; // Get inner mock writeFile

        ElevenLabsApiError = (
            await import('../src/errors/ElevenLabsApiError.js')
        ).default;
        InternalServerError = (
            await import('../src/errors/InternalServerError.js')
        ).default;

        // 6. Configure mocks for the test
        mockAudioStream = new EventEmitter();
        mockTextToSpeechStream.mockResolvedValue(mockAudioStream); // Configure retrieved mock
        pathJoinSpy = jest
            .spyOn(path, 'join')
            .mockReturnValue('/mock/path/to/src/public/test_output.mpeg');
    });

    afterEach(() => {
        if (pathJoinSpy) pathJoinSpy.mockRestore();
        // Delete env var to avoid polluting other tests
        delete process.env.NGROK_URL;
    });

    // --- Tests ---
    const voiceId = 'test-voice-id';
    const textInput = 'Hello world';
    const fileName = 'test_output.mpeg';
    const mockExpectedPath = '/mock/path/to/src/public/test_output.mpeg';

    it('should call textToSpeechStream, write file, and resolve with URL on success', async () => {
        const promise = elevenLabsTextToSpeech(voiceId, textInput, fileName);

        expect(mockTextToSpeechStream).toHaveBeenCalledTimes(1); // Use retrieved handle
        expect(mockTextToSpeechStream).toHaveBeenCalledWith({
            voiceId,
            textInput,
        });

        mockAudioStream.emit('data', Buffer.from('hello '));
        mockAudioStream.emit('data', Buffer.from('world'));
        await new Promise(setImmediate);
        mockAudioStream.emit('end');

        await expect(promise).resolves.toBe(`http://mock-ngrok.io/${fileName}`);

        expect(mockWriteFile).toHaveBeenCalledTimes(1); // Use retrieved handle
        const expectedBuffer = Buffer.concat([
            Buffer.from('hello '),
            Buffer.from('world'),
        ]);
        
        expect(mockWriteFile).toHaveBeenCalledWith(
            mockExpectedPath,
            expect.any(Buffer)
        );
        expect(pathJoinSpy).toHaveBeenCalled();
    });

    it('should reject with ElevenLabsApiError if textToSpeechStream call fails initially', async () => {
        const apiError = new Error('API Key Invalid');
        mockTextToSpeechStream.mockRejectedValue(apiError); // Use retrieved handle

        await expect(
            elevenLabsTextToSpeech(voiceId, textInput, fileName)
        ).rejects.toThrow(ElevenLabsApiError);
        await expect(
            elevenLabsTextToSpeech(voiceId, textInput, fileName)
        ).rejects.toMatchObject({
            name: 'ElevenLabsApiError',
            message: 'Error generating TTS audio',
        });
        expect(mockWriteFile).not.toHaveBeenCalled(); // Use retrieved handle
    });

    it('should reject with ElevenLabsApiError if the audio stream emits an error', async () => {
        const streamError = new Error('Network issue during stream');
        const promise = elevenLabsTextToSpeech(voiceId, textInput, fileName);
        expect(mockTextToSpeechStream).toHaveBeenCalledTimes(1); // Use retrieved handle

        await new Promise(setImmediate);
        mockAudioStream.emit('error', streamError);

        await expect(promise).rejects.toThrow(ElevenLabsApiError);
        await expect(promise).rejects.toMatchObject({
            name: 'ElevenLabsApiError',
            message: 'ElevenLabs API stream error',
        });
        expect(mockWriteFile).not.toHaveBeenCalled(); // Use retrieved handle
    });

    it('should reject with InternalServerError if fs.writeFile fails', async () => {
        const writeError = new Error('Disk full');
        mockWriteFile.mockRejectedValue(writeError); // Use retrieved handle

        const promise = elevenLabsTextToSpeech(voiceId, textInput, fileName);
        expect(mockTextToSpeechStream).toHaveBeenCalledTimes(1); // Use retrieved handle

        mockAudioStream.emit('data', Buffer.from('some data'));
        await new Promise(setImmediate);
        mockAudioStream.emit('end');

        await expect(promise).rejects.toThrow(InternalServerError);
        expect(mockWriteFile).toHaveBeenCalledTimes(1); // Use retrieved handle
        expect(mockWriteFile).toHaveBeenCalledWith(
            mockExpectedPath,
            expect.any(Buffer)
        );
        await expect(promise).rejects.toMatchObject({
            name: 'InternalServerError',
            message: 'Error writing TTS audio file',
        });
    });
});
