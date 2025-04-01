// src/errors/FirebaseError.js
import BaseError from './BaseError.js';

class FirebaseError extends BaseError {
    constructor(message = 'Firebase Error', statusCode = 500, stack) {
        super('FirebaseError', message, statusCode, true, stack);
    }
}

export default FirebaseError;
