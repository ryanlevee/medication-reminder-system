import BaseError from './BaseError.js';

class BadRequestError extends BaseError {
    constructor(message = 'Bad Request', statusCode = 400, stack) {
        super('BadRequestError', message, statusCode, true, stack);
    }
}

export default BadRequestError;
