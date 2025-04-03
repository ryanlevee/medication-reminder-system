/**
 * @fileoverview Express router handling core voice call functionalities.
 * This includes initiating outbound calls via the REST API, handling incoming Twilio webhooks
 * for call progress (answered, speech input, status updates, recordings), interacting with
 * TTS (ElevenLabs) and LLM (Gemini) services, and logging call events to Firebase.
 *
 * @requires dotenv - For loading environment variables.
 * @requires express - Web framework for Node.js.
 * @requires twilio - Twilio Node.js helper library.
 * @requires uuid - For generating unique IDs (used for TTS filenames).
 * @requires ../errors/* - Custom error classes.
 * @requires ../services/elevenLabsService - Service for Text-to-Speech.
 * @requires ../services/geminiService - Service for Large Language Model interaction.
 * @requires ../storage/ttsHolder - Holds predefined TTS message strings.
 * @requires ../utils/consoleLogCall - Utility for formatted console logging of call events.
 * @requires ../utils/firebase - Utilities for logging data and errors to Firebase.
 */

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

/**
 * @description In-memory storage for ongoing call conversation histories.
 * Maps CallSid to an object containing the conversation history array (for LLM context)
 * and the last updated timestamp (for potential cleanup).
 * NOTE: This is not persistent and will be lost on server restart.
 * Consider a persistent store (e.g., Redis, Database) for production.
 * @type {Map<string, {history: Array<object>, lastUpdated: number}>}
 */
const callHistories = new Map();

// Load environment variables
dotenv.config();
const router = express.Router();

/**
 * The base URL provided by ngrok for local development tunneling.
 * Loaded from the NGROK_URL environment variable. Essential for Twilio webhooks.
 * @type {string | undefined}
 */
const ngrokUrl = process.env.NGROK_URL;
if (!ngrokUrl) {
    console.error(
        'FATAL ERROR: NGROK_URL environment variable is not set. Webhooks will fail.'
    );
    // Consider exiting if ngrok is essential for operation
    // process.exit(1);
}

/**
 * The initialized Twilio REST client instance.
 * Used for making outbound API calls (e.g., initiating calls, sending SMS).
 * @type {twilio.Twilio}
 */
const twilioClient = new twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

// --- Constants for /handle-speech Logic ---
/** Maximum number of retries if no speech is detected in a turn. */
const MAX_RETRIES = 2;
/** Maximum number of conversation turns (user input + system response cycles) before ending the call. */
const MAX_CONVERSATION_TURNS = 10; // Increased from 5 in original geminiService prompt example
/** Final message played when the conversation reaches MAX_CONVERSATION_TURNS. */
const FINAL_CLOSING_MESSAGE =
    'We seem to have reached the end of our time for this call. If you have any further questions, please consult your doctor or pharmacist. Goodbye.';

// --- Route Definitions ---

/**
 * @route POST /call
 * @description Initiates an outbound voice call to a specified phone number using the Twilio API.
 * Sets up webhooks for call status updates, answer detection, and recording.
 *
 * @param {string} req.body.phoneNumber - The E.164 formatted phone number to call.
 * @returns {object} res - Express response object.
 * On success (call initiated):
 * - Status 200 OK
 * - JSON: `{ CallSid: string, message: 'Call initiated.' }`
 * On error:
 * - Status 500 Internal Server Error
 * - JSON: `{ message: 'Failed to initiate call.' }`
 * @throws {TwilioApiError} If the Twilio API call fails. Logs error to Firebase.
 */
