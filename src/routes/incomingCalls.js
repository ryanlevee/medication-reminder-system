/**
 * @fileoverview Express router for handling incoming voice calls to the Twilio number.
 * When a patient calls the configured Twilio number, this router answers the call,
 * plays the standard medication reminder prompt using TTS, and then gathers
 * the caller's speech response, forwarding it to the main speech handling logic.
 *
 * @requires dotenv - For loading environment variables.
 * @requires express - Web framework for Node.js.
 * @requires twilio - Twilio Node.js helper library.
 * @requires ../errors/InternalServerError - Custom error class for internal issues.
 * @requires ../services/elevenLabsService - Service for Text-to-Speech.
 * @requires ../storage/ttsHolder - Holds predefined TTS message strings.
 * @requires ../utils/firebase - Utilities for logging data and errors to Firebase.
 * @requires ../utils/consoleLogCall - Utility for formatted console logging. // Added missing import assuming usage
 */

import dotenv from 'dotenv';
import express from 'express';
import twilio from 'twilio';
import { v4 as uuidv4 } from 'uuid'; // Added for unique TTS filenames
import InternalServerError from '../errors/InternalServerError.js';
import { elevenLabsTextToSpeech } from '../services/elevenLabsService.js';
import { TtsHolder } from '../storage/ttsHolder.js';
import { logErrorToFirebase, logToFirebase } from '../utils/firebase.js';
import { consoleLogCall } from '../utils/consoleLogCall.js'; // Added import

// Load environment variables
dotenv.config();
const router = express.Router();

/**
 * The base URL provided by ngrok for local development tunneling.
 * Loaded from the NGROK_URL environment variable. Used for static assets like the beep sound.
 * @type {string | undefined}
 */
const ngrokUrl = process.env.NGROK_URL;
if (!ngrokUrl) {
    console.error(
        'FATAL ERROR: NGROK_URL environment variable is not set. Static assets might fail.'
    );
    // process.exit(1); // Optional: Exit if ngrok is critical
}

/**
 * @route POST /incoming-call
 * @description Handles the Twilio webhook triggered when a call is received on the configured Twilio number.
 * It answers the call, generates the standard reminder message using TTS (ElevenLabs),
 * starts a media stream to the WebSocket handler (`/live`) for real-time transcription (STT),
 * plays the reminder TTS, and then uses <Gather> to capture the caller's speech,
 * directing the result to the `/handle-speech` endpoint for processing by the LLM.
 *
 * @param {string} req.body.CallSid - The SID of the incoming call.
 * @param {string} req.body.From - The caller's phone number.
 * @param {string} req.body.To - The Twilio phone number that was called.
 * @param {object} req.headers - Contains host information needed for WebSocket URL.
 * @returns {void} Sends TwiML response (text/xml).
 * @throws {InternalServerError} If TTS generation fails or other unexpected errors occur. Logs error to Firebase.
 */
router.post('/incoming-call', async (req, res) => {
    const { CallSid, From, To } = req.body;
    const twiml = new twilio.twiml.VoiceResponse();
    let ttsAudioUrl = null; // Initialize variable for TTS URL

    console.log(
        `'/incoming-call' webhook received for ${CallSid}. From: ${From}, To: ${To}`
    );

    try {
        // --- Generate Reminder TTS ---
        const textToSpeakToHuman = TtsHolder.reminder; // Get the standard reminder text
        // Use a unique filename for the TTS audio file
        const reminderFileName = `incoming-reminder-${CallSid}-${uuidv4()}.mpeg`;
        console.log(
            `Generating TTS for incoming call reminder: "${textToSpeakToHuman}"`
        );
        ttsAudioUrl = await elevenLabsTextToSpeech(
            textToSpeakToHuman,
            reminderFileName
        );
        console.log(
            `TTS generated for incoming call ${CallSid}: ${ttsAudioUrl}`
        );

        // --- Log Incoming Call Event ---
        // Log the start of handling the incoming call (non-critical)
        try {
            const status = 'Incoming call received and processing.';
            consoleLogCall(
                { callSid: CallSid, status: status },
                { from: From, to: To }
            );
            await logToFirebase(CallSid, {
                event: 'call_incoming_received',
                status,
                from: From,
                to: To,
                ttsAudioUrl: ttsAudioUrl, // Log the generated TTS URL
            });
        } catch (firebaseError) {
            console.error(
                `Firebase logging error for incoming call ${CallSid}:`,
                firebaseError
            );
            // Continue processing even if logging fails
        }

        // --- Construct TwiML Response ---

        // 1. Start WebSocket stream for real-time transcription (STT)
        const streamUrl = `wss://${req.headers.host}/live`; // Construct WebSocket URL
        console.log(
            `Starting media stream for incoming call ${CallSid} to: ${streamUrl}`
        );
        const stream = twiml.start().stream({ url: streamUrl });
        // Pass CallSid to WebSocket handler for context
        stream.parameter({ name: 'CallSid', value: CallSid });

        // 2. Play the generated reminder audio
        twiml.play(ttsAudioUrl);

        // 3. Gather subsequent speech input from the caller
        const gather = twiml.gather({
            input: 'speech',
            speechTimeout: 2, // Seconds of silence before considering input complete
            maxSpeechTime: 12, // Max seconds of speech allowed
            action: '/handle-speech?retry=0', // Send speech result to the same handler as outbound calls
            actionOnEmptyResult: true, // Trigger action even if no speech detected
        });

        // 4. Play a short beep to indicate readiness for input
        const beepUrl = `${ngrokUrl}/beep.mpeg`; // Ensure beep.mpeg exists in /public
        gather.play(beepUrl);

        // 5. Add a fallback message and hangup if gather finishes without action (e.g., timeout)
        twiml.say('If you need assistance, please call back. Goodbye.');
        twiml.hangup();

        // Send the TwiML response back to Twilio
        res.type('text/xml');
        res.send(twiml.toString());
    } catch (error) {
        console.error(
            `Error handling '/incoming-call' for ${CallSid} from ${From}:`,
            error
        );
        consoleLogCall({
            callSid: CallSid,
            status: `Error in /incoming-call: ${error.message}`,
        });

        // Log the specific error (could be TTS failure, etc.)
        await logErrorToFirebase(
            CallSid,
            new InternalServerError(
                `Error processing incoming call webhook for ${CallSid}: ${error.message}`,
                500,
                error.stack
            )
        ).catch(logErr =>
            console.error('Failed to log /incoming-call error:', logErr)
        );

        // Send a generic error TwiML response
        const errorTwiml = new twilio.twiml.VoiceResponse();
        errorTwiml.say(
            'We encountered an error processing your call. Please try again later. Goodbye.'
        );
        errorTwiml.hangup();
        res.type('text/xml');
        // Send 200 OK even on error, with TwiML that handles the error gracefully
        res.status(200).send(errorTwiml.toString());
    }
});

export default router;
