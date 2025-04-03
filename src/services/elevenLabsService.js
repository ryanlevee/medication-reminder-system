import dotenv from 'dotenv';
import ElevenLabsClient from 'elevenlabs-node';
import fs from 'fs/promises';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import ElevenLabsApiError from '../errors/ElevenLabsApiError.js';
import InternalServerError from '../errors/InternalServerError.js';

dotenv.config();

const elevenLabs = new ElevenLabsClient({
    apiKey: process.env.ELEVENLABS_API_KEY,
});
const ngrokUrl = process.env.NGROK_URL;

async function elevenLabsTextToSpeech(textInput, fileName) {
    const voiceId = process.env.ELEVENLABS_VOICE_ID
    
    try {
        console.log({
            voiceId,//: TtsHolder.voiceId,
            textInput,
        });
        const audioStream = await elevenLabs.textToSpeechStream({
            voiceId,//: TtsHolder.voiceId,
            textInput,
        });

        const chunks = [];
        return new Promise((resolve, reject) => {
            audioStream.on('data', chunk => {
                chunks.push(chunk);
            });
            audioStream.on('end', async () => {
                const audioBuffer = Buffer.concat(chunks);
                const currentFilePath = fileURLToPath(import.meta.url); // Plugin will transform this
                const currentDir = dirname(currentFilePath);
                const filePath = path.join(currentDir, '../public', fileName); // Use calculated dir

                try {
                    await fs.writeFile(filePath, audioBuffer);
                    console.log('File created at: ', filePath);
                    resolve(`${ngrokUrl}/${fileName}`);
                } catch (error) {
                    console.error('Error writing TTS audio file:', error);
                    reject(
                        new InternalServerError(
                            'Error writing TTS audio file',
                            500,
                            error.stack
                        )
                    );
                }
            });
            audioStream.on('error', error => {
                console.error('ElevenLabs API stream error:', error);
                reject(
                    new ElevenLabsApiError(
                        'ElevenLabs API stream error',
                        500,
                        error.stack
                    )
                );
            });
        });
    } catch (error) {
        console.error('Error generating TTS audio:', error);
        throw new ElevenLabsApiError(
            'Error generating TTS audio',
            500,
            error.stack
        );
    }
}

export { elevenLabsTextToSpeech };