router.post('/call', async (req, res) => {
    const { phoneNumber } = req.body;
    let callSid = 'N/A'; // Placeholder for logging in case create fails early

    if (!phoneNumber) {
        return res
            .status(400)
            .json({ message: 'Missing required body parameter: phoneNumber' });
    }
    // Basic E.164 format check (starts with +, followed by digits) - more robust validation recommended
    if (!/^\+\d+$/.test(phoneNumber)) {
        return res.status(400).json({
            message:
                'Invalid phoneNumber format. Use E.164 (e.g., +1234567890).',
        });
    }

    try {
        console.log(`Initiating call to: ${phoneNumber}`);
        const call = await twilioClient.calls.create({
            to: phoneNumber,
            from: process.env.TWILIO_PHONE_NUMBER_TOLL_FREE, // Ensure this is a valid Twilio number
            url: `${ngrokUrl}/answered`, // Webhook for when the call is answered
            statusCallback: `${ngrokUrl}/call-status`, // Webhook for status updates
            statusCallbackEvent: [
                // Events to trigger statusCallback
                'initiated',
                'ringing',
                'answered',
                'completed',
            ],
            machineDetection: 'DetectMessageEnd', // Enable AMD, detect end of greeting/voicemail
            // machineDetectionTimeout: 5, // Optional: Adjust timeout (default 30s)
            record: true, // Enable recording
            recordingStatusCallback: `${ngrokUrl}/handle-recording`, // Webhook for recording status
            // recordingStatusCallbackEvent: ['completed'], // Only notify when recording is ready
        });
        callSid = call.sid; // Assign actual CallSid

        console.log(`Call initiated successfully. SID: ${callSid}`);

        // Log initiation event to Firebase (non-critical, wrap in try/catch)
        try {
            const status = 'Call Initiated.';
            await logToFirebase(call.sid, {
                event: 'call_initiated',
                status,
                phoneNumber, // Log the target number
                from: process.env.TWILIO_PHONE_NUMBER_TOLL_FREE, // Log the source number
            });
        } catch (firebaseError) {
            console.error(
                `Firebase logging error for ${callSid} (Initiation):`,
                firebaseError
            );
            // Do not fail the request if logging fails, but log the error
        }

        return res.status(200).send({
            // Use 200 for successful initiation
            CallSid: call.sid,
            message: 'Call initiated successfully.',
        });
    } catch (error) {
        console.error(`Error initiating call to ${phoneNumber}:`, error);
        consoleLogCall({
            callSid: callSid,
            status: `Initiation failed: ${error.message}`,
        });

        // Log the specific error to Firebase
        await logErrorToFirebase(
            callSid, // Log against placeholder SID if call.sid was never assigned
            new TwilioApiError(
                `Error initiating call to ${phoneNumber}: ${error.message}`,
                error.status || 500,
                error.stack
            )
        ).catch(logErr =>
            console.error('Failed to log initiation error to Firebase:', logErr)
        );

        // Return a generic error to the client
        return res.status(500).json({ message: 'Failed to initiate call.' });
    }
});

/**
 * @route POST /answered
 * @description Handles the Twilio webhook triggered when an outbound call is answered.
 * Determines if answered by a human or machine (voicemail) based on `AnsweredBy`.
 * - Human: Plays a reminder message via TTS, starts a media stream for STT, and uses <Gather> to collect speech input.
 * - Machine: Plays a specific voicemail message via TTS and hangs up.
 * - Unknown/Fax: Logs the situation; relies on `/call-status` for potential SMS fallback.
 * Generates TwiML response.
 *
 * @param {string} req.body.CallSid - The SID of the answered call.
 * @param {string} req.body.AnsweredBy - Indicates who answered ('human', 'machine_end_beep', 'machine_end_silence', 'machine_end_other', 'unknown', 'fax').
 * @param {object} req.headers - Contains host information needed for WebSocket URL.
 * @returns {void} Sends TwiML response (text/xml).
 * @throws {InternalServerError} If TTS generation fails or an unhandled `AnsweredBy` occurs. Logs error to Firebase.
 */
