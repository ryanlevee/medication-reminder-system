import dotenv from 'dotenv';
import express from 'express';
import twilio from 'twilio';
import { v4 as uuidv4 } from 'uuid';
import BadRequestError from '../errors/BadRequestError.js';
import InternalServerError from '../errors/InternalServerError.js';
import TwilioApiError from '../errors/TwilioApiError.js';
import { elevenLabsTextToSpeech } from '../services/elevenLabsService.js';
import { generateLlmResponse } from '../services/geminiService.js';
import { TtsHolder } from '../storage/ttsHolder.js';
import { consoleLogCall } from '../utils/consoleLogCall.js';
import { logErrorToFirebase, logToFirebase } from '../utils/firebase.js';

const callHistories = new Map();

dotenv.config();
const router = express.Router();
const ngrokUrl = process.env.NGROK_URL;
const twilioClient = new twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

router.post('/call', async (req, res) => {
    const { phoneNumber } = req.body;

    try {
        const call = await twilioClient.calls.create({
            to: phoneNumber,
            from: process.env.TWILIO_PHONE_NUMBER_TOLL_FREE,
            url: `${ngrokUrl}/answered`,
            statusCallback: `${ngrokUrl}/call-status`,
            statusCallbackEvent: [
                'initiated',
                'ringing',
                'answered',
                'completed',
            ],
            machineDetection: 'DetectMessageEnd',
            record: 'true',
            recordingStatusCallback: `${ngrokUrl}/handle-recording`,
        });

        try {
            const status = 'Call Initiated.';
            await logToFirebase(call.sid, {
                event: 'call_initiated',
                status,
                phoneNumber,
            });
        } catch (firebaseError) {
            console.error('Error logging to Firebase:', firebaseError);
        }

        return res.send({
            CallSid: call.sid,
            message: 'Call initiated.',
        });
    } catch (error) {
        console.error('Error initiating call:', error);
        consoleLogCall({ callSid: CallSid, status: error });
        await logErrorToFirebase(
            'calls',
            new TwilioApiError('Error initiating call', 500, error.stack)
        );
        return res.status(500).json({ message: 'Failed to initiate call.' });
    }
});

router.post('/answered', async (req, res) => {
    const { CallSid, AnsweredBy } = req.body;
    const twiml = new twilio.twiml.VoiceResponse();

    console.log(`Call SID: ${CallSid}, AnsweredBy: ${AnsweredBy}`);

    try {
        switch (AnsweredBy) {
            case 'human':
                const textToSpeakToHuman = TtsHolder.reminder;
                const reminderUrl =
                    await elevenLabsTextToSpeech(textToSpeakToHuman);

                const streamUrl = `wss://${req.headers.host}/live`;
                const stream = twiml.start().stream({ url: streamUrl });
                stream.parameter({ name: 'CallSid', value: CallSid });
                twiml.play(reminderUrl);
                const gather = twiml.gather({
                    input: 'speech',
                    speechTimeout: 2,
                    maxSpeechTime: 12,
                    action: '/handle-speech?retry=0',
                    actionOnEmptyResult: true,
                });
                const beepUrl = `${ngrokUrl}/beep.mpeg`;
                gather.play(beepUrl);
                break;
            case 'machine_end_beep':
            case 'machine_end_silence':
            case 'machine_end_other':
                const textToSpeakToMachine = `${new Date().toLocaleString()}. ${TtsHolder.unanswered}`;
                const voicemailUrl =
                    await elevenLabsTextToSpeech(textToSpeakToMachine);

                twiml.play(voicemailUrl);
                break;
            case 'unknown':
                console.log(
                    `AnsweredBy ${AnsweredBy} '/call-status' route will handle.`
                );
                break;
            case 'fax':
            default:
                const errorMessage = `Unhandled AnsweredBy: ${AnsweredBy}`;
                consoleLogCall({ callSid: CallSid, status: errorMessage });
                await logErrorToFirebase(
                    'calls',
                    new InternalServerError(errorMessage, 500)
                );
                return res.status(500).send({ message: errorMessage });
        }

        try {
            const status = `Call answered by: ${AnsweredBy}`;
            consoleLogCall({ callSid: CallSid, status });
            await logToFirebase(CallSid, {
                event: 'call_answered',
                status,
                twiml: twiml.toString(),
            });
        } catch (firebaseError) {
            console.error('Error logging to Firebase:', firebaseError);
        }
        res.type('text/xml');
        res.send(twiml.toString());
    } catch (error) {
        console.error('Error handling answered call:', error);
        consoleLogCall({ callSid: CallSid, status: error });
        await logErrorToFirebase(
            'calls',
            new InternalServerError(
                'Error processing answered call.',
                500,
                error.stack
            )
        );
        res.status(500).send({ message: 'Error processing answered call.' });
    }
});

