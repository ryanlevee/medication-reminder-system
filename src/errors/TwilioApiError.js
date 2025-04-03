/**
 * @fileoverview Defines the TwilioApiError class for handling errors related to the Twilio API.
 * This error should be thrown when interactions with the Twilio services (like initiating calls,
 * sending SMS, or updating numbers) fail.
 *
 * @requires ./BaseError - The base custom error class.
 */

import BaseError from './BaseError.js';

/**
 * Represents an error originating from the Twilio API or the interaction with it.
 * Typically used when a Twilio REST API request fails or returns an error response.
 * Inherits from BaseError and sets the status code to 500 (Internal Server Error)
 * by default, assuming the failure is often on the server-side or during integration,
 * although Twilio might provide specific error codes that could override this.
 *
 * @class TwilioApiError
 * @extends {BaseError}
 */
class TwilioApiError extends BaseError {
    /**
     * Creates an instance of TwilioApiError.
     *
     * @param {string} [message='Twilio API Error'] - The error message. Defaults to 'Twilio API Error'.
     * @param {number} [statusCode=500] - The HTTP status code. Often reflects the status from the Twilio API response if available, otherwise defaults to 500.
     * @param {string} [stack] - Optional stack trace. If not provided, it will be captured.
     */
    constructor(message = 'Twilio API Error', statusCode = 500, stack) {
        // Call the BaseError constructor
        // Sets name='TwilioApiError', message, statusCode, isOperational=true (indicating a known integration point failure), and handles stack
        super('TwilioApiError', message, statusCode, true, stack);
    }
}

export default TwilioApiError;