router.post('/answered', async (req, res) => {
    const { CallSid, AnsweredBy } = req.body;
    const twiml = new twilio.twiml.VoiceResponse();

    console.log(
        `'/answered' webhook received for ${CallSid}. AnsweredBy: ${AnsweredBy}`
    );

    try {
        let statusMessage = `Call answered by: ${AnsweredBy}`;
        let ttsAudioUrl;

        switch (AnsweredBy) {
            case 'human':
                statusMessage =
                    'Call answered by human. Playing reminder and gathering speech.';
                console.log(statusMessage);
                const textToSpeakToHuman = TtsHolder.reminder;
                // Generate unique filename for caching/logging purposes
                const reminderFileName = `reminder-${CallSid}-${uuidv4()}.mpeg`;
                ttsAudioUrl = await elevenLabsTextToSpeech(
                    textToSpeakToHuman,
                    reminderFileName
                );

                // Start WebSocket stream for real-time transcription
                const streamUrl = `wss://${req.headers.host}/live`; // Construct WebSocket URL dynamically
                console.log(`Starting media stream to: ${streamUrl}`);
                const stream = twiml.start().stream({ url: streamUrl });
                // Pass CallSid to WebSocket handler for context
                stream.parameter({ name: 'CallSid', value: CallSid });

                // Play the generated reminder audio
                twiml.play(ttsAudioUrl);

                // Gather subsequent speech input from the user
                const gather = twiml.gather({
                    input: 'speech', // We want speech input
                    speechTimeout: 2, // Seconds of silence before considering input complete
                    // timeout: 5, // Max seconds to wait for any speech (deprecated?)
                    maxSpeechTime: 12, // Max seconds of speech allowed
                    action: '/handle-speech?retry=0', // Webhook to handle the speech result (initial attempt)
                    actionOnEmptyResult: true, // Trigger action even if no speech is detected
                    // language: 'en-US', // Optional: Specify language
                    // hints: 'yes, no, Aspirin, Cardivol, Metformin', // Optional: Provide hints
                });
                // Play a short beep to indicate readiness for input
                const beepUrl = `${ngrokUrl}/beep.mpeg`; // Ensure beep.mpeg exists in /public
                gather.play(beepUrl);

                // If gather times out or finishes, say a default goodbye and hang up
                twiml.say(
                    "If you need more time or didn't get to speak, please call back. Goodbye."
                );
                twiml.hangup();
                break;

            case 'machine_end_beep':
            case 'machine_end_silence':
            case 'machine_end_other':
                statusMessage = `Call answered by machine (${AnsweredBy}). Leaving voicemail.`;
                console.log(statusMessage);
                // Add timestamp to voicemail message for uniqueness if desired
                const textToSpeakToMachine = `${new Date().toLocaleString()}. ${TtsHolder.unanswered}`;
                const voicemailFileName = `voicemail-${CallSid}-${uuidv4()}.mpeg`;
                ttsAudioUrl = await elevenLabsTextToSpeech(
                    textToSpeakToMachine,
                    voicemailFileName
                );

                twiml.play(ttsAudioUrl);
                twiml.hangup(); // Hang up after leaving voicemail
                break;

            case 'unknown':
                // This case often occurs if AMD couldn't determine human/machine before timeout
                // or if the call failed/was busy before answering.
                // The `/call-status` webhook (specifically 'completed' status) will handle sending SMS.
                statusMessage = `Call answered by 'unknown'. No immediate action. Waiting for '/call-status'.`;
                console.log(statusMessage);
                // No TwiML needed here, Twilio hangs up automatically or proceeds based on status.
                // We MUST send a valid response though, even if empty.
                break;

            case 'fax':
                statusMessage = `Call answered by fax machine. Hanging up.`;
                console.log(statusMessage);
                twiml.reject({ reason: 'fax' }); // Politely reject fax calls
                break;

            default:
                // Catch any unexpected 'AnsweredBy' values
                statusMessage = `Unhandled AnsweredBy status: ${AnsweredBy}. Hanging up.`;
                console.error(statusMessage);
                twiml.say(
                    'Sorry, an unexpected call status occurred. Goodbye.'
                );
                twiml.hangup();
                // Log this unexpected situation
                await logErrorToFirebase(
                    CallSid,
                    new InternalServerError(statusMessage, 500)
                ).catch(logErr =>
                    console.error(
                        'Failed to log unhandled AnsweredBy error:',
                        logErr
                    )
                );
                // Still send TwiML back
                break;
        }

        // Log the outcome of the /answered webhook (non-critical)
        try {
            consoleLogCall({ callSid: CallSid, status: statusMessage });
            await logToFirebase(CallSid, {
                event: 'call_answered_webhook',
                status: statusMessage,
                answeredBy: AnsweredBy,
                generatedTwiml: twiml.toString(), // Log the TwiML for debugging
                ttsAudioUrl: ttsAudioUrl || 'N/A', // Log the generated TTS URL if applicable
            });
        } catch (firebaseError) {
            console.error(
                `Firebase logging error for ${CallSid} (Answered):`,
                firebaseError
            );
        }

        // Send the TwiML response back to Twilio
        res.type('text/xml');
        res.send(twiml.toString());
    } catch (error) {
        console.error(`Error handling '/answered' for ${CallSid}:`, error);
        consoleLogCall({
            callSid: CallSid,
            status: `Error in /answered: ${error.message}`,
        });

        // Log the specific error to Firebase
        await logErrorToFirebase(
            CallSid,
            new InternalServerError(
                `Error processing answered call webhook for ${CallSid}: ${error.message}`,
                500,
                error.stack
            )
        ).catch(logErr =>
            console.error('Failed to log /answered error to Firebase:', logErr)
        );

        // Send a generic error TwiML response
        const errorTwiml = new twilio.twiml.VoiceResponse();
        errorTwiml.say(
            'An internal error occurred. Please try again later. Goodbye.'
        );
        errorTwiml.hangup();
        res.type('text/xml');
        // Send 200 OK even on error, but with TwiML that handles the error gracefully
        res.status(200).send(errorTwiml.toString());
    }
});

