/**
 * @fileoverview Handles WebSocket connections established by Twilio's <Stream> TwiML verb.
 * Receives raw audio data (Mulaw) from the Twilio media stream, forwards it to the
 * Deepgram API for real-time Speech-to-Text (STT) transcription, accumulates the
 * final transcript, and logs the result upon stream completion.
 *
 * @requires @deepgram/sdk - Deepgram SDK, specifically LiveTranscriptionEvents for event handling.
 * @requires ./errors/InternalServerError - Custom error class for internal server issues.
 * @requires ./utils/consoleLogCall - Utility for formatted console logging.
 */

import { LiveTranscriptionEvents } from '@deepgram/sdk';
import InternalServerError from './errors/InternalServerError.js'; // Make sure path is correct
import { consoleLogCall } from './utils/consoleLogCall.js'; // Make sure path is correct

/**
 * Handles a single WebSocket connection initiated by a Twilio <Stream>.
 * Sets up a listener with Deepgram for live transcription, forwards incoming
 * audio messages from Twilio to Deepgram, processes transcription results,
 * and logs the final transcript and any errors encountered.
 *
 * @function handleWebSocketConnection
 * @param {import('ws').WebSocket} ws - The raw WebSocket connection instance.
 * @param {import('http').IncomingMessage} req - The initial HTTP request that initiated the WebSocket connection.
 * @param {object} dependencies - An object containing required services and utilities.
 * @param {import('@deepgram/sdk').DeepgramClient} dependencies.deepgram - The initialized Deepgram client.
 * @param {Function} dependencies.logToFirebase - Async function to log general data to Firebase `(callSid, logData) => Promise<void>`.
 * @param {Function} dependencies.logErrorToFirebase - Async function to log errors to Firebase `(callSid, error) => Promise<void>`.
 * @returns {void}
 */
