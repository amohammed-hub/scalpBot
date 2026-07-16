import { describe, it, expect } from "vitest";

describe("Twilio Credentials Validation", () => {
  it("should connect to Twilio API with provided credentials", async () => {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const phoneNumber = process.env.TWILIO_PHONE_NUMBER;

    // Check env vars exist
    expect(accountSid).toBeDefined();
    expect(authToken).toBeDefined();
    expect(phoneNumber).toBeDefined();
    expect(accountSid!.startsWith("AC")).toBe(true);

    // Validate by fetching account info from Twilio API
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        },
      }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.sid).toBe(accountSid);
    expect(data.status).toBe("active");
  });
});
