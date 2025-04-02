export const consoleLogCall = ({callSid, status}, args) => {
    console.log(`--- Call Interaction Summary ---`);
    console.log(`Call SID: ${callSid}`);
    console.log(`Call Status: "${status}"`);
    if (args) console.log(args);
    console.log(`--------------------------------`);
};
