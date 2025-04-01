/*
file: C:\Users\ryanl\Documents\Coding\medication-reminder-system\src\utils/firebase.js
*/
import admin from 'firebase-admin';

const db = admin.database();

async function logToFirebase(callSid, logData) {
    try {
        const logsRef = db.ref(`logs/${callSid}`);
        await logsRef.push({
            timestamp: admin.database.ServerValue.TIMESTAMP,
            ...logData,
        });
        console.log('Data logged to Firebase:', logData);
    } catch (error) {
        console.error('Error writing to Firebase:', error);
        // Consider throwing a custom FirebaseError here if you want to handle
        // Firebase logging failures in the calling functions.
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
    }
}

export { logToFirebase, logErrorToFirebase };
