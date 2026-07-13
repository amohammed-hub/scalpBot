import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { InsertUser, users } from "../drizzle/schema";
import { ENV } from './_core/env';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any = null;
let _initAttempted = false;
let _migrationRan = false;
async function initDb() {
  const url = process.env.DATABASE_URL;
  console.log("[Database] DATABASE_URL present:", !!url, "length:", url?.length ?? 0);
  
  if (!url) {
    console.error("[Database] DATABASE_URL is not set or empty");
    return null;
  }

  try {
    const pool = mysql.createPool({
      uri: url,
      waitForConnections: true,
      connectionLimit: 10,
      ssl: { rejectUnauthorized: false },
    });
    
    // Test the connection immediately
    const conn = await pool.getConnection();
    conn.release();
    
    const db = drizzle(pool);
    console.log("[Database] Connected successfully");
    // Self-healing migrations: ensure columns exist that may be missing on Railway
    if (!_migrationRan) {
      _migrationRan = true;
      try {
        await pool.execute("SELECT `enabledLayers` FROM `bot_sessions` LIMIT 1");
      } catch (e: any) {
        if (e?.code === "ER_BAD_FIELD_ERROR" || e?.message?.includes("Unknown column")) {
          console.log("[Database] Auto-migrating: adding enabledLayers column to bot_sessions");
          await pool.execute("ALTER TABLE `bot_sessions` ADD COLUMN `enabledLayers` text");
          console.log("[Database] Migration complete: enabledLayers column added");
        }
      }
    }
    return db;
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    console.error("[Database] Failed to connect:", err.message, "code:", err.code);
    return null;
  }
}

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && !_initAttempted) {
    _initAttempted = true;
    _db = await initDb();
  }
  // If init failed, retry on next call (in case env var was set later)
  if (!_db) {
    _db = await initDb();
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}
