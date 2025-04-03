// --- Mocks ---

// Mock dotenv FIRST
jest.mock('dotenv', () => ({
    config: jest.fn(),
}));

// Mock the Twilio client constructor and methods
// Define mocks that can be controlled globally
const mockItemUpdate = jest.fn(); // General mock for item.update
const mockEach = jest.fn(); // Mock for incomingPhoneNumbers.each
const mockTwilioClientInstance = {
    incomingPhoneNumbers: {
        each: mockEach,
    },
};
jest.mock('twilio', () => {
    // Mock constructor returns the mock client instance
    return jest.fn().mockImplementation(() => mockTwilioClientInstance);
});

// Mock the custom error class
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
jest.mock('../src/errors/TwilioApiError.js', () =>
    createMockError('TwilioApiError', 'Twilio API Error', 500)
);
// Error class will be imported dynamically in beforeEach

import TwilioApiError from '../src/errors/TwilioApiError.js'; // Import mocked version

// --- Test Setup ---
describe('Twilio Config - updateIncomingCallWebhookUrls', () => {
    let updateIncomingCallWebhookUrls; // Function under test
    let TwilioApiError; // To hold dynamically imported error class

    // Store original env vars
    const OLD_ENV = process.env;

    // Console Spies
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
        // Needs async for dynamic import
        // 1. Reset modules to force re-import with fresh state
        jest.resetModules();
        // 2. Reset process.env (important if setting vars)
        process.env = { ...OLD_ENV };
        // 3. Set mock environment variables for this test run specifically 
        process.env.TWILIO_ACCOUNT_SID = 'mock_ACxxxxxxxxxxxxxxx';
        process.env.TWILIO_AUTH_TOKEN = 'mock_auth_token';
        process.env.NGROK_URL = 'http://fake-ngrok-url.io';

        // 4. Reset mock function states
        mockEach.mockClear();
        mockItemUpdate.mockClear().mockResolvedValue(undefined); // Default success
        
        // twilioConstructorMock.mockClear();
        jest.clearAllMocks(); // Clear other mocks/spies

        // 5. Dynamically import the function after resetting and setting env vars
        const configModule = await import('../src/config/twilio.js');
        updateIncomingCallWebhookUrls =
            configModule.updateIncomingCallWebhookUrls;
        // Dynamically import mocked error class
        TwilioApiError = (await import('../src/errors/TwilioApiError.js'))
            .default;
    });

    afterEach(() => {
        // Restore original environment
        process.env = OLD_ENV;
    });

    // --- Tests ---

    it('should update webhook URLs for multiple phone numbers', async () => {
        const expectedUrl = `${process.env.NGROK_URL}/incoming-call`;
        // Configure mock 'each' to simulate two items
        const mockItem1 = {
            friendlyName: 'US Number',
            phoneNumber: '+15551112222',
            update: jest.fn().mockResolvedValue(undefined),
        };
        const mockItem2 = {
            friendlyName: null,
            phoneNumber: '+447700900123',
            update: jest.fn().mockResolvedValue(undefined),
        };
        mockEach.mockImplementation(async callback => {
            await callback(mockItem1);
            await callback(mockItem2);
        });

        await updateIncomingCallWebhookUrls();

        // Verify 'each' was called
        expect(mockEach).toHaveBeenCalledTimes(1);
        // Verify 'update' was called for each item with the correct URL
        expect(mockItem1.update).toHaveBeenCalledTimes(1);
        expect(mockItem1.update).toHaveBeenCalledWith({
            voiceUrl: expectedUrl,
        });
        expect(mockItem2.update).toHaveBeenCalledTimes(1);
        expect(mockItem2.update).toHaveBeenCalledWith({
            voiceUrl: expectedUrl,
        });

        // Verify console log
        expect(consoleLogSpy).toHaveBeenCalledWith(
            `Incoming call webhook URLs updated for: US Number, +447700900123 to ${expectedUrl}`
        );
        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should handle zero phone numbers gracefully', async () => {
        const expectedUrl = `${process.env.NGROK_URL}/incoming-call`;
        // Configure mock 'each' to do nothing (simulate no numbers)
        mockEach.mockImplementation(async callback => {
            // noop
        });

        await updateIncomingCallWebhookUrls();

        expect(mockEach).toHaveBeenCalledTimes(1);
        // Verify console log shows empty list
        expect(consoleLogSpy).toHaveBeenCalledWith(
            `Incoming call webhook URLs updated for:  to ${expectedUrl}` // Empty list results in double space
        );
        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
    it('should throw TwilioApiError if item.update fails', async () => {
        const updateError = new Error('Twilio API error 404');
        // jest.fn() directly for the update mock within the item
        const mockItemUpdateFn = jest.fn().mockRejectedValue(updateError);
        const mockItem1 = {
            friendlyName: 'FailingNum',
            phoneNumber: '+15553334444',
            update: mockItemUpdateFn,
        };
        mockEach.mockImplementation(async callback => {
            await callback(mockItem1);
        });

        await expect(updateIncomingCallWebhookUrls()).rejects.toThrow(
            TwilioApiError
        );

        // Assertions after the single call
        expect(mockEach).toHaveBeenCalledTimes(1);
        expect(mockItemUpdateFn).toHaveBeenCalledTimes(1); // Check the specific item's mock update
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'Error updating Twilio webhook URLs:',
            updateError.message
        );
    });

    it('should throw TwilioApiError if client.incomingPhoneNumbers.each fails', async () => {
        const eachError = new Error('Cannot fetch numbers');
        mockEach.mockRejectedValue(eachError);

        await expect(updateIncomingCallWebhookUrls()).rejects.toThrow(
            TwilioApiError
        );

        // Assertions after the single call
        expect(mockEach).toHaveBeenCalledTimes(1);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'Error updating Twilio webhook URLs:',
            eachError.message
        );
    });
});
