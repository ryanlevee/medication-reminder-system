import request from 'supertest';
import express from 'express';
import twilioMock from 'twilio'; // Keep the renamed import

// Mock twilio at the very top
jest.mock('twilio', () => {
    const mockCreate = jest.fn().mockResolvedValue({ sid: 'CA1234567890' });
    const mockCalls = { create: mockCreate };

    // Mock the Twilio constructor
    const mockTwilio = jest.fn(() => ({
        calls: mockCalls,
    }));

    return mockTwilio;
});

// Mock import.meta for elevenLabsService.js
jest.mock('../src/services/elevenLabsService.js', () => ({
    __esModule: true,
    elevenLabsTextToSpeech: jest
        .fn()
        .mockResolvedValue('path/to/mock/audio.mp3'),
}));

import callsRouter from '../src/routes/calls.js';

// Mock necessary modules and functions
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

// Import your local firebase utils *after* mocking firebase-admin
jest.mock('../src/utils/firebase.js', () => ({
    logToFirebase: jest.fn().mockResolvedValue(undefined),
    logErrorToFirebase: jest.fn().mockResolvedValue(undefined), // Also mock logErrorToFirebase for completeness
}));
import { logToFirebase, logErrorToFirebase } from '../src/utils/firebase.js';

let app;

beforeEach(() => {
    // Create a new Express app for each test to avoid state conflicts
    app = express();
    app.use(express.json()); // Make sure your app can parse JSON
    app.use('/', callsRouter);
});

describe('POST /call', () => {
    it('should initiate a call and return CallSid', async () => {
        const mockCallSid = 'CA1234567890';
        // twilioMock.mock.calls.create.mockResolvedValue({ sid: mockCallSid });

        const response = await request(app)
            .post('/call')
            .send({ phoneNumber: '+1234567890' });

        expect(response.statusCode).toBe(200);
        expect(response.body.CallSid).toBe(mockCallSid);
        expect(response.body.message).toBe('Call initiated.');

        // Ensure Twilio's calls.create method was called with the correct parameters
        expect(
            twilioMock.mock.results[0].value.calls.create
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                to: '+1234567890',
                from: process.env.TWILIO_PHONE_NUMBER_TOLL_FREE,
                url: expect.stringContaining('/answered'),
                statusCallback: expect.stringContaining('/call-status'),
                statusCallbackEvent: [
                    'initiated',
                    'ringing',
                    'answered',
                    'completed',
                ],
                machineDetection: 'DetectMessageEnd',
                record: 'true',
                recordingStatusCallback:
                    expect.stringContaining('/handle-recording'),
            })
        );
        // Ensure logToFirebase was called with the correct parameters
        expect(logToFirebase).toHaveBeenCalledWith(
            mockCallSid,
            expect.objectContaining({
                event: 'call_initiated',
                status: 'Call Initiated.',
                phoneNumber: '+1234567890',
            })
        );
    });
});
