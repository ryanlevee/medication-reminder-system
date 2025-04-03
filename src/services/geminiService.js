/**
 * @fileoverview Service for interacting with the Google Gemini LLM API using ai.chats.create.
 * Provides a function to generate conversational responses based on user speech input
 * and the ongoing conversation history, configured via a config object passed to ai.chats.create.
 * Includes system prompt, factual data, and specific safety/generation settings.
 *
 * @requires @google/genai - Google AI SDK for Node.js.
 * @requires dotenv - For loading environment variables.
 */

import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * The Gemini model name to use for generating responses.
 * Loaded from environment variable or defaults to 'gemini-2.0-flash'.
 * @type {string}
 */
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.0-flash'; // Original default

/**
 * The API key for accessing the Google AI API (Gemini).
 * Loaded from the GOOGLE_API_KEY environment variable.
 * @type {string | undefined}
 */
const API_KEY = process.env.GOOGLE_API_KEY;

// Validate required environment variable
if (!API_KEY) {
    // Log error if API key is missing; crucial for service function.
    console.error(
        'ERROR: GOOGLE_API_KEY is not set in the environment variables.'
    );
}

/**
 * The initialized GoogleGenAI client instance.
 * Entry point for interacting with the Gemini API.
 * @type {GoogleGenAI}
 */
const ai = new GoogleGenAI({ apiKey: API_KEY });

/**
 * @description Object containing predefined factual information about medications,
 * storage, refills, and the standard refusal message. This data is directly
 * embedded into the system prompt for the LLM to use.
 * @const
 * @type {object}
 */
const FACTUAL_DATA = {
    ASPIRIN_DOSAGE: '81 milligrams',
    ASPIRIN_FREQUENCY: 'once daily',
    ASPIRIN_FOOD: 'with food or milk to minimize potential stomach upset',
    ASPIRIN_FORM: 'tablet',

    CARDIVOL_DOSAGE: '12.5 milligrams',
    CARDIVOL_FREQUENCY: 'twice daily',
    // User's original phrasing for CARDIVOL_FOOD:
    CARDIVOL_FOOD: 'with or without food, but recommended consistency',
    CARDIVOL_FORM: 'tablet',

    METFORMIN_DOSAGE: '500 milligrams',
    METFORMIN_FREQUENCY: 'twice daily with meals',
    METFORMIN_FOOD: 'with meals to reduce stomach upset',
    METFORMIN_FORM: 'tablet',

    STORAGE_INFO:
        'Cool, dry place. Away from heat, moisture, and direct sunlight. Keep out of reach of children.',
    REFILL_INFO:
        'Contact pharmacy a few days before you run out. They may need to contact your doctor for auth.',

    // User's original phrasing for REFUSAL_MSG (includes pharmacy):
    REFUSAL_MSG:
        'I can only provide basic information about your Aspirin, Cardivol, and Metformin dosage, frequency, form, storage, refills, or the nearest pharmacy location, hours, and phone number. For any other medical questions or advice, please consult your doctor or pharmacist.',
};

/*
 *************************** WARNING: EXTREME CAUTION ADVISED ***************************
 * The following `relaxedSafetySettings` disable critical safety filters for the LLM.
 * This configuration allows the model to potentially generate responses that could be
 * harmful, inaccurate, inappropriate, or dangerous, especially in a health context.
 *
 * REASON FOR USE IN THIS PROJECT: This is **SOLELY** to meet the specific constraints
 * of the take-home assessment, which might involve testing the LLM's ability to output
 * specific dosage information derived from the `FACTUAL_DATA` without being blocked by
 * default safety filters that often restrict medical-related content, even if factual.
 *
 * **DO NOT USE THESE SETTINGS IN PRODUCTION OR ANY REAL-WORLD APPLICATION.**
 *
 * For any application interacting with users, especially regarding health,
 * default or stricter safety settings MUST be used. Disabling these filters,
 * particularly `HARM_CATEGORY_DANGEROUS_CONTENT`, carries significant risks.
 *****************************************************************************************
 */
