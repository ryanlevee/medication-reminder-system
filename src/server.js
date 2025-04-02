import { createClient } from '@deepgram/sdk';
import dotenv from 'dotenv';
import express, { json } from 'express';
import expressWs from 'express-ws';
import { createServer } from 'http';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { updateIncomingCallWebhookUrls } from './config/twilio.js';
import callLogsRouter from './routes/callLogs.js';
import callsRouter from './routes/calls.js';
import incomingCallsRouter from './routes/incomingCalls.js';
import { logErrorToFirebase, logToFirebase } from './utils/firebase.js';
import { handleWebSocketConnection } from './websocketHandler.js';

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

app.use((err, req, res, next) => {
    console.error('Global error handler:', err);
    logErrorToFirebase('server', err);
    res.status(err.statusCode || 500).json({
        message: err.message || 'Internal Server Error',
    });
});

wss.on('connection', (ws, req) => {
    handleWebSocketConnection(ws, req, {
        deepgram,
        logToFirebase,
        logErrorToFirebase,
    });
});

server.listen(port, async () => {
    console.log();
    console.log(`Server listening at http://localhost:${port}`);
    try {
        await updateIncomingCallWebhookUrls();
    } catch (error) {
        console.error('Error updating webhook URLs on server start:', error);
        // Consider if the server should even start if this fails.
    }
});
