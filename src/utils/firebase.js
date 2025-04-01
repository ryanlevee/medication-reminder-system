// src/utils/firebase.js
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
    }
}

export { logToFirebase };