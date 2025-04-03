/**
 * @fileoverview Utility function for standardized console logging of call interaction summaries.
 * Provides a consistent format for logging key call information like SID and status,
 * along with optional additional details, to the console during request processing.
 */

/**
 * Logs a formatted summary of a call interaction to the console.
 * Helps in debugging and tracing call flows by providing standardized output.
 *
 * @function consoleLogCall
 * @param {object} callInfo - Object containing core call identifiers.
 * @param {string} callInfo.callSid - The Twilio Call SID associated with the event.
 * @param {string} callInfo.status - A descriptive status message for the event being logged.
 * @param {object} [args] - Optional. An object containing any additional key-value pairs
 * to be logged for more context (e.g., { smsSid: 'SM...', recordingUrl: '...' }).
 * @returns {void}
 */
export const consoleLogCall = ({ callSid, status }, args) => {
    // Simple validation
    if (!callSid || typeof callSid !== 'string') {
        console.error('consoleLogCall error: callSid is missing or invalid.');
        callSid = 'INVALID_SID'; // Use placeholder
    }
    if (typeof status !== 'string') {
        console.warn('consoleLogCall warning: status is not a string.');
        status = String(status); // Attempt conversion
    }

    console.log(`--- Call Interaction Summary ---`);
    console.log(`Call SID: ${callSid}`);
    console.log(`Status: "${status}"`); // Add quotes around status for clarity
    // Only log additional args if the args object is provided and has keys
    if (args && typeof args === 'object' && Object.keys(args).length > 0) {
        // Log each key-value pair from the args object for detailed context
        console.log('Details:', JSON.stringify(args, null, 2)); // Pretty print details
    }
    console.log(`--------------------------------`);
    // No explicit return value (implicitly returns undefined)
};

// Example Usage:
// consoleLogCall({ callSid: 'CA123...', status: 'Call initiated' });
// consoleLogCall({ callSid: 'CA456...', status: 'SMS fallback sent' }, { smsSid: 'SM789...', recipient: '+1...' });
// consoleLogCall({ callSid: 'CA789...', status: 'Error processing speech' }, { error: 'LLM Timeout', turn: 3 });