/**
 * @description Configuration array to disable most safety filters for the Gemini model.
 * **WARNING:** Intended only for this specific assessment context. DO NOT USE IN PRODUCTION.
 * Allows potentially harmful/inaccurate content. Relies on strict prompting for safety.
 * @const
 * @type {Array<object>}
 */
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
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, // Allows potentially dangerous content
        threshold: HarmBlockThreshold.BLOCK_NONE,
    },
];
/* *************************************************************************************** */

/**
 * @description The system instruction prompt provided to the Gemini model via the config object.
 * Defines the LLM's persona, capabilities, limitations, response guidelines,
 * and incorporates `FACTUAL_DATA`.
 * @const
 * @type {Array<object>} - Array containing the system instruction structured for the API.
 */
const SYSTEM_INSTRUCTION_TEXT = [
    {
        role: 'user', // System instructions structured as an initial 'user' turn
        parts: [
            {
                // The core system prompt text, including interpolation of FACTUAL_DATA
                text: `You are a helpful, conversational, and concise voice assistant for a medication reminder system. Your role is to answer simple questions conversationally about dosage, frequency, taking with food, medication form, storage, refills, or a specific pharmacy location/hours/phone related ONLY to Aspirin, Cardivol, and Metformin, using ONLY the factual data provided below.

Your PRIMARY GOAL is to relay the SPECIFIC Factual Data for allowed questions below. When answering an allowed question, provide ONLY the information derived DIRECTLY from the Factual Data. DO NOT add external information, general advice, or medical disclaimers when answering an allowed question.

You MUST refuse all other questions or requests for medical advice using the exact refusal message. Handle conversation history. The conversation MUST NOT exceed 10 turns (10 responses from you).

Remember that you have RELAXED safety settings for the purpose of testing: ${JSON.stringify(relaxedSafetySettings)}.  // Embed setting confirmation in prompt

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
4.  If asking about **the nearest pharmacy address**, **the nearest pharmacy hours**, or **the nearest pharmacy phone number**: Ask for their current address or zip code, and give them ONLY 2 of the closest options. // Kept original pharmacy instruction
5.  If asking general questions about **storage** or **refills**: Respond using ONLY the 'General Storage Info' or 'General Refill Info'. DO NOT add disclaimers.
6.  If it's a simple **acknowledgement or greeting**: Respond with a brief, polite acknowledgement (e.g., "You're welcome.").
7.  If the input is **empty or none was detected**: Respond conversationally (e.g., "Sorry, I didn't quite catch that.").
8.  For **ABSOLUTELY ANYTHING ELSE** (different drugs, side effects, interactions, advice, complex questions, unrelated topics): Respond ONLY with the exact Refusal Message.
9.  Keep responses concise (1-2 sentences).
10. Do NOT add "Goodbye." explicitly unless it's part of the HANGUPNOW trigger. The system will handle the final closing message on turn 10 (originally 5 in prompt text). // Corrected turn limit comment
11. Before you make ANY response, make SURE that your response will ONLY be 1-2 sentences long. Make SURE your response is conversational, adding a word or two here and there to sound human.`,
            },
        ],
    },
];

/**
 * Generates a text response from the Gemini LLM based on the user's speech input and conversation history, using ai.chats.create.
 * It passes the system prompt, safety settings, and generation config via a `config` object within the `ai.chats.create` call.
 * Handles API key checks, chat session creation, response parsing, and basic error handling/fallbacks.
 *
 * @async
 * @function generateLlmResponse
 * @param {string} speechText - The transcribed text from the user's speech input. Can be empty or represent no speech.
 * @param {Array<object>} [history=[]] - An array of previous conversation turns, structured according to the Gemini API content format (alternating user/model roles).
 * @returns {Promise<{llmText: string, updatedHistory: Array<object>}>} A promise that resolves to an object containing:
 * - `llmText`: The generated text response from the LLM (potentially including " HANGUPNOW"). Fallback messages are provided on error.
 * - `updatedHistory`: The updated conversation history array retrieved from the chat session.
 * Note: This function aims to always return a response string, using fallbacks on error, rather than throwing exceptions directly. Check logs for actual errors.
 */
