/**
 * @fileoverview Defines the base error class for the application.
 * This class should be extended by other custom error classes
 * to provide a consistent structure for error handling throughout the application.
 */

/**
 * Represents a base error for the application.
 * This class provides a consistent structure for custom errors,
 * including a name, message, status code, and an indicator of whether
 * the error is operational (i.e., caused by a predictable event
 * like invalid user input).  It also captures the stack trace for
 * debugging purposes.
 *
 * @class BaseError
 */
class BaseError extends Error {
    /**
     * Creates an instance of BaseError.
     *
     * @param {string} name - The name of the error.  Should be the name of the
     * specific error class extending BaseError (e.g., 'BadRequestError').
     * @param {string} message - The error message.
     * @param {number} statusCode - The HTTP status code associated with the error.
     * @param {boolean} isOperational - A boolean indicating whether the error is
     * operational (e.g., due to invalid input) or a programming error. Defaults to false.
     * @param {string} [stack] - Optional stack trace.  If not provided, a new stack
     * trace will be captured.
     */
    constructor(name, message, statusCode, isOperational = false, stack) {
        super(message); // Call the Error class constructor with the message

        /**
         * The name of the error.
         * @type {string}
         */
        this.name = name;

        /**
         * The HTTP status code associated with the error.
         * @type {number}
         */
        this.statusCode = statusCode;

        /**
         * A boolean indicating whether the error is operational
         * (e.g., due to invalid input) or a programming error.
         * @type {boolean}
         */
        this.isOperational = isOperational;

        // Capture the stack trace.  If a stack is already provided, use it;
        // otherwise, capture a new stack trace, removing the BaseError
        // constructor from the stack.
        this.stack = stack || new Error().stack.replace(/^Error\n/, ''); // Removes "Error\n"
    }
}

export default BaseError;