export function handleWebSocketConnection(ws, req, dependencies) {
    // Destructure dependencies for easier access
    const { deepgram, logToFirebase, logErrorToFirebase } = dependencies;

    console.log(
        `WebSocket connection handler initiated for request URL: ${req.url}`
    );

    // --- Deepgram Connection Setup ---
    console.log('Attempting to connect to Deepgram ListenLiveClient...');
    /**
     * The active Deepgram Live Transcription connection instance for this WebSocket.
     * @type {import('@deepgram/sdk').LiveClient}
     */
    const deepgramConnection = deepgram.listen.live({
        model: 'nova-2-phonecall', // Recommended model for phone audio
        language: 'en-US', // Specify language
        encoding: 'mulaw', // Audio encoding expected from Twilio phone streams
        sample_rate: 8000, // Sample rate expected from Twilio phone streams
        channels: 1, // Mono audio expected from Twilio phone streams
        endpointing: 300, // Milliseconds of silence indicating end of speech (adjust as needed)
        interim_results: true, // Set to false if only final transcripts are needed for logging
        smart_format: true, // Apply formatting (punctuation, etc.) to transcripts
        // Diarize: true, // Enable speaker diarization if needed (requires 'nova-2' or similar model)
    });

    // --- State Variables ---
    /** Accumulates the final transcript segments received from Deepgram. */
    let closedTranscript = '';
    /** The Twilio Call SID associated with this stream, extracted from the 'start' message. */
    let callSid = 'unknown_callsid_ws'; // Default value until 'start' event is received
    /** The Twilio Stream SID associated with this stream, extracted from the 'start' message. */
    let streamSid = 'unknown_streamsid_ws'; // Default value

    // --- Deepgram Event Handlers ---

    /** Handles the opening of the Deepgram connection. */
    deepgramConnection.on(LiveTranscriptionEvents.Open, () => {
        console.log(
            `Deepgram connection opened successfully for potential CallSid ${callSid}. State: ${deepgramConnection.getReadyState()}`
        );
    });

    /** Handles the closing of the Deepgram connection. Logs the final transcript. */
    deepgramConnection.on(LiveTranscriptionEvents.Close, async closeEvent => {
        console.log(
            `Deepgram connection closed for ${callSid}. Code: ${closeEvent.code}, Reason: ${closeEvent.reason}`
        );
        try {
            const status = 'Deepgram transcription complete.';
            const finalTranscript = closedTranscript.trim(); // Get the accumulated transcript

            // Log the final transcript to Firebase
            await logToFirebase(callSid, {
                event: 'deepgram_transcript_final',
                streamSid: streamSid,
                status: status,
                transcript: finalTranscript,
                deepgramCloseCode: closeEvent.code,
            });

            // Log final transcript summary to console
            consoleLogCall(
                { callSid: callSid, status: status },
                {
                    STT_Transcript:
                        finalTranscript || '[No transcript generated]',
                }
            );
        } catch (error) {
            // Handle errors specifically during the final logging phase
            console.error(
                `Error logging final Deepgram transcript for ${callSid}:`,
                error
            );
            // Log the logging failure itself to Firebase
            await logErrorToFirebase(
                callSid,
                new InternalServerError(
                    `Error logging final Deepgram transcript to Firebase: ${error.message}`,
                    500,
                    error.stack
                )
            ).catch(
                (
                    logErrErr // Catch errors logging the logging error
                ) =>
                    console.error(
                        'CRITICAL: Failed to log transcript logging error to Firebase:',
                        logErrErr
                    )
            );
        }
        // Ensure WebSocket is closed if Deepgram closes unexpectedly
        if (ws.readyState === ws.OPEN) {
            console.log(
                `Deepgram closed, ensuring WebSocket for ${callSid} is closed.`
            );
            ws.close(1011, 'Deepgram connection closed'); // 1011: Internal Error
        }
    });

    /** Handles receiving transcription results from Deepgram. */
    deepgramConnection.on(LiveTranscriptionEvents.Transcript, transcription => {
        if (transcription.is_final) {
            // Check channel and alternatives for the actual text.
            const transcriptStream =
                transcription.channel.alternatives[0].transcript;
            if (transcriptStream && transcriptStream.trim().length > 0) {
                // Append the final transcript segment to the overall transcript.
                closedTranscript += transcriptStream + ' ';
                console.log(
                    `Deepgram transcript stream for ${callSid}: "${transcriptStream}")`
                );
            }
        }
    });

    /** Handles errors from the Deepgram connection. */
    deepgramConnection.on(LiveTranscriptionEvents.Error, async error => {
        console.error(`Deepgram connection error for ${callSid}:`, error);
        try {
            // Log the Deepgram-specific error to Firebase
            await logErrorToFirebase(
                callSid,
                new InternalServerError( // Assuming Deepgram errors are internal/integration issues
                    `Deepgram connection error: ${error?.message || 'Unknown Deepgram Error'}`,
                    500,
                    // Attempt to create a stack or use error details
                    error?.stack || JSON.stringify(error)
                )
            );
        } catch (logErr) {
            console.error(
                `Failed to log Deepgram error to Firebase for ${callSid}:`,
                logErr
            );
        }
        // Close WebSocket on Deepgram error
        if (ws.readyState === ws.OPEN) {
            ws.close(1011, 'Deepgram connection error');
        }
    });

    /** Handles warnings or metadata if needed */
    // deepgramConnection.on(LiveTranscriptionEvents.Metadata, (metadata) => {
    //   console.log(`Deepgram metadata for ${callSid}:`, metadata);
    // });
    // deepgramConnection.on(LiveTranscriptionEvents.SpeechStarted, () => {
    //   console.log(`Deepgram detected speech start for ${callSid}`);
    // });
    // deepgramConnection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
    //    console.log(`Deepgram detected utterance end for ${callSid}`);
    // });

    // --- WebSocket ('ws') Event Handlers ---

    /** Handles incoming messages from the Twilio WebSocket stream. */
    ws.on('message', async message => {
        try {
            // Messages from Twilio are typically JSON strings.
            let messageString;
            if (Buffer.isBuffer(message)) {
                messageString = message.toString('utf8');
            } else if (message instanceof ArrayBuffer) {
                // Handle ArrayBuffer (less common from ws library directly unless binary type set)
                messageString = Buffer.from(message).toString('utf8');
            } else {
                messageString = message; // Assume string
            }

            const twilioMessage = JSON.parse(messageString);
            const event = twilioMessage.event;

            // Process different types of messages from Twilio
            switch (event) {
                case 'connected':
                    // This message confirms the WebSocket connection is established from Twilio's side.
                    console.log(
                        `Twilio media stream connected event received for potential ${callSid}. Protocol: ${twilioMessage.protocol}, Version: ${twilioMessage.version}`
                    );
                    break;

                case 'start':
                    // This message contains call details and marks the beginning of the media stream.
                    // Extract CallSid and StreamSid here.
                    if (
                        twilioMessage.start?.callSid &&
                        twilioMessage.start?.streamSid
                    ) {
                        // Update state with actual CallSid and StreamSid
                        callSid = twilioMessage.start.callSid;
                        streamSid = twilioMessage.start.streamSid;
                        console.log(
                            `Twilio media stream 'start' event received. CallSid: ${callSid}, StreamSid: ${streamSid}`
                        );
                        // Log stream start event to Firebase (optional but useful)
                        await logToFirebase(callSid, {
                            event: 'twilio_stream_start',
                            streamSid: streamSid,
                            mediaFormat: twilioMessage.start.mediaFormat, // Log media format details
                            customParameters:
                                twilioMessage.start.customParameters, // Log any custom params passed in TwiML
                        }).catch(e =>
                            console.error('FB log error (stream start):', e)
                        );
                    } else {
                        // Log an error if the expected 'start' payload is missing
                        console.error(
                            `WebSocket 'start' event received for ${callSid} without expected payload:`,
                            twilioMessage.start
                        );
                        await logErrorToFirebase(
                            callSid,
                            new Error(
                                "Received 'start' event without callSid/streamSid"
                            )
                        ).catch(e =>
                            console.error('FB log error (bad start event):', e)
                        );
                    }
                    break;

                case 'media':
                    // This message contains the actual audio data payload (base64 encoded).
                    if (twilioMessage.media?.payload) {
                        // Decode the base64 audio payload to a Buffer.
                        const audio = Buffer.from(
                            twilioMessage.media.payload,
                            'base64'
                        );
                        // Send the raw audio buffer to the Deepgram connection if it's open.
                        if (
                            deepgramConnection &&
                            deepgramConnection.getReadyState() === 1
                        ) {
                            // 1 = OPEN state
                            deepgramConnection.send(audio);
                        } 
                        // else {
                        //     // Log if attempt to send audio while Deepgram connection isn't ready
                        //     console.warn(
                        //         `Received Twilio media for ${callSid}, but Deepgram connection is not open (State: ${deepgramConnection?.getReadyState()}). Audio not sent.`
                        //     );
                        // }
                    } else {
                        // Log an error if the 'media' payload is missing
                        console.error(
                            `WebSocket 'media' event received for ${callSid} without payload:`,
                            twilioMessage.media
                        );
                        await logErrorToFirebase(
                            callSid,
                            new Error("Received 'media' event without payload")
                        ).catch(e =>
                            console.error('FB log error (bad media event):', e)
                        );
                    }
                    break;

                case 'stop':
                    // This message indicates Twilio has stopped sending media for this stream.
                    console.log(
                        `Twilio media stream 'stop' event received for CallSid: ${callSid}. StreamSid: ${twilioMessage.stop?.streamSid || streamSid}`
                    );
                    // Log stream stop event to Firebase (optional)
                    await logToFirebase(callSid, {
                        event: 'twilio_stream_stop',
                        streamSid: twilioMessage.stop?.streamSid || streamSid,
                    }).catch(e =>
                        console.error('FB log error (stream stop):', e)
                    );

                    // It's good practice to signal end of audio to Deepgram here if not already closed.
                    if (
                        deepgramConnection &&
                        deepgramConnection.getReadyState() === 1
                    ) {
                        console.log(
                            `Sending finalize signal to Deepgram for ${callSid} due to Twilio 'stop' event.`
                        );
                        deepgramConnection.finalize();
                    }
                    break;

                default:
                    // Log any events from Twilio that are not explicitly handled.
                    console.log(
                        `Unhandled WebSocket event received for ${callSid}: ${event}`,
                        twilioMessage
                    );
                    break;
            }
        } catch (error) {
            // Catch errors during message parsing or handling.
            console.error(
                `Error processing WebSocket message for ${callSid}:`,
                error
            );
            // Log this processing error to Firebase
            try {
                await logErrorToFirebase(
                    callSid,
                    new InternalServerError(
                        `Error processing WebSocket message: ${error.message}`,
                        500,
                        error.stack
                    )
                );
            } catch (logErr) {
                console.error(
                    `CRITICAL: Failed to log WebSocket message processing error for ${callSid}:`,
                    logErr
                );
            }
        }
    });

    /** Handles the closing of the WebSocket connection from the client (Twilio). */
    ws.on('close', (code, reason) => {
        const reasonString = reason
            ? reason.toString('utf8')
            : 'No reason given';
        console.log(
            `WebSocket connection closed by client for ${callSid}. Code: ${code}, Reason: "${reasonString}"`
        );
        // Ensure Deepgram connection is finalized when WebSocket closes.
        if (deepgramConnection && deepgramConnection.getReadyState() === 1) {
            // 1 = OPEN
            console.log(
                `Finalizing Deepgram connection for ${callSid} due to WebSocket close event.`
            );
            deepgramConnection.finalize();
        }
    });

    /** Handles errors occurring on the WebSocket connection itself. */
    ws.on('error', async error => {
        console.error(`WebSocket connection error for ${callSid}:`, error);
        try {
            // Log the WebSocket-level error to Firebase
            await logErrorToFirebase(
                callSid,
                new InternalServerError(
                    `WebSocket connection error: ${error.message}`,
                    500,
                    error.stack || 'Stack trace not available for WS error'
                )
            );
        } catch (logErr) {
            // Log critical failure if error logging itself fails
            console.error(
                `CRITICAL: Failed to log WebSocket error to Firebase for ${callSid}:`,
                logErr
            );
            console.error('Original WebSocket error:', error);
        }
        // Ensure Deepgram connection is closed/finalized on WebSocket error.
        if (deepgramConnection && deepgramConnection.getReadyState() === 1) {
            console.log(
                `Finalizing Deepgram connection for ${callSid} due to WebSocket error event.`
            );
            deepgramConnection.finalize();
        }
    });
}