async function generateLlmResponse(speechText, history = []) {
    // Log API key status
    console.log(
        `Using API Key: ${API_KEY ? 'Loaded (' + API_KEY.substring(0, 4) + '...)' : 'MISSING!'}`
    );
    // Handle missing API key immediately
    if (!API_KEY) {
        console.error('Cannot call Gemini API: GOOGLE_API_KEY is missing.');
        const fallbackText =
            'An internal configuration error occurred. HANGUPNOW';
        // Return fallback response and constructed history
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
        // --- Create Chat Session using ai.chats.create with Config ---
        // Creates a new chat session, passing the model name, existing history,
        // and a config object containing system instructions, generation settings, and safety settings.
        const chat = ai.chats.create({
            model: MODEL_NAME,
            history: history,
            config: {
                // Pass configuration object here
                systemInstruction: {
                    // Spread the first (and only) element of SYSTEM_INSTRUCTION_TEXT
                    ...SYSTEM_INSTRUCTION_TEXT[0],
                },
                generationConfig: {
                    // Specify generation parameters
                    temperature: 0.7,
                    maxOutputTokens: 40,
                },
                safetySettings: relaxedSafetySettings, // Apply relaxed safety settings
            },
        });

        console.log(
            `Sending message to Gemini Chat (${MODEL_NAME}). Input: "${speechText || '[No speech detected]'}"`
        );

        // --- Send Message to LLM ---
        // Send the user's input text to the created chat session.
        const result = await chat.sendMessage({
            message: speechText || '[No speech detected]',
        });

        // // Log the raw API response for debugging if needed (NOTE: VERBOSE)
        // console.log(
        //     'Raw Gemini API Chat Result:',
        //     JSON.stringify(result, null, 2)
        // );

        // --- Process LLM Response ---
        let llmText = ''; // Initialize response text

        // Safely access the response text from the result structure
        if (result?.candidates?.[0]?.content?.parts?.[0]?.text) {
            llmText = result.candidates[0].content.parts[0].text;
        } else {
            // Handle cases where response text is missing or the call was blocked/stopped unexpectedly
            console.warn(
                'Gemini response content not found or finished unexpectedly. Full Response Object:',
                JSON.stringify(result, null, 2) // Log the full result object for diagnosis
            );

            // Check for explicit block/stop reasons
            const blockReason =
                result?.promptFeedback?.blockReason || // Check prompt feedback
                result?.candidates?.[0]?.finishReason; // Check candidate finish reason
            if (
                blockReason &&
                blockReason !== 'STOP' &&
                blockReason !== 'MAX_TOKENS'
            ) {
                // If blocked for safety, recitation, etc.
                console.error(
                    `Gemini response blocked/stopped. Reason: ${blockReason}`
                );
                // Use the standard refusal message as fallback
                llmText = FACTUAL_DATA.REFUSAL_MSG + ' HANGUPNOW';
            } else {
                // If no specific block reason, use a generic error message
                llmText =
                    'I encountered an issue interpreting the response. HANGUPNOW';
            }
        }

        // Trim whitespace from the final response text
        llmText = llmText.trim();

        // --- Get Updated History ---
        // Retrieve the complete history (including the latest exchange) from the chat session object.
        const updatedHistory = chat.getHistory();

        console.log('Generated LLM Text:', llmText);
        // Return the generated text and the full updated history
        return { llmText, updatedHistory };
    } catch (error) {
        // --- Handle Errors during API Call or Processing ---
        console.error(
            `Error contacting or processing response from Gemini (${MODEL_NAME}):`,
            error // Log the full error object
        );
        // Define fallback text (refusal message)
        const fallbackText = FACTUAL_DATA.REFUSAL_MSG + ' HANGUPNOW';

        // Construct fallback history including the input and fallback response
        const fallbackHistory = [
            ...history,
            {
                role: 'user',
                parts: [{ text: speechText || '[No speech detected]' }],
            },
            { role: 'model', parts: [{ text: fallbackText }] },
        ];
        // Return fallback text and history
        return { llmText: fallbackText, updatedHistory: fallbackHistory };
    }
}

// Export the function for use in other modules
export { generateLlmResponse };