const MAX_RETRIES = 2;
const MAX_CONVERSATION_TURNS = 10;
const FINAL_CLOSING_MESSAGE =
    'If you have any further questions, please consult your doctor or pharmacist. Goodbye.';
router.post('/handle-speech', async (req, res) => {
    const { CallSid, SpeechResult } = req.body;
    const currentRetry = parseInt(req.query.retry || '0', 10);

    const twiml = new twilio.twiml.VoiceResponse();
    let llmText = null;
    let ttsAudioUrl = null;
    let logData = {
        event: 'handle_speech_turn',
        retryAttempt: currentRetry + 1,
    };

    let currentHistoryData = callHistories.get(CallSid) || {
        history: [],
        lastUpdated: Date.now(),
    };
    let currentHistory = currentHistoryData.history;

    const turnNumber = Math.floor(currentHistory.length / 2) + 1;
    logData.turn = turnNumber;
    logData.speechResult = SpeechResult || '[No speech detected]';

    console.log(
        `Handling Turn ${turnNumber} for ${CallSid} (Retry attempt ${currentRetry + 1})`
    );

    try {
        if (!SpeechResult && currentRetry < MAX_RETRIES) {
            console.log(
                `No speech detected for ${CallSid}, retrying turn (Attempt ${currentRetry + 1})`
            );
            const nextRetry = currentRetry + 1;

            twiml.say(
                "Sorry, I didn't hear anything. Could you please repeat that?"
            );
            const gather = twiml.gather({
                input: 'speech',
                speechTimeout: 1,
                maxSpeechTime: 12,
                action: `/handle-speech?retry=${nextRetry}`,
                actionOnEmptyResult: true,
            });
            const beepUrl = `${ngrokUrl}/beep.mpeg`;
            gather.play(beepUrl);
            twiml.say("If you're finished, you can hang up. Goodbye.");
            twiml.hangup();

            res.type('text/xml');
            return res.send(twiml.toString());
        }

        console.log(
            `Proceeding with LLM for ${CallSid}. Turn ${logData.turn}. Input: "${SpeechResult || '[Max retries - No speech]'}"`
        );

        const { llmText: generatedText, updatedHistory } =
            await generateLlmResponse(SpeechResult, currentHistory);
        llmText = generatedText;

        callHistories.set(CallSid, {
            history: updatedHistory,
            lastUpdated: Date.now(),
        });
        logData.llm_model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
        logData.llm_response_text = llmText;
        console.log(`LLM Text (Turn ${turnNumber}) for ${CallSid}: ${llmText}`);

        let hangup = false;
        let spokenText = llmText;

        if (turnNumber >= MAX_CONVERSATION_TURNS) {
            console.log(
                `Max turns (${MAX_CONVERSATION_TURNS}) reached for ${CallSid}. Overriding LLM response.`
            );
            spokenText = FINAL_CLOSING_MESSAGE;
            hangup = true;
        } else if (llmText && llmText.includes('HANGUPNOW')) {
            hangup = true;
            spokenText = llmText.replace(' HANGUPNOW', '').trim();
            console.log(
                `Hangup flag detected for ${CallSid} before max turns.`
            );
        }

        if (!spokenText) {
            console.warn(
                `Spoken text is empty for ${CallSid}. Using fallback.`
            );
            spokenText = hangup
                ? 'Okay. Goodbye.'
                : 'Sorry, I encountered an issue.';

            if (llmText === 'HANGUPNOW') hangup = true;
        }
        logData.llm_spoken_text = spokenText;
        logData.will_hangup = hangup;

        if (spokenText) {
            const uniqueFileName = `tts-${CallSid}-${uuidv4()}.mpeg`;
            try {
                console.log(`Requesting TTS for: "${spokenText}"`);
                ttsAudioUrl = await elevenLabsTextToSpeech(
                    spokenText,
                    uniqueFileName
                );
                logData.tts_audio_url = ttsAudioUrl;
                console.log(`TTS Audio URL for ${CallSid}: ${ttsAudioUrl}`);
            } catch (ttsError) {
                console.error('Error handling speech:', ttsError);
                await logErrorToFirebase(
                    'calls',
                    new InternalServerError(
                        'Error processing speech input.',
                        500,
                        error.stack
                    )
                );
                res.status(500).send({
                    message: 'Error processing speech input.',
                });
            }
        }

        if (ttsAudioUrl) {
            console.log(`Generating TwiML to PLAY ${ttsAudioUrl}`);
            twiml.play(ttsAudioUrl);
        } else {
            console.log(`Generating TwiML to SAY "${spokenText}"`);
            twiml.say(spokenText);
        }

        if (hangup) {
            console.log(`TwiML: Adding <Hangup> for ${CallSid}`);
            twiml.hangup();
            logData.final_twiML_action = ttsAudioUrl
                ? 'Play + Hangup'
                : 'Say + Hangup';
        } else {
            console.log(
                `TwiML: Adding <Gather> for next turn (${turnNumber + 1}) for ${CallSid}`
            );
            const gather = twiml.gather({
                input: 'speech',
                speechTimeout: 2,
                maxSpeechTime: 12,
                action: `/handle-speech?retry=0`,
                actionOnEmptyResult: true,
            });

            const beepUrl = `${ngrokUrl}/beep.mpeg`;
            gather.play(beepUrl);

            twiml.say(
                'Is there anything else? If not, you can hang up now. Goodbye.'
            );
            twiml.hangup();
            logData.final_twiML_action = ttsAudioUrl
                ? 'Play + Gather'
                : 'Say + Gather';
        }

        logData.event = 'handle_speech_processed';
        try {
            await logToFirebase(CallSid, logData);
        } catch (logError) {
            console.error('Firebase log error:', logError);
        }
        res.type('text/xml');
        res.send(twiml.toString());
    } catch (error) {
        console.error('Error in /handle-speech main processing block:', error);
        await logErrorToFirebase(
            CallSid || 'unknown_sid',
            new InternalServerError(
                `Error in /handle-speech processing: ${error.message}`,
                500,
                error.stack
            )
        );
        const errorTwiml = new twilio.twiml.VoiceResponse();
        errorTwiml.say('An error occurred. Apologies. Goodbye.');
        errorTwiml.hangup();
        res.type('text/xml');
        res.status(200).send(errorTwiml.toString());
    }
});

