/**
 * @fileoverview Defines the InternalServerError class for handling generic HTTP 500 errors.
 * This error should be used for unexpected server-side issues or programming errors
 * where no more specific error type is appropriate.
 *
 * @requires ./BaseError - The base custom error class.
 */

import BaseError from './BaseError.js';

/**
 * Represents a generic HTTP 500 Internal Server Error.
 * This error indicates an unexpected condition was encountered on the server,
 * preventing it from fulfilling the request. It typically signifies a bug or
 * unhandled exception in the application code.
 * Inherits from BaseError, sets the status code to 500, and importantly,
 * defaults `isOperational` to `false`, signaling a non-operational,
 * unexpected programming error.
 *
 * @class InternalServerError
 * @extends {BaseError}
 */
class InternalServerError extends BaseError {
    /**
     * Creates an instance of InternalServerError.
     *
     * @param {string} [message='Internal Server Error'] - The error message. Defaults to 'Internal Server Error'.
     * @param {number} [statusCode=500] - The HTTP status code. Defaults to 500.
     * @param {string} [stack] - Optional stack trace. If not provided, it will be captured.
     */
    constructor(message = 'Internal Server Error', statusCode = 500, stack) {
        // Call the BaseError constructor
        // Sets name='InternalServerError', message, statusCode, isOperational=false (indicating an unexpected error), and handles stack
        super('InternalServerError', message, statusCode, false, stack);
    }
}

export default InternalServerError;
