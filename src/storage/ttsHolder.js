import dotenv from 'dotenv';
dotenv.config();

export class TtsHolder {
    static ttsHolder = new TtsHolder();

    constructor() {
        this._reminder =
            "Hello, this is a reminder from your healthcare provider to confirm your medications for the day. Please confirm if you have taken your Aspirin, Cardivol, and Metformin today. After you've confirmed, you can ask me questions regarding your medication. I'm here to help.";
        this._unanswered =
            "We called to check on your medication but couldn't reach you. Please call us back or take your medications if you haven't done so.";
        this._voiceId = process.env.ELEVENLABS_VOICE_ID;
    }

    static get reminder() {
        return this.ttsHolder._reminder;
    }

    static set reminder(tts) {
        this.ttsHolder._reminder = tts;
    }

    static get unanswered() {
        return this.ttsHolder._unanswered;
    }

    static set unanswered(tts) {
        this.ttsHolder._unanswered = tts;
    }

    static get voiceId() {
        return this.ttsHolder._voiceId;
    }

    static set voiceId(id) {
        this.ttsHolder._voiceId = id;
    }
}
