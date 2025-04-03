# Medication Reminder System

## Overview

This project is a Node.js-based voice-driven medication reminder system, developed as a take-home assessment. It utilizes real-time communication technologies, primarily Twilio, along with Text-to-Speech (TTS), Speech-to-Text (STT), and a Large Language Model (LLM), to interact with users about their medication schedules. The system can initiate outbound calls, handle inbound calls, manage conversational interactions, provide fallback notifications via SMS, and log call details persistently.

## Features

-   **Outbound Call Trigger:** Initiate voice calls to specified phone numbers via a `POST /call` REST API endpoint.
-   **Real-time TTS:** Uses ElevenLabs to generate voice prompts for medication reminders and voicemail messages.
-   **Real-time STT:** Leverages Deepgram via WebSockets (`<Stream>`) to transcribe user speech during calls in real-time.
-   **LLM Interaction:** Integrates with Google Gemini to provide conversational responses to user queries about specific medications (Aspirin, Cardivol, Metformin), dosage, frequency, storage, etc., based on predefined factual data and a system prompt.
-   **Call Flow Management:**
    -   Plays specific TTS prompts based on whether a human or answering machine (AMD) answers the call.
    -   Handles user speech input via Twilio `<Gather>`.
    -   Manages conversation turns, providing specific responses or refusals based on LLM output and conversation limits.
    -   Handles calls made *to* the system's Twilio number, playing the reminder and gathering input.
-   **Unanswered Call Handling:**
    -   Leaves a TTS voicemail message if an answering machine is detected.
    -   Sends an SMS fallback reminder via Twilio API if a call is unanswered, busy, failed, or if voicemail detection is uncertain (`AnsweredBy: unknown`).
-   **Logging:**
    -   Outputs concise call interaction summaries to the console during operation.
    -   Stores detailed event logs (initiation, status updates, TTS/LLM interactions, transcripts, recordings) and error logs in Firebase Realtime Database, organized by CallSid.
    -   Logs the URL of call recordings to Firebase.
-   **Call Log API (Bonus Feature):**
    -   Provides a `GET /call-logs` REST API endpoint to retrieve stored call logs from Firebase.
    -   Supports filtering logs by specific `callSid`.
    -   Supports filtering logs by `startDate` and `endDate`.
    -   Supports pagination using `page` and `pageSize` query parameters.

## Technology Stack

-   **Backend:** Node.js, Express.js
-   **Real-time Communication:** Twilio (Voice API, TwiML, Media Streams via `<Stream>`, Recordings API, SMS API)
-   **TTS (Text-to-Speech):** ElevenLabs (via `elevenlabs-node`)
-   **STT (Speech-to-Text):** Deepgram (Live Transcription via `@deepgram/sdk` and WebSockets)
-   **LLM (Large Language Model):** Google Gemini (via `@google/genai`)
-   **Database:** Firebase Realtime Database (via `firebase-admin`)
-   **WebSockets:** `ws`, `express-ws`
-   **Testing:** Jest, Supertest
-   **Environment Management:** `dotenv`
-   **Development Tunneling:** Ngrok (Essential for local development)
-   **Utilities:** `uuid` (for unique IDs), `date-fns` (for date parsing/validation in `/call-logs`)

## Prerequisites

Before you begin, ensure you have the following installed and configured:

