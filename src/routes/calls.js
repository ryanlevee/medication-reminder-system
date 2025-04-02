import { v4 as uuidv4 } from 'uuid'; // For unique filenames
import dotenv from 'dotenv';
import express from 'express';
import twilio from 'twilio';
import { logToFirebase, logErrorToFirebase } from '../utils/firebase.js';
import { generateLlmResponse } from '../services/geminiService.js'; // Ensure this points to your service file
import { elevenLabsTextToSpeech } from '../services/elevenLabsService.js';
import TwilioApiError from '../errors/TwilioApiError.js';
import InternalServerError from '../errors/InternalServerError.js';
import BadRequestError from '../errors/BadRequestError.js';
import { consoleLogCall } from '../utils/consoleLogCall.js';

const callHistories = new Map();

dotenv.config();
const router = express.Router();
const ngrokUrl = process.env.NGROK_URL;
const twilioClient = new twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

const reminderText =
    'Hello, this is a reminder from your healthcare provider to confirm your medications for the day. Please confirm if you have taken your Aspirin, Cardivol, and Metformin today. If you have any questions regarding your medication, please ask after the tone.';
const unansweredText =
    "We called to check on your medication but couldn't reach you. Please call us back or take your medications if you haven't done so.";

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
            // Decide if this is critical enough to impact the call initiation response.
            // For now, log and continue.
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
                    action: '/handle-speech?retry=0',
                    actionOnEmptyResult: true,
                });
                const beepUrl = `${ngrokUrl}/beep.mpeg`;
                gather.play(beepUrl);
                break;
            case 'machine_end_beep':
            case 'machine_end_silence':
            case 'machine_end_other':
                //// DO NOT DELETE - UNREM BEFORE LIVE
                // const textToSpeak = `${new Date().toLocaleString()}. ${unansweredText}`
                // const voicemailUrl = await elevenLabsTextToSpeech(textToSpeak)

                const voicemailUrl = `${ngrokUrl}/voicemail.mpeg`;
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
            // Decide if this is critical. For now, log and continue.
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

const MAX_RETRIES = 2; // Allow 2 retries after the initial attempt (total 3 tries)
const MAX_CONVERSATION_TURNS = 5; // Define the maximum number of system responses
const FINAL_CLOSING_MESSAGE =
    'If you have any further questions, please consult your doctor or pharmacist. Goodbye.';
