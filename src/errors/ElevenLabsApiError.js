// src/errors/ElevenLabsApiError.js
import BaseError from './BaseError.js';

class ElevenLabsApiError extends BaseError {
    constructor(message = 'ElevenLabs API Error', statusCode = 500, stack) {
        super('ElevenLabsApiError', message, statusCode, true, stack);
    }
}

export default ElevenLabsApiError;
