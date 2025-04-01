// src/routes/calls.js
import dotenv from 'dotenv';
import express from 'express';
import twilio from 'twilio';
import { logToFirebase } from '../utils/firebase.js';
import { elevenLabsTextToSpeech } from '../services/elevenLabsService.js';

dotenv.config();
const router = express.Router();
const ngrokUrl = process.env.NGROK_URL;
const twilioClient = new twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

const reminderText =
    'Hello, this is a reminder from your healthcare provider to confirm your medications for the day. Please confirm if you have taken your Aspirin, Cardivol, and Metformin today.';
const unansweredText =
    "We called to check on your medication but couldn't reach you. Please call us back or take your medications if you haven't done so.";

router.post('/call', async (req, res) => {
    const { phoneNumber } = req.body;

    const call = await twilioClient.calls.create({
        to: phoneNumber,
        from: process.env.TWILIO_PHONE_NUMBER_TOLL_FREE, // maybe change to just TWILIO_PHONE_NUMBER before live
        url: `${ngrokUrl}/answered`,
        statusCallback: `${ngrokUrl}/call-status`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        machineDetection: 'DetectMessageEnd',
        record: 'true',
        recordingStatusCallback: `${ngrokUrl}/handle-recording`,
    });

    await logToFirebase(call.sid, {
        event: 'call_initiated',
        phoneNumber,
    });

    return res.send({
        CallSid: call.sid,
        message: 'Call initiated.',
    });
});

router.post('/answered', async (req, res) => {
    const { CallSid, AnsweredBy } = req.body;
    const twiml = new twilio.twiml.VoiceResponse();

    console.log(`Call SID: ${CallSid}, AnsweredBy: ${AnsweredBy}`);

    if (AnsweredBy === 'human') {
        //// DO NOT DELETE - UNREM BEFORE LIVE
        // const textToSpeak = `${new Date().toLocaleString()}. ${reminderText}`
        // const reminderUrl = await elevenLabsTextToSpeech(textToSpeak)

        const reminderUrl = `${ngrokUrl}/reminder.mpeg`;
        const streamUrl = `wss://${req.headers.host}/live`;
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
    } else if (AnsweredBy === 'machine_end_beep') {
        //// DO NOT DELETE - UNREM BEFORE LIVE
        // const textToSpeak = `${new Date().toLocaleString()}. ${unansweredText}`
        // const voicemailUrl = await elevenLabsTextToSpeech(textToSpeak)

        const voicemailUrl = `${ngrokUrl}/voicemail.mpeg`;
        twiml.play(voicemailUrl);
    } else {
        console.error('Error: AnsweredBy:', AnsweredBy);
    }

    await logToFirebase(CallSid, {
        event: 'call_answered',
        answeredBy: AnsweredBy,
        twiml: twiml.toString(),
    });

    res.type('text/xml');
    res.send(twiml.toString());
});

router.post('/handle-speech', async (req, res) => {
    const { SpeechResult } = req.body;
    console.log('sent to /handle-speech');

    const twiml = new twilio.twiml.VoiceResponse();

    if (SpeechResult) {
        twiml.say('Thank you. Goodbye.');
    } else {
        twiml.say('No speech detected. Please try again.'); // currently this just hangs up, needs to try again
    }

    twiml.hangup();

    // await logToFirebase({ event: 'speech_handled', SpeechResult });

    res.type('text/xml');
    res.send(twiml.toString());
});

router.post('/call-status', async (req, res) => {
    const { CallSid, CallStatus, AnsweredBy, To } = req.body;
    console.log(`Call SID: ${CallSid}, Status: ${CallStatus}`);

    ////////////////// is this the correct condition for sending a text??? ///////////////////
    if (CallStatus === 'completed' && AnsweredBy === 'unknown') {
        console.log(
            `Call SID: ${CallSid}, Status: ${CallStatus}, AnsweredBy: ${AnsweredBy}`
        );

        const smsClient = new twilio(
            process.env.TWILIO_ACCOUNT_SID,
            process.env.TWILIO_AUTH_TOKEN
        );

        smsClient.messages
            .create({
                body: unansweredText,
                to: To,
                from: process.env.TWILIO_PHONE_NUMBER_PAID, // maybe change to just TWILIO_PHONE_NUMBER before live
            })
            .then(sms => {
                const status = 'SMS text sent.';
                console.log({
                    CallSid,
                    smsSid: sms.sid,
                    smsBody: sms,
                    status,
                });
                res.send({
                    CallSid,
                    smsSid: sms.sid,
                    message: status,
                });
            })
            .catch(error => {
                console.error('Error sending SMS:', error);
                res.status(500).send({ error: 'Failed to send SMS' });
            });

        await logToFirebase(CallSid, {
            event: 'call_status_update',
            status: CallStatus,
            answeredBy: AnsweredBy,
            to: To,
        });
    } else {
        res.sendStatus(200);
    }
});

router.post('/handle-recording', async (req, res) => {
    console.log('sent to /handle-recording');

    const { CallSid, RecordingUrl, RecordingSid, RecordingDuration } = req.body;

    if (RecordingSid && RecordingUrl) {
        const status = 'Recording processed.';

        await logToFirebase(CallSid, {
            event: 'recording_handled',
            recordingUrl: RecordingUrl,
            recordingSid: RecordingSid,
            duration: RecordingDuration,
        });

        res.send({
            CallSid,
            RecordingSid,
            message: status,
        });
    } else {
        const status = 'Error processing recording.';
        console.log({
            CallSid,
            RecordingSid,
            status,
        });
        res.send({
            CallSid,
            RecordingSid,
            message: status,
        });
    }
});

export default router;
