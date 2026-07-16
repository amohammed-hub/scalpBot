import { describe, it, expect } from "vitest";

describe("Admin OTP Bypass", () => {
  it("ADMIN_MOBILE env var is set and looks like a phone number", () => {
    const adminMobile = process.env.ADMIN_MOBILE ?? "";
    expect(adminMobile.length).toBeGreaterThan(5);
    expect(adminMobile).toMatch(/^\+?\d{10,15}$/);
  });

  it("Admin mobile matches expected format +91XXXXXXXXXX", () => {
    const adminMobile = process.env.ADMIN_MOBILE ?? "";
    expect(adminMobile.startsWith("+91")).toBe(true);
    expect(adminMobile.length).toBe(13); // +91 + 10 digits
  });
});
