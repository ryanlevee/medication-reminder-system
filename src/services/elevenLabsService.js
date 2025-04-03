/**
 * @fileoverview Service for interacting with the ElevenLabs Text-to-Speech API.
 * Provides a function to convert text input into an audio file (MP3/MPEG)
 * and save it locally to be served publicly.
 *
 * @requires dotenv - For loading environment variables.
 * @requires elevenlabs-node - Official ElevenLabs Node.js client library.
 * @requires fs/promises - Node.js file system module for asynchronous file operations.
 * @requires path - Node.js module for handling file paths.
 * @requires url - Node.js module for URL parsing (used for __dirname).
 * @requires ../errors/ElevenLabsApiError - Custom error for ElevenLabs API issues.
 * @requires ../errors/InternalServerError - Custom error for internal server issues (like file writing).
 */

import dotenv from 'dotenv';
import ElevenLabsClient from 'elevenlabs-node';
import fs from 'fs/promises';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import ElevenLabsApiError from '../errors/ElevenLabsApiError.js';
import InternalServerError from '../errors/InternalServerError.js';

// --- Load Environment Variables ---
dotenv.config();

// --- ES Module specific setup for __dirname ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Configuration & Client Initialization ---
const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
const defaultVoiceId = process.env.ELEVENLABS_VOICE_ID;
const ngrokUrl = process.env.NGROK_URL; // Needed to construct the public URL for the audio file

// Validate required environment variables
if (!elevenLabsApiKey) {
    console.error(
        'FATAL ERROR: ELEVENLABS_API_KEY environment variable is not set. TTS will fail.'
    );
    // process.exit(1); // Optional: Exit if ElevenLabs is critical
}
if (!defaultVoiceId) {
    console.error(
        'FATAL ERROR: ELEVENLABS_VOICE_ID environment variable is not set. TTS will fail.'
    );
    // process.exit(1); // Optional: Exit if ElevenLabs is critical
}
if (!ngrokUrl) {
    console.error(
        'FATAL ERROR: NGROK_URL environment variable is not set. TTS audio URLs will be incorrect.'
    );
    // process.exit(1); // Optional: Exit if ngrok URL is critical
}

/**
 * The initialized ElevenLabs client instance.
 * Used for making Text-to-Speech API requests.
 * @type {ElevenLabsClient}
 */
const elevenLabs = new ElevenLabsClient({
    apiKey: elevenLabsApiKey,
});

/**
 * Converts text input to speech using the ElevenLabs API, saves it as an MPEG audio file
 * in the `src/public` directory, and returns the publicly accessible URL for the file.
 *
 * @async
 * @function elevenLabsTextToSpeech
 * @param {string} textInput - The text content to be converted to speech.
 * @param {string} fileName - The desired filename (e.g., 'reminder-xyz.mpeg') for the output audio file.
 * This file will be saved in the `src/public` directory.
 * @param {string} [voiceId=process.env.ELEVENLABS_VOICE_ID] - Optional. The ElevenLabs voice ID to use. Defaults to the value in the environment variable.
 * @returns {Promise<string>} A promise that resolves with the publicly accessible URL
 * (e.g., 'https://your-ngrok-url.io/reminder-xyz.mpeg') of the generated audio file.
 * @throws {ElevenLabsApiError} If the ElevenLabs API request fails or the stream encounters an error.
 * @throws {InternalServerError} If writing the audio file to the local filesystem fails.
 * @throws {Error} If required environment variables (API Key, Voice ID, Ngrok URL) are missing.
 */
async function elevenLabsTextToSpeech(
    textInput,
    fileName,
    voiceId = defaultVoiceId
) {
    // Double-check required config at runtime, in case checks above were bypassed
    if (!elevenLabsApiKey || !voiceId || !ngrokUrl) {
        throw new Error(
            'Missing required ElevenLabs configuration (API Key, Voice ID, or Ngrok URL).'
        );
    }
    if (!textInput || textInput.trim().length === 0) {
        throw new Error('textInput cannot be empty.');
    }
    if (!fileName || !fileName.trim().length === 0) {
        throw new Error('fileName cannot be empty.');
    }

    console.log(
        `Requesting TTS from ElevenLabs for voice ${voiceId}. Text: "${textInput.substring(0, 50)}..."`
    );

    try {
        // Make the API call to get the audio stream
        const audioStream = await elevenLabs.textToSpeechStream({
            voiceId: voiceId,
            textInput: textInput,
            // Optional parameters:
            // modelId: "eleven_multilingual_v2", // Specify model if needed
            // outputFormat: 'mp3_44100_128', // Specify output format if needed (check ElevenLabs docs for options)
            // stability: 0.5,
            // similarityBoost: 0.75,
        });

        // Process the audio stream
        const chunks = [];
        // Return a new Promise to handle the stream events asynchronously
        return new Promise((resolve, reject) => {
            // Collect data chunks as they arrive
            audioStream.on('data', chunk => {
                chunks.push(chunk);
            });

            // When the stream ends, process the collected data
            audioStream.on('end', async () => {
                try {
                    console.log(
                        `TTS stream ended for "${fileName}". Processing audio buffer.`
                    );
                    // Concatenate all received chunks into a single buffer
                    const audioBuffer = Buffer.concat(chunks);

                    // Determine the absolute path to save the file in the 'public' directory
                    // Correctly navigates up from 'src/services' to 'src' then into 'public'
                    const filePath = path.join(
                        __dirname,
                        '..',
                        'public',
                        fileName
                    );

                    // Asynchronously write the audio buffer to the file
                    await fs.writeFile(filePath, audioBuffer);
                    console.log(
                        `TTS audio file successfully saved at: ${filePath}`
                    );

                    // Construct the publicly accessible URL using the ngrok URL
                    const publicUrl = `${ngrokUrl}/${fileName}`;
                    resolve(publicUrl); // Resolve the promise with the public URL
                } catch (fileError) {
                    // Handle errors during file writing
                    console.error(
                        `Error writing TTS audio file "${fileName}":`,
                        fileError
                    );
                    reject(
                        new InternalServerError(
                            `Error writing TTS audio file: ${fileError.message}`,
                            500,
                            fileError.stack
                        )
                    );
                }
            });

            // Handle errors occurring on the stream itself (e.g., API errors)
            audioStream.on('error', error => {
                console.error(
                    `ElevenLabs API stream error for "${fileName}":`,
                    error
                );
                reject(
                    new ElevenLabsApiError(
                        `ElevenLabs API stream error: ${error.message}`,
                        500, // Assuming 500, check if ElevenLabs provides specific codes
                        error.stack
                    )
                );
            });
        });
    } catch (error) {
        // Catch errors during the initial API call setup (e.g., invalid API key)
        console.error(
            `Error initiating ElevenLabs TTS request for "${fileName}":`,
            error
        );
        // Ensure the error is wrapped correctly, check if error has status/stack
        const statusCode = error.response?.status || 500; // Try to get status from error if it's an HTTP error
        throw new ElevenLabsApiError(
            `Error generating TTS audio: ${error.message}`,
            statusCode,
            error.stack
        );
    }
}

export { elevenLabsTextToSpeech };