/**
 * @route POST /handle-speech
 * @description Handles the TwiML webhook triggered after a <Gather> completes (speech collected or timed out).
 * Processes the `SpeechResult` from the user.
 * - If no speech, retries up to `MAX_RETRIES`.
 * - If speech detected (or max retries reached with no speech):
 * - Retrieves conversation history for the CallSid.
 * - Sends speech text and history to Gemini LLM service (`generateLlmResponse`).
 * - Updates conversation history.
 * - Generates TTS audio for the LLM's response using ElevenLabs.
 * - Checks for conversation turn limits (`MAX_CONVERSATION_TURNS`) or hangup commands ("HANGUPNOW") from LLM.
 * - Constructs TwiML to play the TTS response and either <Gather> for the next turn or <Hangup>.
 * Logs detailed turn information to Firebase.
 *
 * @param {string} req.body.CallSid - The SID of the call.
 * @param {string} [req.body.SpeechResult] - The transcribed text from the user's speech. Empty if no speech detected.
 * @param {string} [req.body.Confidence] - Confidence score of the transcription (0.0 to 1.0). Not used here but available.
 * @param {string} req.query.retry - The current retry attempt number for empty speech results (starts at '0').
 * @returns {void} Sends TwiML response (text/xml).
 * @throws {InternalServerError} If LLM or TTS services fail, or other unexpected errors occur. Logs error to Firebase.
 */
