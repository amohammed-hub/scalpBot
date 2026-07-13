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
      // Check enabledLayers column
      try {
        await pool.execute("SELECT `enabledLayers` FROM `bot_sessions` LIMIT 1");
      } catch (e: any) {
        if (e?.code === "ER_BAD_FIELD_ERROR" || e?.message?.includes("Unknown column")) {
          console.log("[Database] Auto-migrating: adding enabledLayers column to bot_sessions");
          await pool.execute("ALTER TABLE `bot_sessions` ADD COLUMN `enabledLayers` text");
          console.log("[Database] Migration complete: enabledLayers column added");
        }
      }
      // Check signal_journal table exists
      try {
        await pool.execute("SELECT 1 FROM `signal_journal` LIMIT 1");
      } catch (e: any) {
        if (e?.code === "ER_NO_SUCH_TABLE" || e?.message?.includes("doesn't exist")) {
          console.log("[Database] Auto-migrating: creating signal_journal table");
          await pool.execute(`CREATE TABLE IF NOT EXISTS signal_journal (
            id int AUTO_INCREMENT NOT NULL,
            sessionToken varchar(128) NOT NULL,
            symbol varchar(32) NOT NULL,
            instrumentToken varchar(128),
            direction enum('BUY','SELL') NOT NULL,
            layer varchar(64) NOT NULL,
            confidence float NOT NULL,
            entryPrice float NOT NULL,
            suggestedSl float,
            suggestedTarget float,
            atr float,
            regime varchar(32),
            vixLevel float,
            oiBias varchar(16),
            outcome enum('traded','rejected','pending') NOT NULL DEFAULT 'pending',
            rejectReason varchar(128),
            tradeId int,
            exitPrice float,
            pnl float,
            exitReason varchar(64),
            holdDurationMs bigint,
            maxFavorableExcursion float,
            maxAdverseExcursion float,
            signalAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            outcomeAt timestamp NULL,
            createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(id)
          )`);
          console.log("[Database] Migration complete: signal_journal table created");
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