// --- Updated /handle-speech for Multi-Turn with 5-Turn Limit ---
router.post('/handle-speech', async (req, res) => {
    const { CallSid, SpeechResult } = req.body;
    const currentRetry = parseInt(req.query.retry || '0', 10);
    // console.log(`Handling speech/gather result for ${CallSid} (Retry attempt ${currentRetry + 1})`); // Keep this log if useful

    const twiml = new twilio.twiml.VoiceResponse();
    let llmText = null;
    let ttsAudioUrl = null; // Keep commented for testing
    let logData = {
        event: 'handle_speech_turn',
        retryAttempt: currentRetry + 1,
    };

    // --- Retrieve History & Calculate Turn Number ---
    let currentHistoryData = callHistories.get(CallSid) || {
        history: [],
        lastUpdated: Date.now(),
    };
    let currentHistory = currentHistoryData.history;
    // A "turn" is counted after the system responds.
    // History length 0 = start of turn 1. History length 2 = start of turn 2. History length 8 = start of turn 5.
    const turnNumber = Math.floor(currentHistory.length / 2) + 1;
    logData.turn = turnNumber;
    logData.speechResult = SpeechResult || '[No speech detected]'; // Add speech result here now we have turn context

    console.log(
        `Handling Turn ${turnNumber} for ${CallSid} (Retry attempt ${currentRetry + 1})`
    );

    try {
        // --- Step 1: Handle Retries for SILENCE on this turn ---
        if (!SpeechResult && currentRetry < MAX_RETRIES) {
            console.log(
                `No speech detected for ${CallSid}, retrying turn (Attempt ${currentRetry + 1})`
            );
            const nextRetry = currentRetry + 1;
            // Ask again or give a generic prompt
            twiml.say(
                "Sorry, I didn't hear anything. Could you please repeat that?"
            );
            const gather = twiml.gather({
                input: 'speech',
                speechTimeout: 1,
                maxSpeechTime: 12,
                action: `/handle-speech?retry=${nextRetry}`, // Point back with incremented retry
                actionOnEmptyResult: true,
            });
            const beepUrl = `${ngrokUrl}/beep.mpeg`;
            gather.play(beepUrl);
            twiml.say("If you're finished, you can hang up. Goodbye."); // Fallback after retry gather
            twiml.hangup();

            res.type('text/xml');
            return res.send(twiml.toString()); // Exit early for retry
        }

        // --- If speech exists OR max retries for this turn's silence were reached ---
        console.log(
            `Proceeding with LLM for ${CallSid}. Turn ${logData.turn}. Input: "${SpeechResult || '[Max retries - No speech]'}"`
        );

        // --- Step 2: Generate LLM Response (passing history) ---
        const { llmText: generatedText, updatedHistory } =
            await generateLlmResponse(SpeechResult, currentHistory);
        llmText = generatedText; // Assign to outer scope variable

        // --- Store Updated History ---
        // Store history regardless of turn number, so we have the full record
        callHistories.set(CallSid, {
            history: updatedHistory,
            lastUpdated: Date.now(),
        });
        logData.llm_model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
        logData.llm_response_text = llmText; // Log the raw LLM response
        console.log(`LLM Text (Turn ${turnNumber}) for ${CallSid}: ${llmText}`);

        // --- Step 3: Check for Hangup Conditions (Turn Limit OR LLM Flag) ---
        let hangup = false;
        let spokenText = llmText; // Text to actually say/TTS

        if (turnNumber >= MAX_CONVERSATION_TURNS) {
            // --- Enforce Turn Limit ---
            console.log(
                `Max turns (${MAX_CONVERSATION_TURNS}) reached for ${CallSid}. Overriding LLM response.`
            );
            spokenText = FINAL_CLOSING_MESSAGE; // Use the specific closing message
            hangup = true; // Force hangup
        } else if (llmText && llmText.includes('HANGUPNOW')) {
            // --- Check for LLM Hangup Flag (only if turn limit not reached) ---
            hangup = true;
            spokenText = llmText.replace(' HANGUPNOW', '').trim(); // Remove flag for speaking
            console.log(
                `Hangup flag detected for ${CallSid} before max turns.`
            );
        }

        // Defensive check for empty text after potential flag removal
        if (!spokenText) {
            console.warn(
                `Spoken text is empty for ${CallSid}. Using fallback.`
            );
            spokenText = hangup
                ? 'Okay. Goodbye.'
                : 'Sorry, I encountered an issue.'; // Use appropriate fallback
            // If text was *only* HANGUPNOW, ensure hangup is true
            if (llmText === 'HANGUPNOW') hangup = true;
        }
        logData.llm_spoken_text = spokenText; // Log the text actually intended for speech
        logData.will_hangup = hangup;

        // --- Step 4: Generate TTS Audio (Commented out for testing) ---
        ttsAudioUrl = null; // Ensure null for testing
        /* // Keep this block ready for uncommenting
        if (spokenText) {
            const uniqueFileName = `tts-${CallSid}-${uuidv4()}.mpeg`;
            try {
                console.log(`Requesting TTS for: "${spokenText}"`);
                ttsAudioUrl = await elevenLabsTextToSpeech(
                    elevenLabsVoiceId, spokenText, uniqueFileName
                );
                logData.tts_audio_url = ttsAudioUrl;
                console.log(`TTS Audio URL for ${CallSid}: ${ttsAudioUrl}`);
            } catch (ttsError) { // ... (keep TTS error handling) ... }
        }
        */

        // --- Step 5: Generate TwiML Response ---
        if (ttsAudioUrl) {
            // --- Keep commented out logic structure ---
            // console.log(`Generating TwiML to PLAY ${ttsAudioUrl}`);
            // twiml.play(ttsAudioUrl);
        } else {
            console.log(`Generating TwiML to SAY "${spokenText}"`);
            twiml.say(spokenText); // Use <Say> during testing, using the final spokenText
        }

        if (hangup) {
            console.log(`TwiML: Adding <Hangup> for ${CallSid}`);
            twiml.hangup();
            logData.final_twiML_action = ttsAudioUrl
                ? 'Play + Hangup'
                : 'Say + Hangup';
        } else {
            // --- Add Gather for the NEXT turn ---
            console.log(
                `TwiML: Adding <Gather> for next turn (${turnNumber + 1}) for ${CallSid}`
            );
            const gather = twiml.gather({
                input: 'speech',
                speechTimeout: 2,
                maxSpeechTime: 12,
                action: `/handle-speech?retry=0`, // Loop back, RESET retry count for the new turn
                actionOnEmptyResult: true,
            });

            const beepUrl = `${ngrokUrl}/beep.mpeg`;
            gather.play(beepUrl);
            // Fallback if the user goes silent on the NEXT turn's gather
            twiml.say(
                'Is there anything else? If not, you can hang up now. Goodbye.'
            );
            twiml.hangup();
            logData.final_twiML_action = ttsAudioUrl
                ? 'Play + Gather'
                : 'Say + Gather';
        }

        // --- Final Logging & Response ---
        logData.event = 'handle_speech_processed'; // Final event status for log
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

// router.post('/handle-speech', async (req, res) => {
//     const { CallSid, SpeechResult } = req.body;
//     const currentRetry = parseInt(req.query.retry || '0', 10);
//     console.log(`sent to /handle-speech (Attempt ${currentRetry + 1})`);

//     const twiml = new twilio.twiml.VoiceResponse();

//     try {
//         if (SpeechResult) {
//             console.log({ SpeechResult });
//             twiml.say('Thank you. Goodbye.');
//         } else {
//             console.log(
//                 `No speech detected for ${CallSid} on attempt ${currentRetry + 1}`
//             );
//             if (currentRetry < MAX_RETRIES) {
//                 // If we haven't reached max retries, try again
//                 const nextRetry = currentRetry + 1;
//                 twiml.say(
//                     'No speech detected. Please try again after the beep.'
//                 );
//                 const gather = twiml.gather({
//                     input: 'speech',
//                     speechTimeout: 2, // Use same timeouts
//                     maxSpeechTime: 12, // Point back to this handler, incrementing the retry count
//                     action: `/handle-speech?retry=${nextRetry}`,
//                     actionOnEmptyResult: true,
//                 }); // Play the beep again to signal listening
//                 const beepUrl = `${ngrokUrl}/beep.mpeg`;
//                 gather.play(beepUrl); // Add a fallback if gather itself fails unexpectedly after retrying

//                 // Although typically if gather fails, Twilio proceeds with verbs after it
//                 twiml.say("Sorry, I'm having trouble hearing you. Goodbye.");
//                 twiml.hangup();
//             } else {
//                 // Max retries reached
//                 console.log(`Max retries reached for ${CallSid}. Hanging up.`);
//                 twiml.say('Sorry, I still could not understand you. Goodbye.');
//                 twiml.hangup();
//             }
//         }
//         res.type('text/xml');
//         res.send(twiml.toString());
//     } catch (error) {
//         console.error('Error handling speech:', error);
//         consoleLogCall({ callSid: CallSid, status: error });
//         await logErrorToFirebase(
//             'calls',
//             new InternalServerError(
//                 'Error processing speech input.',
//                 500,
//                 error.stack
//             )
//         );
//         res.status(500).send({ message: 'Error processing speech input.' });
//     }
// });

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
                // Log and continue.
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
    }
    // else {
    //     res.sendStatus(200);
    // }
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
                // Log and continue.
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
        await logErrorToFirebase('calls', error); // Could be BadRequestError or unexpected
        consoleLogCall({ callSid: CallSid, status: error });
        res.status(error.statusCode || 500).send({
            message: error.message || 'Error processing recording data.',
        });
    }
});

export default router;