router.post('/handle-speech', async (req, res) => {
    const { CallSid, SpeechResult } = req.body;
    // Parse retry count safely, defaulting to 0
    const currentRetry = parseInt(req.query.retry || '0', 10);

    const twiml = new twilio.twiml.VoiceResponse();
    let llmText = null; // Text response from LLM
    let ttsAudioUrl = null; // URL of the generated TTS audio
    let logData = {
        // Object to hold data for Firebase logging
        event: 'handle_speech_turn_processing',
        speechResult: SpeechResult || '[No speech detected]',
        retryAttempt: currentRetry, // Log the attempt number (0-based)
    };

    // Retrieve or initialize conversation history
    let currentHistoryData = callHistories.get(CallSid) || {
        history: [],
        lastUpdated: Date.now(),
    };
    let currentHistory = currentHistoryData.history;

    // Calculate current turn number (1-based)
    const turnNumber = Math.floor(currentHistory.length / 2) + 1;
    logData.turn = turnNumber;

    console.log(`--- Handling Speech Turn ${turnNumber} for ${CallSid} ---`);
    console.log(
        `Retry Attempt: ${currentRetry}, Speech Input: "${logData.speechResult}"`
    );

    try {
        // --- Handle No Speech Input / Retries ---
        if (!SpeechResult && currentRetry < MAX_RETRIES) {
            const nextRetry = currentRetry + 1;
            console.log(
                `No speech detected, retrying turn (Attempt ${nextRetry}/${MAX_RETRIES})`
            );

            twiml.say(
                "Sorry, I didn't hear anything. Could you please repeat that?"
            );
            const gather = twiml.gather({
                input: 'speech',
                speechTimeout: 2,
                maxSpeechTime: 12,
                action: `/handle-speech?retry=${nextRetry}`, // Increment retry count in action URL
                actionOnEmptyResult: true,
            });
            const beepUrl = `${ngrokUrl}/beep.mpeg`;
            gather.play(beepUrl);
            // Fallback if retry also fails
            twiml.say(
                "If you're finished speaking or having trouble, you can hang up now. Goodbye."
            );
            twiml.hangup();

            logData.event = 'handle_speech_retry';
            logData.nextRetryAttempt = nextRetry;
            await logToFirebase(CallSid, logData).catch(e =>
                console.error('FB log error (retry):', e)
            );

            res.type('text/xml');
            return res.send(twiml.toString()); // Send retry TwiML immediately
        }

        // --- Process Speech with LLM (if speech exists or max retries reached) ---
        if (!SpeechResult && currentRetry >= MAX_RETRIES) {
            console.log(
                `Max retries (${MAX_RETRIES}) reached with no speech input for ${CallSid}. Proceeding as if input was empty.`
            );
            logData.speechResult = '[Max retries - No speech detected]';
        }
        console.log(
            `Proceeding with LLM interaction for ${CallSid}. Turn: ${turnNumber}.`
        );

        // Generate LLM response using current speech and history
        const { llmText: generatedText, updatedHistory } =
            await generateLlmResponse(
                logData.speechResult, // Use potentially updated logData.speechResult
                currentHistory
            );
        llmText = generatedText; // Store the raw LLM text response

        // Update conversation history in the map
        callHistories.set(CallSid, {
            history: updatedHistory,
            lastUpdated: Date.now(),
        });
        logData.llm_model = process.env.GEMINI_MODEL || 'gemini-2.0-flash'; // Log which model was used
        logData.llm_raw_response_text = llmText; // Log the raw response
        console.log(`LLM Raw Response (Turn ${turnNumber}): "${llmText}"`);

        // --- Determine Spoken Text and Hangup Condition ---
        let hangup = false;
        let spokenText = llmText; // Text that will actually be converted to speech

        if (turnNumber >= MAX_CONVERSATION_TURNS) {
            // Force hangup if max turns reached
            console.log(
                `Max turns (${MAX_CONVERSATION_TURNS}) reached for ${CallSid}. Overriding LLM response with final message.`
            );
            spokenText = FINAL_CLOSING_MESSAGE;
            hangup = true;
            logData.max_turns_reached = true;
        } else if (llmText && llmText.includes('HANGUPNOW')) {
            // Hangup if LLM explicitly requested it
            hangup = true;
            // Remove the hangup command from the spoken text
            spokenText = llmText.replace('HANGUPNOW', '').trim();
            console.log(`'HANGUPNOW' detected in LLM response for ${CallSid}.`);
            logData.llm_requested_hangup = true;
        }

        // Handle cases where spokenText might be empty after processing
        if (!spokenText || spokenText.length === 0) {
            console.warn(
                `Spoken text is empty for ${CallSid} after LLM processing. Using fallback message.`
            );
            spokenText = hangup
                ? 'Okay. Thank you, goodbye.' // Simple closing if hangup was intended
                : 'Sorry, I encountered an issue processing that request. Could you try again?'; // Prompt to retry if not hanging up

            // Ensure hangup flag is correct if llmText was ONLY 'HANGUPNOW'
            if (llmText === 'HANGUPNOW') hangup = true;
            logData.empty_spoken_text_fallback = true;
        }
        logData.llm_spoken_text = spokenText; // Log the final text to be spoken
        logData.will_hangup = hangup; // Log whether the call will hang up this turn

        // --- Generate TTS Audio ---
        if (spokenText) {
            const uniqueFileName = `tts-${CallSid}-turn${turnNumber}-${uuidv4()}.mpeg`;
            try {
                console.log(`Requesting TTS for: "${spokenText}"`);
                ttsAudioUrl = await elevenLabsTextToSpeech(
                    spokenText,
                    uniqueFileName // Provide unique filename
                );
                logData.tts_audio_url = ttsAudioUrl;
                logData.tts_filename = uniqueFileName;
                console.log(`TTS Audio URL generated: ${ttsAudioUrl}`);
            } catch (ttsError) {
                console.error(
                    `ElevenLabs TTS generation failed for ${CallSid}:`,
                    ttsError
                );
                logData.tts_error = ttsError.message;
                // Fallback: Use <Say> instead of <Play>
                ttsAudioUrl = null; // Ensure we don't try to play a non-existent URL
                // Log the TTS error specifically
                await logErrorToFirebase(CallSid, ttsError).catch(e =>
                    console.error('FB log error (TTS):', e)
                );
                // Consider adding a generic error message to spokenText here?
                // spokenText = "I'm having trouble speaking right now. " + spokenText;
            }
        }

        // --- Construct TwiML Response ---
        if (ttsAudioUrl) {
            console.log(`Generating TwiML: <Play> ${ttsAudioUrl}`);
            twiml.play(ttsAudioUrl);
        } else if (spokenText) {
            // Fallback to <Say> if TTS failed or wasn't generated
            console.log(`Generating TwiML: <Say> "${spokenText}"`);
            twiml.say(spokenText);
        } else {
            // Should not happen due to fallback logic, but as a safeguard:
            console.error(
                `Error: No spokenText and no ttsAudioUrl for ${CallSid}. Hanging up.`
            );
            twiml.say('An unexpected error occurred. Goodbye.');
            hangup = true; // Force hangup
        }

        if (hangup) {
            console.log(`TwiML: Adding <Hangup> for ${CallSid}`);
            twiml.hangup();
            logData.final_twiml_action = ttsAudioUrl
                ? 'Play + Hangup'
                : 'Say + Hangup';
            // Clean up history for this call after hanging up
            callHistories.delete(CallSid);
            console.log(`Cleared call history for ${CallSid}`);
        } else {
            // Continue conversation: Gather next input
            console.log(
                `TwiML: Adding <Gather> for next turn (${turnNumber + 1}) for ${CallSid}`
            );
            const gather = twiml.gather({
                input: 'speech',
                speechTimeout: 2,
                maxSpeechTime: 12,
                action: `/handle-speech?retry=0`, // Reset retry count for the next turn
                actionOnEmptyResult: true,
            });
            const beepUrl = `${ngrokUrl}/beep.mpeg`;
            gather.play(beepUrl);

            // Fallback if gather times out on the next turn
            twiml.say(
                'Is there anything else I can help with? If not, you can hang up. Goodbye.'
            );
            twiml.hangup();
            logData.final_twiml_action = ttsAudioUrl
                ? 'Play + Gather'
                : 'Say + Gather';
        }

        // Log the final state of this turn
        logData.event = 'handle_speech_processed';
        await logToFirebase(CallSid, logData).catch(e =>
            console.error('FB log error (processed):', e)
        );

        console.log(
            `--- End Handling Speech Turn ${turnNumber} for ${CallSid} ---`
        );
        res.type('text/xml');
        res.send(twiml.toString());
    } catch (error) {
        console.error(
            `Error in /handle-speech main processing block for ${CallSid}:`,
            error
        );

        // Log the unexpected error
        await logErrorToFirebase(
            CallSid || 'unknown_sid_handle_speech', // Use placeholder if CallSid is somehow lost
            new InternalServerError(
                `Critical error in /handle-speech processing (Turn ${turnNumber}): ${error.message}`,
                500,
                error.stack
            )
        ).catch(logErr =>
            console.error(
                'Failed to log /handle-speech critical error:',
                logErr
            )
        );

        // Send a graceful error TwiML response
        const errorTwiml = new twilio.twiml.VoiceResponse();
        errorTwiml.say(
            'I encountered an unexpected problem. Apologies. Please call back later. Goodbye.'
        );
        errorTwiml.hangup();
        res.type('text/xml');
        // Send 200 OK with error TwiML
        res.status(200).send(errorTwiml.toString());

        // Clean up history on critical error
        callHistories.delete(CallSid);
    }
});