1.  **Node.js:** Version 18.x or later recommended. ([Download Node.js](https://nodejs.org/))
2.  **npm:** Usually included with Node.js.
3.  **Git:** For cloning the repository.
4.  **Ngrok:** Account and installed CLI tool. Required for exposing your local server to Twilio webhooks. ([Sign up/Download Ngrok](https://ngrok.com/))
5.  **Twilio Account:** You'll need API credentials and at least one Twilio phone number (preferably two: one Toll-Free for calls, one SMS-capable for fallback). ([Sign up for Twilio](https://www.twilio.com/))
6.  **ElevenLabs Account:** API key and a Voice ID for TTS generation. ([Sign up for ElevenLabs](https://elevenlabs.io/))
7.  **Deepgram Account:** API key for STT. ([Sign up for Deepgram](https://deepgram.com/))
8.  **Google Cloud Project / Google AI Studio:** API key for the Gemini API (enable Vertex AI API in GCP or generate from AI Studio). ([Google AI](https://ai.google.dev/) / [Google Cloud](https://cloud.google.com/))
9.  **Firebase Project:** A Google Firebase project with the Realtime Database enabled. ([Create Firebase Project](https://firebase.google.com/))

## Setup and Configuration

1.  **Clone the Repository:**
    ```bash
    git clone <your-repository-url>
    cd medication-reminder-system
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    ```
    (This will also install dev dependencies like Jest and Supertest).

3.  **Firebase Setup:**
    * Go to your Firebase project console.
    * Ensure the **Realtime Database** is created/enabled (select region, start in test or locked mode - locked recommended for production).
    * Find your **Database URL** (e.g., `https://<your-project-id>-default-rtdb.firebaseio.com`) and note it down for the `.env` file.
    * Generate a **Service Account Key:**
        * Go to Project settings (gear icon) > Service accounts.
        * Click "Generate new private key" and confirm. A JSON file will be downloaded.
    * **Save the Service Account Key:**
        * Create a directory `src/private`.
        * Rename the downloaded JSON key file *exactly* to `medication-reminder-syst-aa149-firebase-adminsdk-fbsvc-65cf0d6678.json` (as referenced in `src/config/firebase.js`).
        * Place this file inside the `src/private/` directory.
    * **IMPORTANT - Security:** Add `src/private/` to your `.gitignore` file to prevent committing your service account key. If `.gitignore` doesn't exist, create it in the project root and add the line:
        ```gitignore
        # .gitignore
        node_modules/
        .env
        src/private/
        *.mpeg # Ignore generated TTS audio files in public
        ```

4.  **Twilio Setup:**
    * Find your **Account SID** and **Auth Token** in your Twilio console dashboard.
    * Purchase or provision at least one Twilio phone number.
        * A **Toll-Free** number is recommended for the `TWILIO_PHONE_NUMBER_TOLL_FREE` environment variable (used for making outbound calls).
        * An **SMS-capable** number (often a local paid number) is needed for the `TWILIO_PHONE_NUMBER_PAID` environment variable (used for SMS fallbacks). This can be the same number if it supports both voice and SMS, but verify capabilities.

5.  **External API Keys:**
    * **ElevenLabs:** Get your API Key and a Voice ID from your ElevenLabs account settings/voice lab.
    * **Deepgram:** Get your API Key from your Deepgram project settings.
    * **Google Gemini:** Get your API Key from Google AI Studio or by enabling the Vertex AI API in your Google Cloud project.

6.  **Environment Variables (`.env`):**
    * Create a file named `.env` in the root directory of the project.
    * Copy the following template into the `.env` file and replace the placeholder values with your actual credentials and configuration details obtained in the previous steps. **Do not include `<` or `>` brackets.**

        ```dotenv
        # .env - Environment Variables

        # Twilio Configuration
        TWILIO_ACCOUNT_SID=<Your Twilio Account SID>
        TWILIO_AUTH_TOKEN=<Your Twilio Auth Token>
        TWILIO_PHONE_NUMBER_TOLL_FREE=<Your Toll-Free Twilio Number, e.g., +1800...>
        TWILIO_PHONE_NUMBER_PAID=<Your SMS-Capable Twilio Number, e.g., +1234...>

        # ElevenLabs Configuration
        ELEVENLABS_API_KEY=<Your ElevenLabs API Key>
        ELEVENLABS_VOICE_ID=<Your Chosen ElevenLabs Voice ID>

        # Deepgram Configuration
        DEEPGRAM_API_KEY=<Your Deepgram API Key>

        # Google Gemini Configuration
        GOOGLE_API_KEY=<Your Google AI (Gemini) API Key>
        GEMINI_MODEL=gemini-2.0-flash # Or another compatible model name

        # Firebase Configuration
        FIREBASE_DATABASE_URL=<Your Firebase Realtime Database URL>

        # Ngrok Configuration (Update after starting ngrok)
        NGROK_URL=<Your Ngrok HTTPS URL, e.g., https://xxxx-xxxx-xxxx.ngrok-free.app>

        # Server Port (Optional)
        PORT=3000
        ```

## Running the Application

1.  **Start Ngrok:**
    * Open a *separate terminal window*.
    * Run the following command to expose your local port (default 3000, or the `PORT` specified in `.env`):
        ```bash
        ngrok http 3000
        ```
    * Ngrok will display forwarding URLs. Copy the `https://` URL (it might look like `https://<random-string>.ngrok-free.app` or a static domain if you have a paid plan).

2.  **Update `.env` with Ngrok URL:**
    * Paste the copied `https://` Ngrok URL into the `NGROK_URL` variable in your `.env` file. Save the file.

3.  **Start the Node.js Server:**
    * In your *original* project terminal window, run:
        ```bash
        npm start
        ```
        (If you don't have a `start` script in `package.json`, use `node src/server.js`)
    * Look for console output confirming the server is running:
        ```
        --- Medication Reminder Server ---
        HTTP Server listening at http://localhost:3000
        WebSocket Server listening on ws://localhost:3000/live
        Current time: ...
        Attempting to update Twilio incoming call webhook URLs...
        Successfully updated incoming call webhook URLs... (or an error message)
        ----------------------------------
        ```
    * **Note:** The server automatically attempts to update your Twilio number's voice webhook URL using the `NGROK_URL`. If this fails, you may need to manually configure the Voice URL for your `TWILIO_PHONE_NUMBER_TOLL_FREE` number in the Twilio console to point to `<Your Ngrok URL>/incoming-call`.

## Usage

### Triggering an Outbound Call

-   **Endpoint:** `POST /call`
-   **Request Body:** JSON containing the `phoneNumber` in E.164 format (e.g., `+12345678900`).
-   **Example using `curl`:** (Replace `<NGROK_URL>` and the phone number)
    ```bash
    curl -X POST -H "Content-Type: application/json" \
         -d '{"phoneNumber": "+12345678900"}' \
         <NGROK_URL>/call
    ```
-   The system will initiate a call to the specified number, play the reminder prompt, and engage in conversation using STT/LLM/TTS.

### Receiving an Inbound Call

-   Call the Twilio phone number configured as `TWILIO_PHONE_NUMBER_TOLL_FREE` from any phone.
-   The system should answer, play the reminder prompt, and wait for your speech input.

### Reviewing Logs

-   **Console Logs:** Check the terminal where the Node.js server (`npm start`) is running. You will see formatted `--- Call Interaction Summary ---` logs detailing call progress, status updates, STT transcripts, etc.
-   **Firebase Logs:**
    * Go to your Firebase project console and navigate to the **Realtime Database**.
    * **Event Logs:** Look under the `/logs` node, then under the specific `CallSid` (e.g., `/logs/CAxxxxxxxx...`). You will find timestamped entries detailing events, webhook payloads, transcripts, TTS URLs, LLM responses, etc.
    * **Error Logs:** Look under the `/errors` node, then under the specific `CallSid` (or identifiers like `global_error_handler`, `websocket_server`). You will find structured error objects including name, message, and stack trace.
    * **Recording URL:** Within the event logs for a specific `CallSid` under `/logs`, look for the `recording_handled` event, which includes the `recordingUrl`.

### Listing Call Logs (API)

-   **Endpoint:** `GET /call-logs`
-   **Query Parameters:**
    -   `callSid=<Twilio_CallSid>`: Filter by a specific CallSid.
    -   `startDate=<DateString>&endDate=<DateString>`: Filter by date range. Accepts ISO 8601 (`YYYY-MM-DDTHH:mm:ssZ`) or `YYYY-MM-DD HH:mm:ss` format.
    -   `page=<PageNumber>`: Page number for pagination (default: 1).
    -   `pageSize=<Size>`: Number of logs per page (default: 100).
-   **Examples using `curl`:** (Replace `<NGROK_URL>`)
    * Get first 10 logs:
        ```bash
        curl "<NGROK_URL>/call-logs?pageSize=10"
        ```
    * Get logs for a specific call:
        ```bash
        curl "<NGROK_URL>/call-logs?callSid=CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
        ```
    * Get logs for a specific date range (ISO format):
        ```bash
        curl "<NGROK_URL>/call-logs?startDate=2025-04-01T00:00:00Z&endDate=2025-04-01T23:59:59Z"
        ```
    * Get logs for a specific date range (Other format, URL encoded):
        ```bash
        curl "<NGROK_URL>/call-logs?startDate=2025-04-01%2009:00:00&endDate=2025-04-01%2017:00:00"
        ```

## Project Structure (Overview)

```
medication-reminder-system/
├── tests/                   # Jest test files
│   ├── answered.test.js
│   ├── call-status.test.js
│   ├── call.test.js
│   ├── callLogs.test.js
│   ├── elevenLabsService.test.js
│   ├── twilio.config.test.js
│   ├── firebase.utils.test.js
│   ├── handle-recording.test.js
│   ├── handle-speech.test.js
│   ├── incomingCalls.test.js
│   └── websocketHandler.test.js
├── src/
│   ├── config/             # Configuration files (Firebase, Twilio)
│   ├── errors/             # Custom error classes
│   ├── private/            # Private keys (Firebase key) - In .gitignore!
│   │   └── ...adminsdk...json
│   ├── public/             # Static files (TTS audio, beep.mpeg)
│   ├── routes/             # Express route handlers
│   ├── services/           # External API service integrations
│   ├── storage/            # Simple data storage classes
│   ├── utils/              # Utility functions
│   ├── server.js           # Main application entry point
│   └── websocketHandler.js # WebSocket/STT handling
├── .env                    # Environment variables - In .gitignore!
├── .gitignore              # Specifies intentionally untracked files
├── package.json            # Project metadata and dependencies
├── package-lock.json       # Exact dependency versions
└── README.md               # This file
```

## Testing

This project uses [Jest](https://jestjs.io/) for unit and integration testing. Tests are located in the `__tests__` directory.

-   **Mocking:** External services (Twilio, Firebase Admin SDK, ElevenLabs, Deepgram) and internal utilities/modules are mocked using `jest.mock()` to allow for isolated testing of routes, services, and utility functions.
-   **Test Coverage:** The tests cover various scenarios for:
    -   API endpoints (`/call`, `/call-logs`).
    -   Twilio webhook handlers (`/answered`, `/call-status`, `/handle-speech`, `/handle-recording`, `/incoming-call`).
    -   Service functions (`elevenLabsTextToSpeech`).
    -   Utility functions (`logToFirebase`, `logErrorToFirebase`, Twilio config update).
    -   WebSocket handler logic (`websocketHandler.js`).
    -   They verify correct responses (TwiML, JSON), API interactions (checking mock calls), logging behavior, and error handling.
-   **Running Tests:**
    ```bash
    npm test
    ```
    (This assumes a `test` script exists in your `package.json`, e.g., `"test": "jest"`)

## Error Handling

-   The application uses custom error classes extending a `BaseError` (located in `src/errors/`).
-   Operational errors (e.g., invalid input, API failures) are typically handled gracefully, logged, and result in appropriate HTTP status codes (4xx or 5xx) or TwiML responses.
-   Unexpected programming errors are caught by a global error handler in `src/server.js`, logged to Firebase under `/errors`, and result in a generic 500 Internal Server Error response to the client.
-   WebSocket and Deepgram connection errors are handled within `src/websocketHandler.js` and logged to Firebase.

---
