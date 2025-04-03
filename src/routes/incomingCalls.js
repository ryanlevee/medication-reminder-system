import dotenv from 'dotenv';
import express from 'express';
import twilio from 'twilio';
import InternalServerError from '../errors/InternalServerError.js';
import { elevenLabsTextToSpeech } from '../services/elevenLabsService.js';
import { TtsHolder } from '../storage/ttsHolder.js';
import { logErrorToFirebase, logToFirebase } from '../utils/firebase.js';

dotenv.config();
const router = express.Router();
const ngrokUrl = process.env.NGROK_URL;

router.post('/incoming-call', async (req, res) => {
    console.log('sent to /incoming-call');
    const { CallSid, From, To } = req.body;

    const textToSpeakToHuman = TtsHolder.reminder;
    const reminderFileName = 'reminder.mpeg';
    const reminderUrl = await elevenLabsTextToSpeech(
        textToSpeakToHuman,
        reminderFileName
    );
    // const reminderUrl = `${ngrokUrl}/reminder.mpeg`;  // use static file for testing

    const streamUrl = `wss://${req.headers.host}/live`;
    const twiml = new twilio.twiml.VoiceResponse();
    const stream = twiml.start().stream({ url: streamUrl });
    stream.parameter({ name: 'CallSid', value: CallSid });
    twiml.play(reminderUrl);

    const gather = twiml.gather({
        input: 'speech',
        speechTimeout: 2,
        maxSpeechTime: 12,
        action: '/handle-speech?retry=0',
    });

    const beepUrl = `${ngrokUrl}/beep.mpeg`;
    gather.play(beepUrl);

    try {
        const status = 'Incoming call.';
        await logToFirebase(CallSid, {
            event: 'call_incoming',
            status,
            from: From,
            to: To,
        });
    } catch (error) {
        const status = `Error logging incoming call: ${error}`;
        consoleLogCall({ callSid: CallSid, status });
        await logErrorToFirebase(
            'incomingCalls',
            new InternalServerError(
                'Error logging incoming call to Firebase',
                500,
                error.stack
            )
        );
    }

    res.type('text/xml');
    res.send(twiml.toString());
});

export default router;
