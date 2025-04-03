/**
 * @fileoverview Defines the TtsHolder class to store and manage predefined TTS strings and configuration.
 * This acts as a centralized place to access the text for standard voice prompts
 * like the medication reminder and unanswered call messages, as well as the configured
 * ElevenLabs voice ID. It uses a static instance to provide singleton-like access.
 *
 * @requires dotenv - For loading environment variables (specifically ELEVENLABS_VOICE_ID).
 */

import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

/**
 * A class designed to hold predefined Text-to-Speech (TTS) strings and related configuration
 * like the voice ID. It utilizes a static instance (`ttsHolder`) to ensure that these
 * values are consistently accessed and potentially modified (if setters are used) throughout
 * the application, behaving like a singleton for TTS configuration.
 *
 * @class TtsHolder
 */
export class TtsHolder {
    /**
     * The static instance of the TtsHolder class.
     * All static getters/setters operate on this instance.
     * @type {TtsHolder}
     * @static
     */
    static ttsHolder = new TtsHolder();

    /**
     * Initializes the TtsHolder instance with default reminder/unanswered messages
     * and loads the ElevenLabs voice ID from environment variables.
     * @constructor
     */
    constructor() {
        /**
         * The standard medication reminder message text.
         * @private
         * @type {string}
         */
        this._reminder =
            "Hello, this is a reminder from your healthcare provider to confirm your medications for the day. Please confirm if you have taken your Aspirin, Cardivol, and Metformin today. After you've confirmed, you can ask me questions regarding your medication. I'm here to help."; // User's original text

        /**
         * The message text used for unanswered calls (voicemail/SMS).
         * @private
         * @type {string}
         */
        this._unanswered =
            "We called to check on your medication but couldn't reach you. Please call us back or take your medications if you haven't done so."; // User's original text

        /**
         * The ElevenLabs voice ID to be used for TTS generation.
         * Loaded from the ELEVENLABS_VOICE_ID environment variable.
         * @private
         * @type {string | undefined}
         */
        this._voiceId = process.env.ELEVENLABS_VOICE_ID;

        // Log if voice ID is missing during initialization
        if (!this._voiceId) {
            console.warn(
                'TtsHolder initialized, but ELEVENLABS_VOICE_ID environment variable is not set.'
            );
        }
    }

    /**
     * Gets the standard medication reminder TTS text.
     * @static
     * @type {string}
     */
    static get reminder() {
        return this.ttsHolder._reminder;
    }

    /**
     * Sets the standard medication reminder TTS text.
     * (Note: Typically only getters are needed if the text is predefined).
     * @static
     * @param {string} tts - The new reminder text.
     */
    static set reminder(tts) {
        this.ttsHolder._reminder = tts;
    }

    /**
     * Gets the standard unanswered call TTS text.
     * @static
     * @type {string}
     */
    static get unanswered() {
        return this.ttsHolder._unanswered;
    }

    /**
     * Sets the standard unanswered call TTS text.
     * @static
     * @param {string} tts - The new unanswered call text.
     */
    static set unanswered(tts) {
        this.ttsHolder._unanswered = tts;
    }

    /**
     * Gets the configured ElevenLabs voice ID.
     * @static
     * @type {string | undefined}
     */
    static get voiceId() {
        // Add a check here in case the env var wasn't set during init
        if (!this.ttsHolder._voiceId) {
            console.error(
                'Attempted to get voiceId, but ELEVENLABS_VOICE_ID was not set.'
            );
        }
        return this.ttsHolder._voiceId;
    }

    /**
     * Sets the ElevenLabs voice ID.
     * @static
     * @param {string} id - The new voice ID.
     */
    static set voiceId(id) {
        this.ttsHolder._voiceId = id;
    }
}

// Example usage (optional):
// console.log("Reminder Text:", TtsHolder.reminder);
// console.log("Voice ID:", TtsHolder.voiceId);
