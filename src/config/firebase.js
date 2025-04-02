import admin from 'firebase-admin';
import serviceAccount from '../private/medication-reminder-syst-aa149-firebase-adminsdk-fbsvc-65cf0d6678.json' with { type: 'json' };
import dotenv from 'dotenv';

dotenv.config();

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
});

export { admin };