/**
 * @route POST /call-status
 * @description Handles the Twilio webhook providing status updates for the call lifecycle.
 * Specifically listens for 'completed' calls that were answered by 'unknown' (often indicating
 * the call didn't connect properly, went to voicemail detection timed out, or was busy).
 * In such cases, it attempts to send an SMS message as a fallback reminder.
 * Logs other status updates as well.
 *
 * @param {string} req.body.CallSid - The SID of the call.
 * @param {string} req.body.CallStatus - The current status of the call (e.g., 'initiated', 'ringing', 'answered', 'completed', 'failed', 'busy', 'no-answer').
 * @param {string} [req.body.AnsweredBy] - Who answered the call (relevant for 'completed' status logic). Present on answered/completed calls.
 * @param {string} req.body.To - The recipient's phone number (used for sending SMS).
 * @param {string} req.body.From - The Twilio phone number used for the call.
 * // Other parameters like Duration, SipResponseCode etc. might be present depending on status.
 * @returns {object|boolean} res - Express response object or false.
 * On SMS attempt success:
 * - Status 200 OK
 * - JSON: `{ CallSid: string, smsSid: string, message: 'SMS text sent.' }`
 * On SMS attempt error:
 * - Status 500 Internal Server Error
 * - JSON: `{ error: 'Failed to send SMS.' }`
 * For other statuses or conditions not triggering SMS:
 * - Returns `false` internally (effectively sending a 200 OK with empty body to Twilio, which is acceptable).
 * @throws {TwilioApiError} If sending the SMS fails. Logs error to Firebase.
 */
