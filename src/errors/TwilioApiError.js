import BaseError from './BaseError.js';

class TwilioApiError extends BaseError {
    constructor(message = 'Twilio API Error', statusCode = 500, stack) {
        super('TwilioApiError', message, statusCode, true, stack);
    }
}

export default TwilioApiError;
