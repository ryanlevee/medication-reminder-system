// src/errors/NotFoundError.js
import BaseError from './BaseError.js';

class NotFoundError extends BaseError {
    constructor(message = 'Not Found', statusCode = 404, stack) {
        super('NotFoundError', message, statusCode, true, stack);
    }
}

export default NotFoundError;
