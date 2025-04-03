import BaseError from './BaseError.js';

class InternalServerError extends BaseError {
    constructor(message = 'Internal Server Error', statusCode = 500, stack) {
        super('InternalServerError', message, statusCode, false, stack);
    }
}

export default InternalServerError;
