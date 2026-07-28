const BOT_AUTOMATION_ENV = "BOT_AUTOMATION_ENABLED";

export function isBotAutomationEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[BOT_AUTOMATION_ENV]?.trim().toLowerCase() === "true";
}

export function assertBotAutomationEnabled(action = "Bot start"): void {
  if (isBotAutomationEnabled()) return;

  throw new Error(
    `${action} blocked: bot automation is disabled by ${BOT_AUTOMATION_ENV}. ` +
      `Set ${BOT_AUTOMATION_ENV}=true only after an explicit activation approval.`,
  );
}
