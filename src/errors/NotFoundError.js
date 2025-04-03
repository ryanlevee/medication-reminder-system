/**
 * @fileoverview Defines the NotFoundError class for handling HTTP 404 errors.
 * This error should be thrown when a requested resource cannot be found on the server.
 *
 * @requires ./BaseError - The base custom error class.
 */

import BaseError from './BaseError.js';

/**
 * Represents an HTTP 404 Not Found error.
 * This error indicates that the server could not find the requested resource.
 * It's commonly used for invalid routes or when specific data items (like a call log by ID)
 * are requested but do not exist.
 * Inherits from BaseError and sets the status code to 404 by default.
 *
 * @class NotFoundError
 * @extends {BaseError}
 */
class NotFoundError extends BaseError {
    /**
     * Creates an instance of NotFoundError.
     *
     * @param {string} [message='Not Found'] - The error message. Defaults to 'Not Found'.
     * @param {number} [statusCode=404] - The HTTP status code. Defaults to 404.
     * @param {string} [stack] - Optional stack trace. If not provided, it will be captured.
     */
    constructor(message = 'Not Found', statusCode = 404, stack) {
        // Call the BaseError constructor
        // Sets name='NotFoundError', message, statusCode, isOperational=true (as 'not found' is often an expected outcome), and handles stack
        super('NotFoundError', message, statusCode, true, stack);
    }
}

export default NotFoundError;
