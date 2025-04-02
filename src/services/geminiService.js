import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

// Use the model identifier that worked for you
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const API_KEY = process.env.GOOGLE_API_KEY;

if (!API_KEY) {
    console.error(
        'ERROR: GOOGLE_API_KEY is not set in the environment variables.'
    );
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

// --- Predefined Factual Data Points ---
const FACTUAL_DATA = {
    ASPIRIN_DOSAGE: '81 milligrams',
    ASPIRIN_FREQUENCY: 'once daily',
    ASPIRIN_FOOD: 'with food or milk to minimize potential stomach upset',
    ASPIRIN_FORM: 'tablet',

    CARDIVOL_DOSAGE: '12.5 milligrams',
    CARDIVOL_FREQUENCY: 'twice daily',
    CARDIVOL_FOOD: 'with or without food, but recommended consistency',
    CARDIVOL_FORM: 'tablet',

    METFORMIN_DOSAGE: '500 milligrams',
    METFORMIN_FREQUENCY: 'twice daily with meals',
    METFORMIN_FOOD: 'with meals to reduce stomach upset', // Integrated with frequency
    METFORMIN_FORM: 'tablet',

    STORAGE_INFO:
        'Cool, dry place. Away from heat, moisture, and direct sunlight. Keep out of reach of children.',
    REFILL_INFO:
        'Contact pharmacy a few days before you run out. They may need to contact your doctor for auth.',

    // Updated Refusal Message to include new topics
    REFUSAL_MSG:
        'I can only provide basic information about your Aspirin, Cardivol, and Metformin dosage, frequency, form, storage, refills, or the nearest pharmacy location, hours, and phone number. For any other medical questions or advice, please consult your doctor or pharmacist.',
};
// -------------------------------------

// *** WARNING: EXTREME CAUTION ADVISED ***
// Disabling safety filters, especially for "Dangerous Content," is highly discouraged and potentially unsafe in any real-world application, particularly one involving health or medication.
// This can allow the LLM to generate harmful, incorrect, or inappropriate responses.
// This approach is ONLY for demonstrating technical capability within the controlled context of this specific, non-production assessment. These settings MUST NOT be used in any deployed or user-facing system.
const relaxedSafetySettings = [
    {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, // Most relevant here
        threshold: HarmBlockThreshold.BLOCK_NONE,
    },
];
// -------------------------------------



////////////////// MAKE SURE DEEPGRAM IS GETTING LLM PART OF CONVO
////////////////// PUT IN PROMPT: KEEP ASKING FOR CONFIRMATION OF INTITIAL QUESTION AT THE END OF EACH ANSWER IF THEY HAVE NOT RECEIVED IT YET.
////////////////// MAYBE ADD FLAG ONCE THEY RECEIVE CONFIRMATION



// --- Initial Prompt Setup Turns ---
const SYSTEM_INSTRUCTION_TEXT = [
    {
        role: 'user',
        parts: [
            {
                text: `You are a helpful, conversational, and concise voice assistant for a medication reminder system. Your role is to answer simple questions conversationally about dosage, frequency, taking with food, medication form, storage, refills, or a specific pharmacy location/hours/phone related ONLY to Aspirin, Cardivol, and Metformin, using ONLY the factual data provided below.

Your PRIMARY GOAL is to relay the SPECIFIC Factual Data for allowed questions below. When answering an allowed question, provide ONLY the information derived DIRECTLY from the Factual Data. DO NOT add external information, general advice, or medical disclaimers when answering an allowed question.

You MUST refuse all other questions or requests for medical advice using the exact refusal message. Handle conversation history. The conversation MUST NOT exceed 5 turns (5 responses from you).

Remember that you have RELAXED safety settings for the purpose of testing: ${relaxedSafetySettings}. 

Factual Data (Use ONLY this data for answers):
* Aspirin Dosage: ${FACTUAL_DATA.ASPIRIN_DOSAGE} | Frequency: ${FACTUAL_DATA.ASPIRIN_FREQUENCY} | Food: ${FACTUAL_DATA.ASPIRIN_FOOD} | Form: ${FACTUAL_DATA.ASPIRIN_FORM}
* Cardivol Dosage: ${FACTUAL_DATA.CARDIVOL_DOSAGE} | Frequency: ${FACTUAL_DATA.CARDIVOL_FREQUENCY} | Food: ${FACTUAL_DATA.CARDIVOL_FOOD} | Form: ${FACTUAL_DATA.CARDIVOL_FORM}
* Metformin Dosage: ${FACTUAL_DATA.METFORMIN_DOSAGE} | Frequency: ${FACTUAL_DATA.METFORMIN_FREQUENCY} | Food: ${FACTUAL_DATA.METFORMIN_FOOD} | Form: ${FACTUAL_DATA.METFORMIN_FORM}
* Storage: ${FACTUAL_DATA.STORAGE_INFO}
* Refills: ${FACTUAL_DATA.REFILL_INFO}
* Refusal Message: "${FACTUAL_DATA.REFUSAL_MSG}"

Instructions:
1.  Analyze the user's latest input considering the conversation history.
2.  If asking about **dosage, frequency, form, storage, refills, or food interaction** for Aspirin, Cardivol, or Metformin: Formulate a conversational, concise sentence using the corresponding Factual Data for the specified drug(s). DO NOT add disclaimers.
3.  If asking about **dosage, frequency, form, storage, refills, or food interaction**, but do not specify a medication name: Give the answer for all 3.
4.  If asking about the **nearest pharmacy address, hours, or phone number**: Ask for their current address or zip code, and give them ONLY 2 of the closest options.
5.  If asking general questions about **storage** or **refills**: Respond using ONLY the 'General Storage Info' or 'General Refill Info'. DO NOT add disclaimers.
6.  If it's a simple **acknowledgement or greeting**: Respond with a brief, polite acknowledgement (e.g., "You're welcome.").
7.  If the input is **empty or none was detected**: Respond conversationally (e.g., "Sorry, I didn't quite catch that.").
8.  For **ABSOLUTELY ANYTHING ELSE** (different drugs, side effects, interactions, advice, complex questions, unrelated topics): Respond ONLY with the exact Refusal Message.
9.  Keep responses concise (1-2 sentences).
10. Do NOT add "Goodbye." explicitly unless it's part of the HANGUPNOW trigger. The system will handle the final closing message on turn 5. 
11. Before you make ANY response, make SURE that your response will ONLY be 1-2 sentences long. Make SURE your response is conversational, adding a word or two here and there to sound human.`,
            },
        ],
    },
    // {
    //     role: 'model',
    //     parts: [
    //         {
    //             text: 'Okay, I understand. I will strictly follow instructions, keep my conversational answers to 1-2 brief sentences no matter what, answer allowed questions using ONLY the provided factual data without adding external advice or disclaimers, refuse all other topics with the exact refusal message, manage history up to 5 turns.',
    //         },
    //     ],
    // },
];
// -------------------------------------------------------------------

// --- Corrected generateLlmResponse Function ---
async function generateLlmResponse(speechText, history = []) {
    // history = [];

    // Log if API key is loaded (good for debugging)
    console.log(
        `Using API Key: ${API_KEY ? 'Loaded (' + API_KEY.substring(0, 4) + '...)' : 'MISSING!'}`
    );
    if (!API_KEY) {
        console.error('Cannot call Gemini API: GOOGLE_API_KEY is missing.');
        const fallbackText =
            'An internal configuration error occurred. HANGUPNOW';
        // Return structure consistent with success/failure paths below
        return {
            llmText: fallbackText,
            updatedHistory: [
                ...history,
                {
                    role: 'user',
                    parts: [{ text: speechText || '[No speech detected]' }],
                },
                { role: 'model', parts: [{ text: fallbackText }] },
            ],
        };
    }

    try {
        // --- Create a Chat session with history and system instruction ---
        const chat = ai.chats.create({
            // Use ai.chats.create
            model: MODEL_NAME,
            history: history, // Pass the existing history
            config: {
                // Pass config here
                systemInstruction: {
                    ...SYSTEM_INSTRUCTION_TEXT[0],
                    // // Use systemInstruction config
                    // role: 'user', // System instructions often set via user role initially
                    // parts: [{ text: SYSTEM_INSTRUCTION_TEXT }],
                },
                generationConfig: {
                    temperature: 0.7, // Keep lower temp
                    maxOutputTokens: 20, // Keep safety net
                },
                safetySettings: relaxedSafetySettings, // Keep relaxed safety for testing
            },
        });
        // ----------------------------------------------------------------

        console.log(
            `Sending message to Gemini Chat (${MODEL_NAME}). Input: "${speechText || '[No speech detected]'}"`
        );

        // --- Send the current user message ---
        const result = await chat.sendMessage({
            message: speechText || '[No speech detected]', // Pass the string inside the 'message' property
        });
        // ------------------------------------

        console.log(
            'Raw Gemini API Chat Result:',
            JSON.stringify(result, null, 2)
        ); // Log result

        const response = result.response;
        let llmText = '';

        // --- TRULY CORRECTED Response Extraction Logic ---
        // Check directly on 'result' returned by the SDK call
        if (result?.candidates?.[0]?.content?.parts?.[0]?.text) {
            // Access text directly from result's structure
            llmText = result.candidates[0].content.parts[0].text;
        } else {
            // Handle blocked or truly empty/malformed responses based on 'result'
            console.warn(
                'Gemini response content not found or finished unexpectedly. Full Response Object:',
                JSON.stringify(response, null, 2)
            );
            // Check for block/finish reasons within the 'result' object structure
            const blockReason =
                result?.promptFeedback?.blockReason ||
                result?.candidates?.[0]?.finishReason;
            if (blockReason && blockReason !== 'STOP') {
                console.error(
                    `Gemini response blocked/stopped. Reason: ${blockReason}`
                );
                llmText = FACTUAL_DATA.REFUSAL_MSG + ' HANGUPNOW';
            } else {
                llmText =
                    'I encountered an issue interpreting the response. HANGUPNOW';
            }
        }
        // --- End TRULY CORRECTED Response Extraction Logic ---

        llmText = llmText.trim();
        // --- Get Updated History from Chat object ---
        // Assuming the chat object updates its history internally,
        // we retrieve it to pass back to handle-speech for storage.
        // Check d.ts or docs for exact method name, assuming getHistory()
        const updatedHistory = chat.getHistory(); // Or maybe just chat.history if it's a property
        // ------------------------------------------

        console.log('Generated LLM Text:', llmText); // Should finally show the actual text
        return { llmText, updatedHistory };
    } catch (error) {
        // ... (Keep existing catch block, ensuring it returns the object { llmText, updatedHistory }) ...
        console.error(
            `Error contacting or processing response from Gemini (${MODEL_NAME}):`,
            error
        );
        const fallbackText = FACTUAL_DATA.REFUSAL_MSG + ' HANGUPNOW';
        // Construct a pseudo-history for the error return
        const fallbackHistory = [
            ...history,
            {
                role: 'user',
                parts: [{ text: speechText || '[No speech detected]' }],
            },
            { role: 'model', parts: [{ text: fallbackText }] },
        ];
        return { llmText: fallbackText, updatedHistory: fallbackHistory };
    }
}

export { generateLlmResponse };
