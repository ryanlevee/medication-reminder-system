/**
 * @fileoverview Main application entry point and server setup.
 * Initializes the Express application, configures middleware (including JSON parsing,
 * URL encoding, static file serving, and WebSocket support), sets up the Deepgram client,
 * mounts API route handlers, defines a global error handler, configures the WebSocket server
 * for real-time transcription, and starts the HTTP server. Also updates Twilio webhook URLs
 * on startup for development environments using ngrok.
 *
 * @requires @deepgram/sdk - Deepgram SDK for real-time transcription.
 * @requires dotenv - For loading environment variables.
 * @requires express - Web framework for Node.js.
 * @requires express-ws - WebSocket endpoints for Express.
 * @requires http - Node.js HTTP module for creating the server.
 * @requires path - Node.js module for handling file paths.
 * @requires url - Node.js module for URL parsing (used for __dirname).
 * @requires ws - WebSocket library (used by express-ws).
 * @requires ./config/twilio - Function to update Twilio webhooks.
 * @requires ./routes/callLogs - Router for call log endpoints.
 * @requires ./routes/calls - Router for main call handling endpoints.
 * @requires ./routes/incomingCalls - Router for incoming call endpoints.
 * @requires ./utils/firebase - Utilities for Firebase logging.
 * @requires ./websocketHandler - Handler for WebSocket connections (media streaming and STT).
 */

import { createClient } from '@deepgram/sdk';
import dotenv from 'dotenv';
import express, { json } from 'express';
import expressWs from 'express-ws';
import { createServer } from 'http';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws'; // Although express-ws manages it, explicitly importing can be clearer
import { updateIncomingCallWebhookUrls } from './config/twilio.js';
import callLogsRouter from './routes/callLogs.js';
import callsRouter from './routes/calls.js';
import incomingCallsRouter from './routes/incomingCalls.js';
import { logToFirebase, logErrorToFirebase } from './utils/firebase.js'; // Only importing logErrorToFirebase here
import { handleWebSocketConnection } from './websocketHandler.js';

// --- ES Module specific setup for __dirname ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Load Environment Variables ---
dotenv.config();

// --- Initialize Express App ---
const app = express();
const port = process.env.PORT || 3000; // Use environment variable for port or default to 3000

// --- Enable WebSocket support for Express ---
// This adds a `.ws` method to the app and router objects.
expressWs(app);

// --- Middleware Configuration ---
// Parse URL-encoded bodies (as sent by HTML forms)
app.use(express.urlencoded({ extended: true }));
// Parse JSON bodies (as sent by API clients)
app.use(json());

/**
 * @description Middleware to serve static files (like CSS, JS, images, audio)
 * from the 'public' directory. It specifically sets the Content-Type header
 * for .mpeg files to ensure browsers handle them correctly as audio.
 */
app.use(
    express.static(path.join(__dirname, 'public'), {
        setHeaders: (res, filePath) => {
            // Ensure correct MIME type for TTS audio files served statically
            if (path.extname(filePath).toLowerCase() === '.mpeg') {
                res.setHeader('Content-Type', 'audio/mpeg');
            }
        },
    })
);

// --- Mount Routers ---
// All routes defined in these files will be accessible from the root path '/'.
app.use('/', callsRouter); // Handles /call, /answered, /handle-speech, etc.
app.use('/', incomingCallsRouter); // Handles /incoming-call
app.use('/', callLogsRouter); // Handles /call-logs

// --- Create HTTP Server ---
// The WebSocket server will attach to this HTTP server.
const server = createServer(app);

// --- Initialize Deepgram Client ---
// Ensure DEEPGRAM_API_KEY is set in your .env file
const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
if (!deepgramApiKey) {
    console.error(
        'FATAL ERROR: DEEPGRAM_API_KEY environment variable is not set. STT will fail.'
    );
    // process.exit(1); // Exit if Deepgram is essential
}
/**
 * The initialized Deepgram client instance.
 * Used for interacting with Deepgram's API, specifically for live transcription.
 * @type {import('@deepgram/sdk').DeepgramClient}
 */
