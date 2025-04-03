/**
 * @fileoverview Defines the FirebaseError class for handling errors related to Firebase operations.
 * This error should be thrown when interactions with Firebase services (like Realtime Database) fail.
 *
 * @requires ./BaseError - The base custom error class.
 */

import BaseError from './BaseError.js';

/**
 * Represents an error originating from Firebase services or the interaction with them.
 * Typically used when database reads/writes or other Firebase operations fail.
 * Inherits from BaseError and sets the status code to 500 (Internal Server Error)
 * by default, assuming the failure is often related to backend or service issues.
 *
 * @class FirebaseError
 * @extends {BaseError}
 */
class FirebaseError extends BaseError {
    /**
     * Creates an instance of FirebaseError.
     *
     * @param {string} [message='Firebase Error'] - The error message. Defaults to 'Firebase Error'.
     * @param {number} [statusCode=500] - The HTTP status code. Defaults to 500.
     * @param {string} [stack] - Optional stack trace. If not provided, it will be captured.
     */
    constructor(message = 'Firebase Error', statusCode = 500, stack) {
        // Call the BaseError constructor
        // Sets name='FirebaseError', message, statusCode, isOperational=true (indicating a known integration point failure), and handles stack
        super('FirebaseError', message, statusCode, true, stack);
    }
}

export default FirebaseError;
