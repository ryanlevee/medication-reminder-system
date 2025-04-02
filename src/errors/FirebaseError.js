import BaseError from './BaseError.js';
import serviceAccount from '../private/medication-reminder-syst-aa149-firebase-adminsdk-fbsvc-65cf0d6678.json' with { type: 'json' };
import admin from 'firebase-admin';

// admin.initializeApp({
//     credential: admin.credential.cert(serviceAccount),
//     databaseURL: process.env.FIREBASE_DATABASE_URL,
// });

class FirebaseError extends BaseError {
    constructor(message = 'Firebase Error', statusCode = 500, stack) {
        super('FirebaseError', message, statusCode, true, stack);
    }
}

export default FirebaseError;
