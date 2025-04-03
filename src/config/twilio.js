/**
 * @fileoverview Twilio client configuration and utility functions.
 * This file initializes the Twilio Node.js helper library client using credentials
 * from environment variables. It also provides a function to dynamically update
 * the webhook URLs for incoming phone numbers, typically used with ngrok during development.
 *
 * @requires dotenv - For loading environment variables.
 * @requires twilio - The Twilio Node.js helper library.
 * @requires ../errors/TwilioApiError - Custom error class for Twilio API errors.
 */

import dotenv from 'dotenv';
import twilio from 'twilio';
import TwilioApiError from '../errors/TwilioApiError.js';

// Load environment variables from .env file
dotenv.config();

/**
 * The initialized Twilio REST client instance.
 * Used to interact with the Twilio API (e.g., make calls, send SMS).
 * @type {twilio.Twilio}
 */
const client = new twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

/**
 * The base URL provided by ngrok for local development tunneling.
 * Loaded from the NGROK_URL environment variable.
 * @type {string | undefined}
 */
const ngrokUrl = process.env.NGROK_URL;

/**
 * Updates the voice webhook URL for all incoming phone numbers associated with the Twilio account.
 * This is primarily useful during development with ngrok to point Twilio webhooks
 * to the local development server. It iterates through each phone number and sets
 * its `voiceUrl` to `${ngrokUrl}/incoming-call`.
 *
 * @async
 * @function updateIncomingCallWebhookUrls
 * @returns {Promise<void>} A promise that resolves when all numbers have been processed,
 * or rejects if an error occurs.
 * @throws {TwilioApiError} If there's an error interacting with the Twilio API during the update.
 * @throws {Error} If `ngrokUrl` is not defined (essential for this function).
 */
async function updateIncomingCallWebhookUrls() {
    if (!ngrokUrl) {
        console.warn(
            'NGROK_URL environment variable not set. Skipping webhook URL update.'
        );
        // Optionally throw an error if ngrok URL is mandatory for startup
        // throw new Error('NGROK_URL environment variable is required but not set.');
        return; // Exit function if ngrok URL is not set
    }

    try {
        const updatedNumbers = [];
        // await IS needed here, even though the IDE seems to think it is not...
        await client.incomingPhoneNumbers.each(async (item) => {
            updatedNumbers.push(item.phoneNumber);
            // Update the voiceUrl for the current phone number
            await item.update({
                voiceUrl: `${ngrokUrl}/incoming-call`,
                // potentially extensible to smsUrl if the functionality exists:
                // smsUrl: `${ngrokUrl}/incoming-sms`, // Example
            });
        });
        console.log(
            `Successfully updated incoming call webhook URLs for ${updatedNumbers.length} number(s):`,
            {
                phoneNumbers: updatedNumbers,
                url: `${ngrokUrl}/incoming-call`,
            }
        );
    } catch (error) {
        console.error('Error updating Twilio webhook URLs:', error.message);
        // Wrap the original error in a custom error type for better error handling upstream
        throw new TwilioApiError(
            `Failed to update Twilio webhook URLs. Reason: ${error.message}`,
            error.status || 500, // Use status from Twilio error if available
            error.stack
        );
    }
}

export { updateIncomingCallWebhookUrls };