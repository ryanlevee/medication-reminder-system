import { LiveTranscriptionEvents } from '@deepgram/sdk';
import InternalServerError from './errors/InternalServerError.js';
import { consoleLogCall } from './utils/consoleLogCall.js';

export function handleWebSocketConnection(ws, req, dependencies) {
    const { deepgram, logToFirebase, logErrorToFirebase } = dependencies;

    console.log('WebSocket connection received.');
    console.log('Connecting to Deepgram ListenLiveClient...');

    /// turn all of deepgram into a service
    const deepgramConnection = deepgram.listen.live({
        model: 'nova-3',
        encoding: 'mulaw',
        sample_rate: 8000,
        channels: 1,
        endpointing: 1000,
        interim_results: true,
        smart_format: true,
    });

    let closedTranscript = '';
    let callSid = 'unknown_callsid';
    let streamSid = 'unknown_streamsid';

    deepgramConnection.on(LiveTranscriptionEvents.Open, () => {
        console.log('Deepgram ListenLiveClient opened.');
    });

    deepgramConnection.on(LiveTranscriptionEvents.Close, async () => {
        console.log('Deepgram ListenLiveClient closed.');
        try {
            const status = 'Deepgram transcription complete.';
            const finalTranscript = closedTranscript.trim();
            await logToFirebase(callSid, {
                event: 'deepgram_transcript',
                streamSid,
                status,
                transcript: finalTranscript,
            });
            consoleLogCall(
                { callSid: callSid, status },
                { STT_Transcript: finalTranscript }
            );
            console.log(`--- Call Transcription Log ---`);
            console.log(`Call SID: ${callSid}`);
            console.log(`STT Transcript: "${finalTranscript}"`);
            console.log(`------------------------------`);
        } catch (error) {
            console.error(
                `Error logging Deepgram transcript for ${callSid}:`,
                error
            );
            await logErrorToFirebase(
                callSid,
                new InternalServerError(
                    'Error logging Deepgram transcript to Firebase',
                    500,
                    error.stack
                )
            ).catch(logErrErr =>
                console.error(
                    'Failed to log transcript logging error:',
                    logErrErr
                )
            );
        }
    });

    deepgramConnection.on(LiveTranscriptionEvents.Transcript, transcription => {
        if (transcription.is_final) {
            const transcriptStream =
                transcription.channel.alternatives[0].transcript;
            if (transcriptStream) {
                closedTranscript += transcriptStream + ' ';
                console.log({ transcriptStream });
            }
        }
    });

    deepgramConnection.on(LiveTranscriptionEvents.Error, async error => {
        console.error('Deepgram ListenLiveClient error:', error);
        try {
            await logErrorToFirebase(
                callSid,
                new InternalServerError(
                    'Deepgram ListenLiveClient error',
                    500,
                    error.stack || error?.message || 'Unknown Deepgram Error'
                )
            );
        } catch (logErr) {
            console.error('Failed to log Deepgram error:', logErr);
        }
    });

    ws.on('message', async message => {
        try {
            let messageString;
            if (Buffer.isBuffer(message)) {
                messageString = message.toString('utf8');
            } else if (message instanceof ArrayBuffer) {
                messageString = Buffer.from(message).toString('utf8');
            } else {
                messageString = message;
            }

            const twilioMessage = JSON.parse(messageString);
            const event = twilioMessage.event;

            switch (event) {
                case 'connected':
                    break;
                case 'start':
                    if (
                        twilioMessage.start?.callSid &&
                        twilioMessage.start?.streamSid
                    ) {
                        callSid = twilioMessage.start.callSid;
                        streamSid = twilioMessage.start.streamSid;
                        console.log(
                            `WebSocket stream started for CallSid: ${callSid}, StreamSid: ${streamSid}`
                        );
                    } else {
                        console.error(
                            "Received 'start' event without expected payload",
                            twilioMessage.start
                        );
                    }
                    break;
                case 'media':
                    if (twilioMessage.media?.payload) {
                        const audio = Buffer.from(
                            twilioMessage.media.payload,
                            'base64'
                        );
                        if (deepgramConnection) {
                            deepgramConnection.send(audio);
                        }
                    } else {
                        console.error(
                            "Received 'media' event without payload",
                            twilioMessage.media
                        );
                    }
                    break;
                case 'stop':
                    console.log(
                        `WebSocket stream stopped for CallSid: ${callSid}`
                    );
                    break;
                default:
                    console.log(`Unhandled WebSocket event: ${event}`);
                    break;
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
            try {
                await logErrorToFirebase(
                    callSid,
                    new InternalServerError(
                        'Error processing WebSocket message',
                        500,
                        error.stack
                    )
                );
            } catch (logErr) {
                console.error(
                    'Failed to log WebSocket message processing error:',
                    logErr
                );
            }
        }
    });

    ws.on('close', () => {
        console.log(`WebSocket connection closed for CallSid: ${callSid}`);
        if (deepgramConnection) {
            deepgramConnection.finalize();
            console.log(
                `Deepgram connection finalized due to WebSocket close for ${callSid}.`
            );
        }
    });

    ws.on('error', async error => {
        try {
            await logErrorToFirebase(
                callSid,
                new InternalServerError(
                    'WebSocketServer Error',
                    500,
                    error.stack || error?.message || 'Unknown WS Error'
                )
            );
        } catch (logErr) {
            console.error('!!! Failed to log WebSocket error:', logErr);
        }
        if (deepgramConnection) {
            deepgramConnection.finalize();
        } else {
        }
    });
}
