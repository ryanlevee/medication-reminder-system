/**
 * @fileoverview Defines the BadRequestError class for handling HTTP 400 errors.
 * This error should be thrown when user input is invalid or malformed,
 * preventing the server from processing the request.
 *
 * @requires ./BaseError - The base custom error class.
 */

import BaseError from './BaseError.js';

/**
 * Represents an HTTP 400 Bad Request error.
 * Typically used when the server cannot process a request due to client error
 * (e.g., malformed request syntax, invalid request message framing,
 * or deceptive request routing).
 * Inherits from BaseError and sets the status code to 400 by default.
 *
 * @class BadRequestError
 * @extends {BaseError}
 */
class BadRequestError extends BaseError {
    /**
     * Creates an instance of BadRequestError.
     *
     * @param {string} [message='Bad Request'] - The error message. Defaults to 'Bad Request'.
     * @param {number} [statusCode=400] - The HTTP status code. Defaults to 400.
     * @param {string} [stack] - Optional stack trace. If not provided, it will be captured.
     */
    constructor(message = 'Bad Request', statusCode = 400, stack) {
        // Call the BaseError constructor
        // Sets name='BadRequestError', message, statusCode, isOperational=true, and handles stack
        super('BadRequestError', message, statusCode, true, stack);
    }
}

export default BadRequestError;
