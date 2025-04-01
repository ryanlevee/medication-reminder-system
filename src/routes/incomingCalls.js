// src/routes/incomingCalls.js
import dotenv from 'dotenv';
import express from 'express';
import twilio from 'twilio';
import { logToFirebase } from '../utils/firebase.js';

dotenv.config();
const router = express.Router();
const ngrokUrl = process.env.NGROK_URL;

//////////// CURRENTLY does not log in Firebase or record the user, just streams and logs the transcript ///////////
router.post('/incoming-call', async (req, res) => {
    console.log('sent to /incoming-call');
    const { CallSid, From } = req.body;

    //// DO NOT DELETE - UNREM BEFORE LIVE
    // const textToSpeak = `${new Date().toLocaleString()}. ${reminderText}`
    // const reminderUrl = await elevenLabsTextToSpeech(textToSpeak)

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

    await logToFirebase(CallSid, {
        event: 'call_incoming',
        from: From,
    });

    res.type('text/xml');
    res.send(twiml.toString());
});

export default router;
