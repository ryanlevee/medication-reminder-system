// src/config/twilio.js
import twilio from 'twilio';
import dotenv from 'dotenv';

dotenv.config();

const client = new twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);
const ngrokUrl = process.env.NGROK_URL;

async function updateIncomingCallWebhookUrls() {
    try {
        await client.incomingPhoneNumbers.each(item =>
            item.update({
                voiceUrl: `${ngrokUrl}/incoming-call`,
            })
        );
        console.log(
            `Incoming call webhook URLs updated to: ${ngrokUrl}/incoming-call`
        );
    } catch (error) {
        console.error('Error updating webhook URL:', error);
    }
}

export { updateIncomingCallWebhookUrls };