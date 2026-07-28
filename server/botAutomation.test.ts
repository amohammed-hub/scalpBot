import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  assertBotAutomationEnabled,
  isBotAutomationEnabled,
} from "./botAutomation";

const originalBotAutomationEnabled = process.env.BOT_AUTOMATION_ENABLED;

afterEach(() => {
  if (originalBotAutomationEnabled === undefined) {
    delete process.env.BOT_AUTOMATION_ENABLED;
  } else {
    process.env.BOT_AUTOMATION_ENABLED = originalBotAutomationEnabled;
  }
});

describe("bot automation deployment gate", () => {
  it("fails closed unless BOT_AUTOMATION_ENABLED is explicitly true", () => {
    expect(isBotAutomationEnabled({})).toBe(false);
    expect(isBotAutomationEnabled({ BOT_AUTOMATION_ENABLED: "" })).toBe(false);
    expect(isBotAutomationEnabled({ BOT_AUTOMATION_ENABLED: "false" })).toBe(false);
    expect(isBotAutomationEnabled({ BOT_AUTOMATION_ENABLED: "1" })).toBe(false);
    expect(isBotAutomationEnabled({ BOT_AUTOMATION_ENABLED: "true" })).toBe(true);
    expect(isBotAutomationEnabled({ BOT_AUTOMATION_ENABLED: "  TRUE  " })).toBe(true);
  });

  it("throws an activation-specific error when disabled", () => {
    delete process.env.BOT_AUTOMATION_ENABLED;

    expect(() => assertBotAutomationEnabled("Primary bot start")).toThrow(
      /Primary bot start blocked: bot automation is disabled by BOT_AUTOMATION_ENABLED/,
    );
  });

  it("permits starts only after explicit opt-in", () => {
    process.env.BOT_AUTOMATION_ENABLED = "true";

    expect(() => assertBotAutomationEnabled("Primary bot start")).not.toThrow();
  });

  it("protects every production bot-start and background-restart boundary", () => {
    const readSource = (name: string) =>
      readFileSync(new URL(name, import.meta.url), "utf8");

    const engine = readSource("./botEngine.ts");
    const restart = readSource("./botRestart.ts");
    const watchdog = readSource("./botWatchdog.ts");
    const routers = readSource("./routers.ts");

    expect(engine).toContain('assertBotAutomationEnabled("Bot engine start")');
    expect(restart.match(/if \(!isBotAutomationEnabled\(\)\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(watchdog.match(/if \(!isBotAutomationEnabled\(\)\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(routers).toContain('assertBotAutomationEnabled("Primary bot start")');
    expect(routers).toContain('assertBotAutomationEnabled("Bot restart")');
    expect(routers).toContain('assertBotAutomationEnabled("Secondary bot start")');
  });
});
