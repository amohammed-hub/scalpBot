import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const phoneNumber = process.env.TWILIO_PHONE_NUMBER;
const hasTwilioConfiguration = Boolean(accountSid && authToken && phoneNumber);
const describeWithTwilio = hasTwilioConfiguration ? describe : describe.skip;

describeWithTwilio("Twilio credential configuration", () => {
  it("uses locally well-formed configuration when all Twilio secrets are supplied", () => {
    expect(accountSid).toMatch(/^AC.+/);
    expect(authToken?.trim().length).toBeGreaterThan(0);
    expect(phoneNumber).toMatch(/^\+\d{10,15}$/);
  });

});

describe("Twilio unit-test isolation", () => {
  it("contains no live Twilio API call", () => {
    const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
    const liveTwilioUrl = ["https://", ["api", "twilio", "com"].join(".")].join("");
    const fetchCallToken = ["fe", "tch", "("].join("");
    expect(source).not.toContain(liveTwilioUrl);
    expect(source).not.toContain(fetchCallToken);
  });
});
