/**
 * @fileoverview Defines the ElevenLabsApiError class for handling errors related to the ElevenLabs API.
 * This error should be thrown when interactions with the ElevenLabs text-to-speech service fail.
 *
 * @requires ./BaseError - The base custom error class.
 */

import BaseError from './BaseError.js';

/**
 * Represents an error originating from the ElevenLabs API or the interaction with it.
 * Typically used when a text-to-speech request fails or returns an error response.
 * Inherits from BaseError and sets the status code to 500 (Internal Server Error)
 * by default, assuming the failure is often on the server-side or during integration,
 * though this can be overridden.
 *
 * @class ElevenLabsApiError
 * @extends {BaseError}
 */
class ElevenLabsApiError extends BaseError {
    /**
     * Creates an instance of ElevenLabsApiError.
     *
     * @param {string} [message='ElevenLabs API Error'] - The error message. Defaults to 'ElevenLabs API Error'.
     * @param {number} [statusCode=500] - The HTTP status code. Defaults to 500.
     * @param {string} [stack] - Optional stack trace. If not provided, it will be captured.
     */
    constructor(message = 'ElevenLabs API Error', statusCode = 500, stack) {
        // Call the BaseError constructor
        // Sets name='ElevenLabsApiError', message, statusCode, isOperational=true (indicating a known integration point failure), and handles stack
        super('ElevenLabsApiError', message, statusCode, true, stack);
    }
}

export default ElevenLabsApiError;