const deepgram = createClient(deepgramApiKey);

// --- WebSocket Server Setup ---
// Create a WebSocket server instance that listens on the '/live' path.
// Connections to `wss://your-server.com/live` will be handled here.
const wss = new WebSocketServer({ server, path: '/live' });

/**
 * Handles new WebSocket connections established on the '/live' path.
 * It passes the WebSocket instance, request object, and necessary dependencies
 * (Deepgram client, Firebase logging functions) to the `handleWebSocketConnection` function.
 */
wss.on('connection', (ws, req) => {
    console.log(
        `WebSocket connection established from ${req.socket.remoteAddress} on path ${req.url}`
    );
    // Delegate handling of the connection and its messages to the dedicated handler function
    handleWebSocketConnection(ws, req, {
        deepgram, // Pass the initialized Deepgram client
        logToFirebase: (callSid, data) =>
            logToFirebase(callSid, data).catch(e =>
                console.error('Error logging WS data to Firebase:', e)
            ), // Pass wrapped logging functions
        logErrorToFirebase: (callSid, error) =>
            logErrorToFirebase(callSid, error).catch(e =>
                console.error('Error logging WS error to Firebase:', e)
            ),
    });
});

wss.on('error', error => {
    console.error('WebSocket Server Error:', error);
    // Potentially log this server-level error differently
    logErrorToFirebase('websocket_server', error).catch(e =>
        console.error('Failed to log WebSocket Server error:', e)
    );
});

// --- Global Error Handling Middleware ---
/**
 * Catches errors passed via `next(err)` or thrown synchronously in Express route handlers.
 * Logs the error details to Firebase and sends a standardized JSON error response
 * to the client with an appropriate status code.
 * IMPORTANT: This only catches errors within the Express request-response cycle.
 * It does NOT catch errors in WebSocket handlers or asynchronous operations
 * outside of route handlers unless they explicitly call `next(err)`.
 *
 * @param {Error|BaseError} err - The error object. Can be a standard Error or a custom BaseError.
 * @param {express.Request} req - The Express request object.
 * @param {express.Response} res - The Express response object.
 * @param {express.NextFunction} next - The Express next middleware function (unused here but required by Express).
 */
app.use((err, req, res, next) => {
    // Log the error internally and to Firebase
    console.error('Global Error Handler Caught:', err.name, '-', err.message);
    // Log the full stack for unexpected errors (non-operational)
    if (!err.isOperational) {
        console.error(err.stack);
    }

    logErrorToFirebase(req.body?.CallSid || 'global_error_handler', err).catch(
        logErr => {
            console.error(
                '!!! Critical: Failed to log error using global handler:',
                logErr
            );
            console.error('Original Error:', err); // Log original error if logging failed
        }
    );

    // Determine status code and client message
    const statusCode = err.statusCode || 500;
    const clientMessage = err.isOperational
        ? err.message
        : 'An unexpected internal server error occurred.';

    // Send JSON response to the client
    res.status(statusCode).json({
        message: clientMessage,
        // Optionally include error name or code in development
        // errorType: process.env.NODE_ENV === 'development' ? err.name : undefined,
    });
});

// --- Start Server ---
server.listen(port, async () => {
    console.log(`\n--- Medication Reminder Server ---`);
    console.log(`HTTP Server listening at http://localhost:${port}`);
    console.log(`WebSocket Server listening on ws://localhost:${port}/live`);
    console.log(
        `Current time: ${new Date().toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`
    ); // Display current time and timezone

    // --- Update Twilio Webhooks (for Ngrok development) ---
    // This needs to run *after* the server is listening so ngrok can connect.
    try {
        console.log(
            'Attempting to update Twilio incoming call webhook URLs...'
        );
        await updateIncomingCallWebhookUrls();
    } catch (error) {
        // Log the error but allow the server to continue running.
        // Webhooks might need manual updating if this fails.
        console.error(
            'Error updating Twilio webhook URLs on server start:',
            error.message
        );
    }
    console.log(`----------------------------------\n`);
});
