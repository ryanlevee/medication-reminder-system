/*
file: C:\Users\ryanl\Documents\Coding\medication-reminder-system\src/routes/incomingCalls.js
*/
import dotenv from 'dotenv';
import express from 'express';
import twilio from 'twilio';
import InternalServerError from '../errors/InternalServerError.js';
import { logErrorToFirebase, logToFirebase } from '../utils/firebase.js';

dotenv.config();
const router = express.Router();
const ngrokUrl = process.env.NGROK_URL;

router.post('/incoming-call', async (req, res) => {
    console.log('sent to /incoming-call');
    const { CallSid, From } = req.body;

    const reminderUrl = `${ngrokUrl}/reminder.mpeg`;
    const streamUrl = `wss://${req.headers.host}/live`;

    const twiml = new twilio.twiml.VoiceResponse();
    const stream = twiml.start().stream({ url: streamUrl });
    stream.parameter({ name: 'CallSid', value: CallSid });
    twiml.play(reminderUrl);

    const gather = twiml.gather({
        input: 'speech',
        speechTimeout: 2,
        maxSpeechTime: 12,
        action: '/handle-speech',
    });

    const beepUrl = `${ngrokUrl}/beep.mpeg`;
    gather.play(beepUrl);

    try {
        await logToFirebase(CallSid, {
            event: 'call_incoming',
            from: From,
        });
    } catch (error) {
        console.error('Error logging incoming call:', error);
        await logErrorToFirebase(
            'incomingCalls',
            new InternalServerError(
                'Error logging incoming call to Firebase',
                500,
                error.stack
            )
        );
        // Decide if this error should prevent the Twilio response.
        // For now, we'll log and continue.
    }

    res.type('text/xml');
    res.send(twiml.toString());
});

export default router;
