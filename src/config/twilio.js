/*
file: C:\Users\ryanl\Documents\Coding\medication-reminder-system\src\config/twilio.js
*/
import twilio from 'twilio';
import dotenv from 'dotenv';
import TwilioApiError from '../errors/TwilioApiError.js';

dotenv.config();

const client = new twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);
const ngrokUrl = process.env.NGROK_URL;

async function updateIncomingCallWebhookUrls() {
    try {
        const updatedNumbers = [];
        await client.incomingPhoneNumbers.each(async item => {
            await item.update({
                voiceUrl: `${ngrokUrl}/incoming-call`,
            });
            updatedNumbers.push(item.friendlyName || item.phoneNumber);
        });
        console.log(
            `Incoming call webhook URLs updated for: ${updatedNumbers.join(', ')} to ${ngrokUrl}/incoming-call`
        );
    } catch (error) {
        console.error('Error updating Twilio webhook URLs:', error.message);
        throw new TwilioApiError(
            'Error updating Twilio webhook URLs',
            500,
            error.stack
        );
    }
}

export { updateIncomingCallWebhookUrls };