router.post('/call-status', async (req, res) => {
    const { CallSid, CallStatus, AnsweredBy, To, From } = req.body; // Added From
    let statusMessage = `Status update for ${CallSid}: ${CallStatus}`;
    if (AnsweredBy) statusMessage += `, AnsweredBy: ${AnsweredBy}`;

    console.log(statusMessage);

    // Log every status update event received
    try {
        await logToFirebase(CallSid, {
            event: 'call_status_update',
            status: CallStatus,
            answeredBy: req.body.AnsweredBy ?? 'N/A', // Use nullish coalescing
            callDuration: req.body.CallDuration ?? null, // Use null if CallDuration is undefined or null
            sipResponseCode: req.body.SipResponseCode ?? null, // Use null if SipResponseCode is undefined or null
            timestamp: new Date().toISOString(),
        });
    } catch (firebaseError) {
        console.error(
            `Firebase logging error for ${CallSid} (Status ${CallStatus}):`,
            firebaseError
        );
    }

    // --- SMS Fallback Logic ---
    // Trigger SMS only if call completed AND was answered by 'unknown' (often means voicemail detection failed or call didn't fully connect)
    // Also check CallStatus 'busy' or 'failed' or 'no-answer' as potential triggers for SMS. Adjust as needed.
    const smsTriggerStatuses = ['completed', 'busy', 'failed', 'no-answer'];
    let sendSms = false;

    if (smsTriggerStatuses.includes(CallStatus)) {
        if (CallStatus === 'completed' && AnsweredBy === 'unknown') {
            sendSms = true;
            statusMessage = `Call ${CallSid} completed but AnsweredBy is 'unknown'. Attempting SMS fallback to ${To}.`;
        } else if (['busy', 'failed', 'no-answer'].includes(CallStatus)) {
            sendSms = true;
            statusMessage = `Call ${CallSid} ended with status '${CallStatus}'. Attempting SMS fallback to ${To}.`;
        }
    }

    if (sendSms) {
        console.log(statusMessage);

        // Use the primary Twilio client to send SMS
        const smsText = TtsHolder.unanswered; // Get the standard unanswered message text

        try {
            const sms = await twilioClient.messages.create({
                body: smsText,
                to: To, // The original recipient's number
                from:
                    process.env.TWILIO_PHONE_NUMBER_PAID ||
                    process.env.TWILIO_PHONE_NUMBER_TOLL_FREE, // Use a SMS-capable Twilio number
            });

            const smsLogStatus = `SMS fallback sent successfully for ${CallStatus} call ${CallSid}. SMS SID: ${sms.sid}`;
            console.log(smsLogStatus);
            consoleLogCall(
                { callSid: CallSid, status: smsLogStatus },
                {
                    smsSid: sms.sid,
                    smsTo: To,
                    smsFrom: sms.from,
                    smsBody: smsText,
                } // Log SMS details
            );

            // Log SMS success to Firebase
            await logToFirebase(CallSid, {
                event: 'sms_fallback_sent',
                status: smsLogStatus,
                smsSid: sms.sid ?? -1,
                smsTo: To ?? 'N/A',
                smsFrom: sms.from ?? 'N/A', // Log the actual sending number
                reason: `CallStatus: ${CallStatus}, AnsweredBy: ${AnsweredBy || 'N/A'}`,
            }).catch(e => console.error('FB log error (SMS success):', e));

            // Send success response back for the webhook
            return res.status(200).send({
                CallSid,
                smsSid: sms.sid,
                message: 'SMS text sent.',
            });
        } catch (error) {
            const smsErrorStatus = `Error sending SMS fallback for ${CallSid} to ${To}: ${error.message}`;
            console.error(smsErrorStatus);
            consoleLogCall({ callSid: CallSid, status: smsErrorStatus });

            // Log SMS failure to Firebase
            await logErrorToFirebase(
                CallSid,
                new TwilioApiError(
                    `Error sending SMS fallback to ${To}: ${error.message}`,
                    error.status || 500,
                    error.stack
                )
            ).catch(logErr =>
                console.error('Failed to log SMS sending error:', logErr)
            );

            // Send error response back for the webhook
            // Note: Twilio might retry the webhook if it gets a 5xx error.
            // Sending 200 OK might be preferable if you don't want retries. Choose based on desired behavior.
            // return res.status(500).send({ error: 'Failed to send SMS fallback.' });
            return res.status(200).send({
                message: 'SMS fallback attempt failed.',
                error: error.message,
            }); // Send 200 to prevent retry
        }
    } else {
        // If no SMS is triggered, Twilio just needs a 200 OK.
        // Returning false leads to an empty 200 OK response.
        return res.status(200).send(); // Explicitly send 200 OK empty response
    }
});

