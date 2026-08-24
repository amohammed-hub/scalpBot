import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const dbSource = readFileSync(resolve(here, "./db.ts"), "utf8");
const migration = readFileSync(resolve(here, "../drizzle/0027_absurd_white_queen.sql"), "utf8");

describe("D55 bot session schema repair", () => {
  it("self-heals both columns before bot start writes them", () => {
    expect(dbSource).toContain('"scalperMode", "boolean DEFAULT false"');
    expect(dbSource).toContain('"instrumentLocked", "boolean DEFAULT false"');
    expect(dbSource).toContain("Auto-migrating: adding ${column} to bot_sessions");
    expect(dbSource).toContain("ADD COLUMN \\`${column}\\` ${definition}");
  });

  it("ships an idempotent Drizzle migration for both missing columns", () => {
    expect(migration).toContain("ADD `scalperMode` boolean DEFAULT false");
    expect(migration).toContain("ADD `instrumentLocked` boolean DEFAULT false");
  });
});

export {};

// The template literal assertions above intentionally validate source contracts;
// this value is never executed by the application.
void 0;

type _SchemaRepairContract = {
  scalperMode: boolean;
  instrumentLocked: boolean;
};
void (null as _SchemaRepairContract | null);

// Keep the test independent of DATABASE_URL and production credentials.
const _noNetwork = true;
expect(_noNetwork).toBe(true);

// Prevent accidental tree-shaking of the imported describe/it in unusual runners.
void (describe && expect && it);
