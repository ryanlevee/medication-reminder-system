import admin from 'firebase-admin';
import FirebaseError from '../errors/FirebaseError.js';

const db = admin.database();

async function logToFirebase(callSid, logData) {
    console.log('Logging call data to Firebase:', { callSid, logData });

    try {
        const logsRef = db.ref(`logs/${callSid}`);
        await logsRef.push({
            timestamp: admin.database.ServerValue.TIMESTAMP,
            ...logData,
        });
    } catch (error) {
        console.error('Error writing to Firebase:', error);
        throw new FirebaseError('Error writing to Firebase', 500, error.stack);
    }
}

async function logErrorToFirebase(callSid, error) {
    try {
        const errorLogsRef = db.ref(`errors/${callSid}`);
        await errorLogsRef.push({
            timestamp: admin.database.ServerValue.TIMESTAMP,
            name: error.name,
            message: error.message,
            stack: error.stack,
        });
        console.error(
            `Error logged to Firebase for CallSid ${callSid}:`,
            error.message
        );
    } catch (firebaseError) {
        console.error('Error writing error log to Firebase:', firebaseError);
        throw new FirebaseError(
            'Error writing error log to Firebase',
            500,
            firebaseError.stack
        );
    }
}

export { logToFirebase, logErrorToFirebase };