/**
 * @route POST /handle-recording
 * @description Handles the Twilio webhook triggered when a call recording is ready.
 * Logs the recording details (URL, SID, Duration) to Firebase.
 *
 * @param {string} req.body.CallSid - The SID of the call associated with the recording.
 * @param {string} req.body.RecordingUrl - The URL of the recording file (.wav or .mp3).
 * @param {string} req.body.RecordingSid - The unique SID for this recording.
 * @param {string} req.body.RecordingDuration - The duration of the recording in seconds.
 * @param {string} req.body.ErrorCode - Included if there was an error generating the recording.
 * @returns {object} res - Express response object.
 * On successful logging:
 * - Status 200 OK
 * - JSON: `{ CallSid: string, RecordingSid: string, message: 'Recording processed.' }`
 * On error (e.g., missing parameters):
 * - Status 400 Bad Request
 * - JSON: `{ message: 'Error processing recording.' }`
 * On unexpected error:
 * - Status 500 Internal Server Error
 * - JSON: `{ message: 'Error processing recording data.' }`
 * @throws {BadRequestError} If required recording parameters are missing. Logs error.
 */
router.post('/handle-recording', async (req, res) => {
    console.log(
        `'/handle-recording' webhook received for CallSid: ${req.body.CallSid}`
    );
    const {
        CallSid,
        RecordingUrl,
        RecordingSid,
        RecordingDuration,
        ErrorCode,
    } = req.body;

    try {
        // Check if recording failed
        if (ErrorCode && ErrorCode !== '0') {
            const errorStatus = `Recording failed for CallSid ${CallSid}. ErrorCode: ${ErrorCode}. URL: ${RecordingUrl || 'N/A'}`;
            console.error(errorStatus);
            await logToFirebase(CallSid, {
                // Log failure event
                event: 'recording_failed',
                callSid: CallSid,
                recordingSid: RecordingSid || 'N/A',
                errorCode: ErrorCode,
                status: errorStatus,
            }).catch(e => console.error('FB log error (recording failed):', e));
            // Acknowledge webhook even if recording failed
            return res
                .status(200)
                .send({ message: 'Recording failed, error logged.' });
        }

        // Proceed if recording seems successful (no ErrorCode or ErrorCode is '0')
        if (RecordingSid && RecordingUrl && CallSid) {
            const status = 'Recording processed successfully.';
            const recordingData = {
                event: 'recording_handled',
                callSid: CallSid,
                recordingUrl: RecordingUrl + '.mp3', // Request mp3 format if needed/available
                recordingSid: RecordingSid,
                duration: RecordingDuration,
                status,
            };

            // Log details to console and Firebase
            consoleLogCall(
                { callSid: CallSid, status },
                {
                    recordingSid: RecordingSid,
                    url: recordingData.recordingUrl,
                    duration: RecordingDuration,
                }
            );
            await logToFirebase(CallSid, recordingData).catch(firebaseError => {
                // Log failure locally but don't fail the webhook response
                console.error(
                    `Firebase logging error for ${CallSid} (Recording):`,
                    firebaseError
                );
            });

            // Send success response to Twilio
            res.status(200).send({
                CallSid,
                RecordingSid,
                message: status,
            });
        } else {
            // Handle missing essential data
            const errorStatus =
                'Missing required data in /handle-recording webhook.';
            console.error(errorStatus, req.body);
            consoleLogCall(
                { callSid: CallSid || 'Unknown', status: errorStatus },
                { RecordingSid }
            );
            await logErrorToFirebase(
                CallSid || 'unknown_sid_recording',
                new BadRequestError(errorStatus)
            ).catch(e =>
                console.error('FB log error (bad recording webhook):', e)
            );
            // Send 400 Bad Request as the webhook payload was incomplete
            res.status(400).send({ message: errorStatus });
        }
    } catch (error) {
        // Catch unexpected errors during processing
        const unexpectedErrorStatus = `Unexpected error handling recording for ${CallSid || 'Unknown'}: ${error.message}`;
        console.error(unexpectedErrorStatus, error);
        consoleLogCall({
            callSid: CallSid || 'Unknown',
            status: unexpectedErrorStatus,
        });
        await logErrorToFirebase(
            CallSid || 'unknown_sid_recording',
            error
        ).catch(logErr => {
            console.error('Failed to log unexpected recording error:', logErr);
        });

        // Send generic 500 error
        res.status(500).send({
            message: 'Error processing recording data.',
            // error: error.message // Optionally include error message in dev
        });
    }
});

export default router;
