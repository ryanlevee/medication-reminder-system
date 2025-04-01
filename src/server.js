import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import dotenv from 'dotenv';
import express, { json } from 'express';
import expressWs from 'express-ws';
import { createServer } from 'http';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

import { updateIncomingCallWebhookUrls } from './config/twilio.js'; // Import updateIncomingCallWebhookUrls
import callLogsRouter from './routes/callLogs.js';
import callsRouter from './routes/calls.js';
import incomingCallsRouter from './routes/incomingCalls.js';
import { logToFirebase } from './utils/firebase.js'; // Import logToFirebase

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config();

const app = express();
const port = 3000;
expressWs(app);
app.use(express.urlencoded({ extended: true }));
app.use(json());
app.use(
    express.static(path.join(__dirname, 'public'), {
        setHeaders: (res, path) => {
            if (path.endsWith('.mpeg')) {
                res.setHeader('Content-Type', 'audio/mpeg');
            }
        },
    })
);
app.use('/', callsRouter);
app.use('/', incomingCallsRouter);
app.use('/', callLogsRouter);

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/live' });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

wss.on('connection', ws => {
    console.log('WebSocketServer initialized.');
    console.log('Connecting to Deepgram ListenLiveClient...');

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
    let callSid, streamSid;

    deepgramConnection.on(LiveTranscriptionEvents.Open, () => {
        console.log('Deepgram ListenLiveClient opened.');

        deepgramConnection.on(LiveTranscriptionEvents.Close, async () => {
            await logToFirebase(callSid, {
                event: 'deepgram_transcript',
                streamSid,
                transcript: closedTranscript.trim(),
            });
            console.log('Deepgram ListenLiveClient closed.');
        });

        deepgramConnection.on(
            LiveTranscriptionEvents.Transcript,
            transcription => {
                if (transcription.is_final) {
                    const transcriptStream =
                        transcription.channel.alternatives[0].transcript;
                    closedTranscript += transcriptStream + ' ';
                    console.log({ transcriptStream }); // log sanitized transcriptStream
                } else {
                    // // optional, interim results
                    // const interimTranscript =
                    //     transcription.results.channels[0].alternatives[0].transcript;
                    // console.log({ interimTranscript });
                }
            }
        );
    });

    ws.on('message', async message => {
        const twilioMessage = JSON.parse(message);
        const event = twilioMessage.event;

        switch (event) {
            case 'connected':
                console.log('received a twilio connected event');
                break;
            case 'start':
                callSid = twilioMessage.start.callSid;
                streamSid = twilioMessage.start.streamSid;
                console.log('received a twilio start event');
                break;
            case 'media':
                const media = twilioMessage['media'];
                const audio = Buffer.from(media['payload'], 'base64');
                deepgramConnection.send(audio);
                break;
            case 'stop':
                console.log('received a twilio connected event');
                break;
            default:
                console.log('Unhandled twilioMessage.event:', event);
                break;
        }
    });

    ws.on('close', () => {
        console.log('WebSocketServer disconnected.');
        if (deepgramConnection) {
            deepgramConnection.finalize();
        }
    });

    ws.onerror = error => {
        console.error('WebSocketServer Error:', error);
        deepgramConnection.finalize();
    };
});

server.listen(port, async () => {
    console.log();
    console.log(`Server listening at http://localhost:${port}`);
    await updateIncomingCallWebhookUrls();
});