router.post('/call-status', async (req, res) => {
    const { CallSid, CallStatus, AnsweredBy, To } = req.body;
    console.log(`Call SID: ${CallSid}, Status: ${CallStatus}`);

    if (CallStatus === 'completed' && AnsweredBy === 'unknown') {
        console.log(
            `Call SID: ${CallSid}, Status: ${CallStatus}, AnsweredBy: ${AnsweredBy}`
        );

        const smsClient = new twilio(
            process.env.TWILIO_ACCOUNT_SID,
            process.env.TWILIO_AUTH_TOKEN
        );

        try {
            const sms = await smsClient.messages.create({
                body: unansweredText,
                to: To,
                from: process.env.TWILIO_PHONE_NUMBER_PAID,
            });
            const status = 'SMS text sent.';
            consoleLogCall(
                { callSid: CallSid, status: CallStatus },
                { smsSid: sms.sid, smsBody: sms }
            );
            res.send({
                CallSid,
                smsSid: sms.sid,
                message: status,
            });

            try {
                const status = `Call status: ${CallStatus}`;
                consoleLogCall({ callSid: CallSid, status: CallStatus });
                await logToFirebase(CallSid, {
                    event: 'call_status_update',
                    status,
                    answeredBy: AnsweredBy,
                    to: To,
                });
            } catch (firebaseError) {
                console.error(
                    'Error logging call status to Firebase:',
                    firebaseError
                );
            }
        } catch (error) {
            console.error('Error sending SMS:', error);
            consoleLogCall({ callSid: CallSid, status: error });
            await logErrorToFirebase(
                'calls',
                new TwilioApiError('Error sending SMS', 500, error.stack)
            );
            res.status(500).send({ error: 'Failed to send SMS.' });
        }
    } else {
        return false;
    }
});

router.post('/handle-recording', async (req, res) => {
    console.log('sent to /handle-recording');
    const { CallSid, RecordingUrl, RecordingSid, RecordingDuration } = req.body;

    try {
        if (RecordingSid && RecordingUrl) {
            const status = 'Recording processed.';
            try {
                consoleLogCall(
                    { callSid: CallSid, status },
                    { recordingSid: RecordingSid }
                );
                await logToFirebase(CallSid, {
                    event: 'recording_handled',
                    callSid: CallSid,
                    recordingUrl: RecordingUrl,
                    recordingSid: RecordingSid,
                    duration: RecordingDuration,
                    status,
                });
            } catch (firebaseError) {
                console.error(
                    'Error logging recording info to Firebase:',
                    firebaseError
                );
            }
            res.send({
                CallSid,
                RecordingSid,
                message: status,
            });
        } else {
            const status = 'Error processing recording.';
            consoleLogCall({ CallSid, status }, { RecordingSid });
            throw new BadRequestError(status);
        }
    } catch (error) {
        console.error('Error handling recording:', error);
        await logErrorToFirebase('calls', error);
        consoleLogCall({ callSid: CallSid, status: error });
        res.status(error.statusCode || 500).send({
            message: error.message || 'Error processing recording data.',
        });
    }
});

export default router;
