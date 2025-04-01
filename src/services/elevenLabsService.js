// src/services/elevenLabsService.js
import ElevenLabsClient from 'elevenlabs-node';
import path, { dirname } from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config();

const elevenLabs = new ElevenLabsClient({
    apiKey: process.env.ELEVENLABS_API_KEY,
});
const ngrokUrl = process.env.NGROK_URL;

async function elevenLabsTextToSpeech(voiceId, textInput, fileName) {
    try {
        console.log({
            voiceId,
            textInput,
        });
        const audioStream = await elevenLabs.textToSpeechStream({
            voiceId,
            textInput,
        });

        const chunks = [];
        return new Promise((resolve, reject) => {
            audioStream.on('data', chunk => {
                chunks.push(chunk);
            });
            audioStream.on('end', async () => {
                const audioBuffer = Buffer.concat(chunks);
                const filePath = path.join(__dirname, '../../public', fileName); // Adjust path as needed
                await fs.writeFile(filePath, audioBuffer);
                console.log('File created at: ', filePath);
                resolve(`${ngrokUrl}/${fileName}`);
            });
            audioStream.on('error', reject);
        });
    } catch (error) {
        console.error('Error generating TTS audio:', error);
        return null;
    }
}

export { elevenLabsTextToSpeech };
