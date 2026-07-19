import { eq, and, desc, gt, count, sql } from "drizzle-orm";
import { lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { InsertUser, users, subscriptions, appUsers, otpCodes, upstoxCredentials, botSessions, tradeLog, signalJournal, accessGrants } from "../drizzle/schema";
import { ENV } from './_core/env';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any = null;
let _pool: any = null;
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
      enableKeepAlive: true,
      keepAliveInitialDelay: 30000,
      ssl: { rejectUnauthorized: false },
    });
    
    _pool = pool;
    // Handle pool-level connection errors gracefully
    (pool as any).on('error', (err: any) => {
      console.error("[Database] Pool error (will auto-reconnect):", err.code ?? err.message);
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
      // Check partialBooked column on trade_log (added in Round 25)
      try {
        await pool.execute("SELECT `partialBooked` FROM `trade_log` LIMIT 1");
      } catch (e: any) {
        if (e?.code === "ER_BAD_FIELD_ERROR" || e?.message?.includes("Unknown column")) {
          console.log("[Database] Auto-migrating: adding partialBooked/bookedQty/bookedPnl to trade_log");
          await pool.execute("ALTER TABLE `trade_log` ADD COLUMN `partialBooked` int DEFAULT 0");
          await pool.execute("ALTER TABLE `trade_log` ADD COLUMN `bookedQty` int DEFAULT 0");
          await pool.execute("ALTER TABLE `trade_log` ADD COLUMN `bookedPnl` float DEFAULT 0");
          console.log("[Database] Migration complete: partialBooked/bookedQty/bookedPnl columns added");
        }
      }
      // Check partial1Pct column on bot_sessions (added in Round 25)
      try {
        await pool.execute("SELECT `partial1Pct` FROM `bot_sessions` LIMIT 1");
      } catch (e: any) {
        if (e?.code === "ER_BAD_FIELD_ERROR" || e?.message?.includes("Unknown column")) {
          console.log("[Database] Auto-migrating: adding partial1Pct/partial2Pct to bot_sessions");
          await pool.execute("ALTER TABLE `bot_sessions` ADD COLUMN `partial1Pct` float DEFAULT 30");
          await pool.execute("ALTER TABLE `bot_sessions` ADD COLUMN `partial2Pct` float DEFAULT 60");
          console.log("[Database] Migration complete: partial1Pct/partial2Pct columns added");
        }
      }
      // Check carryForward column on trade_log (added in Round 27)
      try {
        await pool.execute("SELECT `carryForward` FROM `trade_log` LIMIT 1");
      } catch (e: any) {
        if (e?.code === "ER_BAD_FIELD_ERROR" || e?.message?.includes("Unknown column")) {
          console.log("[Database] Auto-migrating: adding carryForward to trade_log");
          await pool.execute("ALTER TABLE `trade_log` ADD COLUMN `carryForward` boolean DEFAULT false");
          console.log("[Database] Migration complete: carryForward column added");
        }
      }
      // Widen exitReason column from varchar(64) to varchar(255) (BUG 5 fix — messages were being truncated)
      try {
        const [cols] = await pool.execute(
          "SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS WHERE TABLE_NAME='trade_log' AND COLUMN_NAME='exitReason' AND TABLE_SCHEMA=DATABASE()"
        ) as any;
        if (cols?.[0]?.CHARACTER_MAXIMUM_LENGTH && Number(cols[0].CHARACTER_MAXIMUM_LENGTH) < 255) {
          console.log("[Database] Auto-migrating: widening exitReason to varchar(255)");
          await pool.execute("ALTER TABLE `trade_log` MODIFY COLUMN `exitReason` varchar(255)");
          console.log("[Database] Migration complete: exitReason widened");
        }
      } catch { /* non-fatal */ }
      // Check entryUnderlyingPrice column on trade_log (added in Round 32 — for options delta P&L)
      try {
        await pool.execute("SELECT `entryUnderlyingPrice` FROM `trade_log` LIMIT 1");
      } catch (e: any) {
        if (e?.code === "ER_BAD_FIELD_ERROR" || e?.message?.includes("Unknown column")) {
          console.log("[Database] Auto-migrating: adding entryUnderlyingPrice to trade_log");
          await pool.execute("ALTER TABLE `trade_log` ADD COLUMN `entryUnderlyingPrice` float DEFAULT NULL");
          console.log("[Database] Migration complete: entryUnderlyingPrice column added");
        }
      }
      // Also widen exitReason in signal_journal if it exists
      try {
        const [cols2] = await pool.execute(
          "SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS WHERE TABLE_NAME='signal_journal' AND COLUMN_NAME='exitReason' AND TABLE_SCHEMA=DATABASE()"
        ) as any;
        if (cols2?.[0]?.CHARACTER_MAXIMUM_LENGTH && Number(cols2[0].CHARACTER_MAXIMUM_LENGTH) < 255) {
          console.log("[Database] Auto-migrating: widening signal_journal.exitReason to varchar(255)");
          await pool.execute("ALTER TABLE `signal_journal` MODIFY COLUMN `exitReason` varchar(255)");
          console.log("[Database] Migration complete: signal_journal.exitReason widened");
        }
      } catch { /* non-fatal */ }
      // Check eodSummaryCronTaskUid column on bot_sessions (migration 0010)
      try {
        await pool.execute("SELECT `eodSummaryCronTaskUid` FROM `bot_sessions` LIMIT 1");
      } catch (e: any) {
        if (e?.code === "ER_BAD_FIELD_ERROR" || e?.message?.includes("Unknown column")) {
          console.log("[Database] Auto-migrating: adding eodSummaryCronTaskUid to bot_sessions");
          await pool.execute("ALTER TABLE `bot_sessions` ADD COLUMN `eodSummaryCronTaskUid` varchar(128)");
          console.log("[Database] Migration complete: eodSummaryCronTaskUid column added");
        }
      }
      // Check averagingEnabled column on bot_sessions (migration 0019)
      try {
        await pool.execute("SELECT `averagingEnabled` FROM `bot_sessions` LIMIT 1");
      } catch (e: any) {
        if (e?.code === "ER_BAD_FIELD_ERROR" || e?.message?.includes("Unknown column")) {
          console.log("[Database] Auto-migrating: adding averagingEnabled to bot_sessions");
          await pool.execute("ALTER TABLE `bot_sessions` ADD COLUMN `averagingEnabled` boolean DEFAULT true");
          console.log("[Database] Migration complete: averagingEnabled column added");
        }
      }
      // Check averagingLossThreshold column on bot_sessions (migration 0019)
      try {
        await pool.execute("SELECT `averagingLossThreshold` FROM `bot_sessions` LIMIT 1");
      } catch (e: any) {
        if (e?.code === "ER_BAD_FIELD_ERROR" || e?.message?.includes("Unknown column")) {
          console.log("[Database] Auto-migrating: adding averagingLossThreshold to bot_sessions");
          await pool.execute("ALTER TABLE `bot_sessions` ADD COLUMN `averagingLossThreshold` float DEFAULT 0.2");
          console.log("[Database] Migration complete: averagingLossThreshold column added");
        }
      }
      // Check subscriptions table (migration 0017)
      try {
        await pool.execute("SELECT 1 FROM `subscriptions` LIMIT 1");
      } catch (e: any) {
        if (e?.code === "ER_NO_SUCH_TABLE" || e?.message?.includes("doesn't exist")) {
          console.log("[Database] Auto-migrating: creating subscriptions table");
          await pool.execute(`CREATE TABLE IF NOT EXISTS subscriptions (
            id int AUTO_INCREMENT NOT NULL,
            sessionToken varchar(128) NOT NULL,
            plan enum('trial','monthly','quarterly','half_yearly','yearly') NOT NULL,
            status enum('active','expired','cancelled') NOT NULL DEFAULT 'active',
            razorpayOrderId varchar(128),
            razorpayPaymentId varchar(128),
            razorpaySubscriptionId varchar(128),
            amountPaid int DEFAULT 0,
            startsAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expiresAt timestamp NOT NULL,
            createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(id)
          )`);
          console.log("[Database] Migration complete: subscriptions table created");
        }
      }
      // Check app_users table (migration 0018)
      try {
        await pool.execute("SELECT 1 FROM `app_users` LIMIT 1");
      } catch (e: any) {
        if (e?.code === "ER_NO_SUCH_TABLE" || e?.message?.includes("doesn't exist")) {
          console.log("[Database] Auto-migrating: creating app_users table");
          await pool.execute(`CREATE TABLE IF NOT EXISTS app_users (
            id int AUTO_INCREMENT NOT NULL,
            mobile varchar(15) NOT NULL,
            name varchar(128),
            role enum('user','admin') NOT NULL DEFAULT 'user',
            isVerified boolean NOT NULL DEFAULT false,
            sessionToken varchar(128),
            lastLoginAt timestamp NULL,
            createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY(id),
            UNIQUE KEY app_users_mobile_unique (mobile)
          )`);
          console.log("[Database] Migration complete: app_users table created");
        }
      }
      // Check otp_codes table (migration 0018)
      try {
        await pool.execute("SELECT 1 FROM `otp_codes` LIMIT 1");
      } catch (e: any) {
        if (e?.code === "ER_NO_SUCH_TABLE" || e?.message?.includes("doesn't exist")) {
          console.log("[Database] Auto-migrating: creating otp_codes table");
          await pool.execute(`CREATE TABLE IF NOT EXISTS otp_codes (
            id int AUTO_INCREMENT NOT NULL,
            mobile varchar(15) NOT NULL,
            code varchar(6) NOT NULL,
            expiresAt timestamp NOT NULL,
            verified boolean NOT NULL DEFAULT false,
            createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(id)
          )`);
          console.log("[Database] Migration complete: otp_codes table created");
        }
      }
      // Check useV2Engine column on bot_sessions (migration 0021)
      try {
        await pool.execute("SELECT `useV2Engine` FROM `bot_sessions` LIMIT 1");
      } catch (e: any) {
        if (e?.code === "ER_BAD_FIELD_ERROR" || e?.message?.includes("Unknown column")) {
          console.log("[Database] Auto-migrating: adding useV2Engine to bot_sessions");
          await pool.execute("ALTER TABLE `bot_sessions` ADD COLUMN `useV2Engine` boolean DEFAULT false");
          console.log("[Database] Migration complete: useV2Engine column added");
        }
      }
      // Check nseSummaryCronTaskUid column on bot_sessions (migration 0022)
      try {
        await pool.execute("SELECT `nseSummaryCronTaskUid` FROM `bot_sessions` LIMIT 1");
      } catch (e: any) {
        if (e?.code === "ER_BAD_FIELD_ERROR" || e?.message?.includes("Unknown column")) {
          console.log("[Database] Auto-migrating: adding nseSummaryCronTaskUid to bot_sessions");
          await pool.execute("ALTER TABLE `bot_sessions` ADD COLUMN `nseSummaryCronTaskUid` varchar(128)");
          console.log("[Database] Migration complete: nseSummaryCronTaskUid column added");
        }
      }
      // Check access_grants table (migration 0020)
      try {
        await pool.execute("SELECT 1 FROM `access_grants` LIMIT 1");
      } catch (e: any) {
        if (e?.code === "ER_NO_SUCH_TABLE" || e?.message?.includes("doesn't exist")) {
          console.log("[Database] Auto-migrating: creating access_grants table");
          await pool.execute(`CREATE TABLE IF NOT EXISTS access_grants (
            id int AUTO_INCREMENT NOT NULL,
            userMobile varchar(15),
            userEmail varchar(320),
            userName varchar(128),
            plan enum('monthly','quarterly','half_yearly','yearly','custom') NOT NULL,
            durationDays int NOT NULL,
            startsAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expiresAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            status enum('active','expired','revoked') NOT NULL DEFAULT 'active',
            note text,
            grantedBy varchar(128) NOT NULL,
            revokedAt timestamp NULL,
            createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY(id)
          )`);
          console.log("[Database] Migration complete: access_grants table created");
        }
      }
      // Check admin_settings table (migration 0023)
      try {
        await pool.execute("SELECT 1 FROM `admin_settings` LIMIT 1");
      } catch (e: any) {
        if (e?.code === "ER_NO_SUCH_TABLE" || e?.message?.includes("doesn't exist")) {
          console.log("[Database] Auto-migrating: creating admin_settings table");
          await pool.execute(`CREATE TABLE IF NOT EXISTS admin_settings (
            id int AUTO_INCREMENT NOT NULL,
            settingKey varchar(128) NOT NULL,
            settingValue text NOT NULL,
            updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY(id),
            UNIQUE KEY admin_settings_settingKey_unique (settingKey)
          )`);
          console.log("[Database] Migration complete: admin_settings table created");
        }
      }
      // Check alert_templates table (migration 0023)
      try {
        await pool.execute("SELECT 1 FROM `alert_templates` LIMIT 1");
      } catch (e: any) {
        if (e?.code === "ER_NO_SUCH_TABLE" || e?.message?.includes("doesn't exist")) {
          console.log("[Database] Auto-migrating: creating alert_templates table");
          await pool.execute(`CREATE TABLE IF NOT EXISTS alert_templates (
            id int AUTO_INCREMENT NOT NULL,
            templateType enum('entry','exit','daily_summary','critical') NOT NULL,
            template text NOT NULL,
            isActive tinyint NOT NULL DEFAULT 1,
            updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY(id),
            UNIQUE KEY alert_templates_templateType_unique (templateType)
          )`);
          console.log("[Database] Migration complete: alert_templates table created");
        }
      }
      // Check broadcast_messages table (migration 0023)
      try {
        await pool.execute("SELECT 1 FROM `broadcast_messages` LIMIT 1");
      } catch (e: any) {
        if (e?.code === "ER_NO_SUCH_TABLE" || e?.message?.includes("doesn't exist")) {
          console.log("[Database] Auto-migrating: creating broadcast_messages table");
          await pool.execute(`CREATE TABLE IF NOT EXISTS broadcast_messages (
            id int AUTO_INCREMENT NOT NULL,
            message text NOT NULL,
            audience enum('all','paid','free','specific') NOT NULL DEFAULT 'all',
            specificTarget varchar(255),
            status enum('draft','sent','scheduled','failed') NOT NULL DEFAULT 'draft',
            scheduledAt timestamp NULL,
            sentAt timestamp NULL,
            sentCount int DEFAULT 0,
            failedCount int DEFAULT 0,
            createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(id)
          )`);
          console.log("[Database] Migration complete: broadcast_messages table created");
        }
      }
      // Check notification_preferences table (migration 0023)
      try {
        await pool.execute("SELECT 1 FROM `notification_preferences` LIMIT 1");
      } catch (e: any) {
        if (e?.code === "ER_NO_SUCH_TABLE" || e?.message?.includes("doesn't exist")) {
          console.log("[Database] Auto-migrating: creating notification_preferences table");
          await pool.execute(`CREATE TABLE IF NOT EXISTS notification_preferences (
            id int AUTO_INCREMENT NOT NULL,
            sessionToken varchar(255) NOT NULL,
            tradeEntry tinyint NOT NULL DEFAULT 1,
            tradeExit tinyint NOT NULL DEFAULT 1,
            dailySummary tinyint NOT NULL DEFAULT 1,
            criticalAlerts tinyint NOT NULL DEFAULT 1,
            announcements tinyint NOT NULL DEFAULT 1,
            adminOverride tinyint NOT NULL DEFAULT 0,
            createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY(id),
            UNIQUE KEY notification_preferences_sessionToken_unique (sessionToken)
          )`);
         console.log("[Database] Migration complete: notification_preferences table created");
       }
     }

      // ── Performance indexes (BUG 4 fix) ──────────────────────────────
      try {
        const [rows] = await pool.execute("SHOW INDEX FROM `trade_log` WHERE Key_name = 'idx_trade_log_sessionToken'") as any;
        if (!rows || rows.length === 0) {
          console.log("[Database] Auto-migrating: adding index idx_trade_log_sessionToken");
          await pool.execute("CREATE INDEX `idx_trade_log_sessionToken` ON `trade_log` (`sessionToken`)");
          console.log("[Database] Migration complete: idx_trade_log_sessionToken added");
        }
      } catch (e: any) { console.warn("[Database] Index check trade_log.sessionToken failed:", e.message); }

      try {
        const [rows] = await pool.execute("SHOW INDEX FROM `bot_sessions` WHERE Key_name = 'idx_bot_sessions_sessionToken'") as any;
        if (!rows || rows.length === 0) {
          console.log("[Database] Auto-migrating: adding index idx_bot_sessions_sessionToken");
          await pool.execute("CREATE INDEX `idx_bot_sessions_sessionToken` ON `bot_sessions` (`sessionToken`)");
          console.log("[Database] Migration complete: idx_bot_sessions_sessionToken added");
        }
      } catch (e: any) { console.warn("[Database] Index check bot_sessions.sessionToken failed:", e.message); }

      try {
        const [rows] = await pool.execute("SHOW INDEX FROM `trade_log` WHERE Key_name = 'idx_trade_log_status'") as any;
        if (!rows || rows.length === 0) {
          console.log("[Database] Auto-migrating: adding index idx_trade_log_status");
          await pool.execute("CREATE INDEX `idx_trade_log_status` ON `trade_log` (`status`)");
          console.log("[Database] Migration complete: idx_trade_log_status added");
        }
      } catch (e: any) { console.warn("[Database] Index check trade_log.status failed:", e.message); }
      // Check referralCode column on app_users (referral system)
      try {
        await pool.execute("SELECT `referralCode` FROM `app_users` LIMIT 1");
      } catch (e: any) {
        if (e?.code === "ER_BAD_FIELD_ERROR" || e?.message?.includes("Unknown column")) {
          console.log("[Database] Auto-migrating: adding referral columns to app_users");
          await pool.execute("ALTER TABLE `app_users` ADD COLUMN `referralCode` varchar(12)");
          await pool.execute("ALTER TABLE `app_users` ADD COLUMN `referredBy` varchar(12)");
          await pool.execute("ALTER TABLE `app_users` ADD COLUMN `extraBotSlots` int DEFAULT 0");
          console.log("[Database] Migration complete: referral columns added to app_users");
        }
      }
      // Check referrals table
      try {
        await pool.execute("SELECT 1 FROM `referrals` LIMIT 1");
      } catch (e: any) {
        if (e?.code === "ER_NO_SUCH_TABLE" || e?.message?.includes("doesn't exist")) {
          console.log("[Database] Auto-migrating: creating referrals table");
          await pool.execute(`CREATE TABLE IF NOT EXISTS referrals (
            id int AUTO_INCREMENT NOT NULL,
            referrerMobile varchar(15) NOT NULL,
            refereeMobile varchar(15) NOT NULL,
            referralCode varchar(12) NOT NULL,
            rewardGranted boolean NOT NULL DEFAULT false,
            createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(id)
          )`);
          console.log("[Database] Migration complete: referrals table created");
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

/** Reset DB connection — call when a "Connection lost" error is detected */
export function resetDbConnection() {
  console.log("[Database] Resetting connection pool due to connection loss");
  _db = null;
  _initAttempted = false;
  if (_pool) {
    try { _pool.end(); } catch { /* ignore */ }
    _pool = null;
  }
}

// ── Subscription Helpers ─────────────────────────────────────────────────────

/** Check if a session has active access (trial or paid) */
export async function checkAccess(sessionToken: string): Promise<{
  hasAccess: boolean;
  plan: string | null;
  expiresAt: Date | null;
  daysLeft: number;
}> {
  const db = await getDb();
  if (!db) return { hasAccess: false, plan: null, expiresAt: null, daysLeft: 0 };

  const now = new Date();
  const rows = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.sessionToken, sessionToken),
        eq(subscriptions.status, "active")
      )
    )
    .orderBy(desc(subscriptions.expiresAt))
    .limit(1);

  if (rows.length === 0) {
    return { hasAccess: false, plan: null, expiresAt: null, daysLeft: 0 };
  }

  const sub = rows[0];
  if (sub.expiresAt < now) {
    // Mark as expired
    await db
      .update(subscriptions)
      .set({ status: "expired" })
      .where(eq(subscriptions.id, sub.id));
    return { hasAccess: false, plan: null, expiresAt: null, daysLeft: 0 };
  }

  const daysLeft = Math.ceil((sub.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return { hasAccess: true, plan: sub.plan, expiresAt: sub.expiresAt, daysLeft };
}

/** Check if session has ever had a trial */
export async function hasUsedTrial(sessionToken: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const rows = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.sessionToken, sessionToken),
        eq(subscriptions.plan, "trial")
      )
    )
    .limit(1);
  return rows.length > 0;
}

/** Start a 2-day free trial for a session */
export async function startTrial(sessionToken: string): Promise<{ success: boolean; expiresAt: Date | null; error?: string }> {
  const used = await hasUsedTrial(sessionToken);
  if (used) {
    return { success: false, expiresAt: null, error: "Trial already used" };
  }

  const db = await getDb();
  if (!db) return { success: false, expiresAt: null, error: "Database unavailable" };

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000); // 2 days

  await db.insert(subscriptions).values({
    sessionToken,
    plan: "trial",
    status: "active",
    startsAt: now,
    expiresAt,
  });

  return { success: true, expiresAt };
}

/** Record a paid subscription after Razorpay payment verification */
export async function activateSubscription(params: {
  sessionToken: string;
  plan: "monthly" | "quarterly" | "half_yearly" | "yearly";
  razorpayOrderId: string;
  razorpayPaymentId: string;
  amountPaid: number;
}): Promise<{ success: boolean; expiresAt: Date }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const now = new Date();
  const durationDays: Record<string, number> = {
    monthly: 30,
    quarterly: 90,
    half_yearly: 180,
    yearly: 365,
  };
  const days = durationDays[params.plan] || 30;
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  await db.insert(subscriptions).values({
    sessionToken: params.sessionToken,
    plan: params.plan,
    status: "active",
    razorpayOrderId: params.razorpayOrderId,
    razorpayPaymentId: params.razorpayPaymentId,
    amountPaid: params.amountPaid,
    startsAt: now,
    expiresAt,
  });

  return { success: true, expiresAt };
}

// ══════════════════════════════════════════════════════════════════════════════
// OTP Auth Helpers
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a 6-digit OTP, store it in DB, and send via Twilio SMS.
 * OTP expires in 5 minutes. Rate-limited to 1 OTP per mobile per 60 seconds.
 */
// In-memory IP rate tracker (auto-clears per key after 1 hour)
const otpIpTracker = new Map<string, number>();

export async function sendOtp(mobile: string, clientIp?: string): Promise<{ success: boolean; message: string }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  // Admin bypass: if this is the admin's mobile, store a fixed OTP and skip Twilio
  const { adminMobile } = ENV;
  const isAdminBypass = adminMobile && (mobile === adminMobile || mobile === "+91" + adminMobile.replace(/^\+91/, ""));

  // Rate limit: check if OTP was sent in last 60 seconds
  const recentOtp = await db
    .select()
    .from(otpCodes)
    .where(and(
      eq(otpCodes.mobile, mobile),
      gt(otpCodes.createdAt, new Date(Date.now() - 60_000)),
    ))
    .limit(1);
  if (recentOtp.length > 0) {
    return { success: false, message: "OTP already sent. Please wait 60 seconds." };
  }

  // Rate limit: max 5 OTPs per mobile per hour
  const oneHourAgo = new Date(Date.now() - 3600_000);
  const hourlyCount = await db
    .select({ cnt: count() })
    .from(otpCodes)
    .where(and(
      eq(otpCodes.mobile, mobile),
      gt(otpCodes.createdAt, oneHourAgo),
    ));
  if ((hourlyCount[0]?.cnt ?? 0) >= 5) {
    return { success: false, message: "Too many OTP requests. Please try again after an hour." };
  }

  // Rate limit: max 10 OTPs per IP per hour (if IP available)
  if (clientIp) {
    const ipKey = `otp_ip_${clientIp}`;
    const ipCount = otpIpTracker.get(ipKey) ?? 0;
    if (ipCount >= 10) {
      return { success: false, message: "Too many OTP requests from this network. Please try again later." };
    }
    otpIpTracker.set(ipKey, ipCount + 1);
    // Auto-clear after 1 hour
    if (ipCount === 0) {
      setTimeout(() => otpIpTracker.delete(ipKey), 3600_000);
    }
  }

  // Generate 6-digit code (or use fixed 000000 for admin bypass)
  const code = isAdminBypass ? "000000" : String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  // Admin bypass: skip Twilio entirely
  if (isAdminBypass) {
    await db.insert(otpCodes).values({ mobile, code, expiresAt });
    console.log(`[OTP] Admin bypass for ${mobile} — code is 000000`);
    return { success: true, message: "OTP sent successfully (admin bypass)" };
  }

  // Send via Twilio
  const { twilioAccountSid, twilioAuthToken, twilioPhoneNumber } = ENV;
  if (!twilioAccountSid || !twilioAuthToken || !twilioPhoneNumber) {
    throw new Error("Twilio credentials not configured");
  }

  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;
  const body = new URLSearchParams({
    To: mobile,
    From: twilioPhoneNumber,
    Body: `Your ScalpBot OTP is: ${code}. Valid for 5 minutes. Do not share this code.`,
  });

  const resp = await fetch(twilioUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error("[OTP] Twilio send failed:", err);
    throw new Error("Failed to send OTP. Please try again.");
  }

  // Only store OTP in DB after successful SMS send
  await db.insert(otpCodes).values({ mobile, code, expiresAt });

  return { success: true, message: "OTP sent successfully" };
}

/**
 * Verify OTP code for a mobile number.
 * Returns the app_user record (creates one if first-time).
 */
export async function verifyOtp(mobile: string, code: string, clientSessionToken?: string): Promise<{ success: boolean; user?: typeof appUsers.$inferSelect; message?: string }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  // Find valid OTP
  const otpRows = await db
    .select()
    .from(otpCodes)
    .where(and(
      eq(otpCodes.mobile, mobile),
      eq(otpCodes.code, code),
      eq(otpCodes.verified, false),
      gt(otpCodes.expiresAt, new Date()),
    ))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);

  if (otpRows.length === 0) {
    return { success: false, message: "Invalid or expired OTP" };
  }

  // Mark OTP as verified
  await db.update(otpCodes).set({ verified: true }).where(eq(otpCodes.id, otpRows[0].id));

  // Find or create user
  let userRows = await db.select().from(appUsers).where(eq(appUsers.mobile, mobile)).limit(1);

  if (userRows.length === 0) {
    // Create new user with a session token
    const sessionToken = clientSessionToken || crypto.randomUUID();
    // Auto-assign admin role if this is the admin's mobile number
    const isAdmin = ENV.adminMobile && (mobile === ENV.adminMobile || mobile === "+91" + ENV.adminMobile.replace(/^\+91/, ""));
    await db.insert(appUsers).values({
      mobile,
      isVerified: true,
      sessionToken,
      role: isAdmin ? "admin" : "user",
    });
    userRows = await db.select().from(appUsers).where(eq(appUsers.mobile, mobile)).limit(1);
  } else {
    // Update last login
    // Also promote to admin if this is the admin's mobile (handles case where user registered before admin role was set up)
    const isAdmin = ENV.adminMobile && (mobile === ENV.adminMobile || mobile === "+91" + ENV.adminMobile.replace(/^\+91/, ""));
    // If client provides a sessionToken that DIFFERS from stored one, migrate ALL related data
    const oldToken = userRows[0].sessionToken;
    const newToken = clientSessionToken;
    if (newToken && oldToken && newToken !== oldToken) {
      console.log(`[verifyOtp] Token migration: ${oldToken.slice(0, 8)}... → ${newToken.slice(0, 8)}... for mobile ${mobile}`);
      try {
        // BUG-2 fix: Wrap all migration queries in a transaction to prevent partial data splits
        await db.transaction(async (tx: any) => {
          // Migrate upstox_credentials (primary + slots)
          await tx.update(upstoxCredentials).set({ sessionToken: newToken }).where(eq(upstoxCredentials.sessionToken, oldToken));
          await tx.update(upstoxCredentials).set({ sessionToken: newToken + "-slot1" }).where(eq(upstoxCredentials.sessionToken, oldToken + "-slot1"));
          await tx.update(upstoxCredentials).set({ sessionToken: newToken + "-slot2" }).where(eq(upstoxCredentials.sessionToken, oldToken + "-slot2"));
          await tx.update(upstoxCredentials).set({ sessionToken: newToken + "-slot3" }).where(eq(upstoxCredentials.sessionToken, oldToken + "-slot3"));
          // Migrate bot_sessions (primary + slots)
          await tx.update(botSessions).set({ sessionToken: newToken }).where(eq(botSessions.sessionToken, oldToken));
          await tx.update(botSessions).set({ sessionToken: newToken + "-slot1" }).where(eq(botSessions.sessionToken, oldToken + "-slot1"));
          await tx.update(botSessions).set({ sessionToken: newToken + "-slot2" }).where(eq(botSessions.sessionToken, oldToken + "-slot2"));
          await tx.update(botSessions).set({ sessionToken: newToken + "-slot3" }).where(eq(botSessions.sessionToken, oldToken + "-slot3"));
          // Migrate trade_log (primary + slots)
          await tx.update(tradeLog).set({ sessionToken: newToken }).where(eq(tradeLog.sessionToken, oldToken));
          await tx.update(tradeLog).set({ sessionToken: newToken + "-slot1" }).where(eq(tradeLog.sessionToken, oldToken + "-slot1"));
          await tx.update(tradeLog).set({ sessionToken: newToken + "-slot2" }).where(eq(tradeLog.sessionToken, oldToken + "-slot2"));
          await tx.update(tradeLog).set({ sessionToken: newToken + "-slot3" }).where(eq(tradeLog.sessionToken, oldToken + "-slot3"));
          // Migrate signal_journal (primary + slots)
          await tx.update(signalJournal).set({ sessionToken: newToken }).where(eq(signalJournal.sessionToken, oldToken));
          await tx.update(signalJournal).set({ sessionToken: newToken + "-slot1" }).where(eq(signalJournal.sessionToken, oldToken + "-slot1"));
          await tx.update(signalJournal).set({ sessionToken: newToken + "-slot2" }).where(eq(signalJournal.sessionToken, oldToken + "-slot2"));
          await tx.update(signalJournal).set({ sessionToken: newToken + "-slot3" }).where(eq(signalJournal.sessionToken, oldToken + "-slot3"));
          // Migrate subscriptions
          await tx.update(subscriptions).set({ sessionToken: newToken }).where(eq(subscriptions.sessionToken, oldToken));
        });
        console.log(`[verifyOtp] Token migration complete for mobile ${mobile}`);
      } catch (migrationErr) {
        console.error(`[verifyOtp] Token migration FAILED (rolled back) for mobile ${mobile}:`, migrationErr);
        // Transaction rolled back — old token still valid, user can still access account
      }
    }
    // Update user record
    await db.update(appUsers).set({
      isVerified: true,
      lastLoginAt: new Date(),
      ...(isAdmin && userRows[0].role !== "admin" ? { role: "admin" as const } : {}),
      ...(newToken ? { sessionToken: newToken } : {}),
    }).where(eq(appUsers.id, userRows[0].id));
    userRows = await db.select().from(appUsers).where(eq(appUsers.id, userRows[0].id)).limit(1);
  }

  return { success: true, user: userRows[0] };
}

/**
 * Get user by ID
 */
export async function getAppUserById(userId: number) {
  const db = await getDb();
  if (!db) return null;
  try {
    const rows = await db.select().from(appUsers).where(eq(appUsers.id, userId)).limit(1);
    return rows[0] ?? null;
  } catch {
    // Fallback: referral columns may not exist on Railway
    try {
      const [rawRows]: any = await db.execute(sql`SELECT id, mobile, name, role, isVerified, sessionToken, lastLoginAt, createdAt, updatedAt FROM app_users WHERE id = ${userId} LIMIT 1`);
      const row = Array.isArray(rawRows) ? rawRows[0] : rawRows;
      return row ?? null;
    } catch { return null; }
  }
}

/**
 * Get all app users (for admin panel)
 */
export async function getAllAppUsers() {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(appUsers).orderBy(desc(appUsers.createdAt));
  } catch {
    // Fallback: referral columns may not exist on Railway
    try {
      const [rawRows]: any = await db.execute(sql`SELECT id, mobile, name, role, isVerified, sessionToken, lastLoginAt, createdAt, updatedAt FROM app_users ORDER BY createdAt DESC`);
      return Array.isArray(rawRows) ? rawRows : [];
    } catch { return []; }
  }
}

/**
 * Get all subscriptions (for admin panel)
 */
export async function getAllSubscriptions() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(subscriptions).orderBy(desc(subscriptions.createdAt));
}

/**
 * Admin: grant subscription to a user
 */
export async function adminGrantSubscription(params: {
  sessionToken: string;
  plan: "trial" | "monthly" | "quarterly" | "half_yearly" | "yearly";
  daysOverride?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const now = new Date();
  const durationDays: Record<string, number> = {
    trial: 2,
    monthly: 30,
    quarterly: 90,
    half_yearly: 180,
    yearly: 365,
  };
  const days = params.daysOverride ?? durationDays[params.plan] ?? 30;
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  await db.insert(subscriptions).values({
    sessionToken: params.sessionToken,
    plan: params.plan,
    status: "active",
    amountPaid: 0,
    startsAt: now,
    expiresAt,
  });
  return { success: true, expiresAt };
}

/**
 * Admin: revoke (cancel) all active subscriptions for a session
 */
export async function adminRevokeAccess(sessionToken: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(subscriptions)
    .set({ status: "cancelled" })
    .where(and(
      eq(subscriptions.sessionToken, sessionToken),
      eq(subscriptions.status, "active"),
    ));
  return { success: true };
}

// ── Access Grants (Admin Manual Access) ─────────────────────────────────────

/**
 * Create a new access grant for a user (admin-initiated free access)
 */
export async function createAccessGrant(params: {
  userMobile?: string;
  userEmail?: string;
  userName?: string;
  plan: "monthly" | "quarterly" | "half_yearly" | "yearly" | "custom";
  durationDays: number;
  startsAt: Date;
  note?: string;
  grantedBy: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  // Normalize mobile to +91XXXXXXXXXX format for consistent lookup
  let normalizedMobile = params.userMobile?.trim();
  if (normalizedMobile) {
    normalizedMobile = normalizedMobile.replace(/[\s\-()]/g, "");
    if (normalizedMobile.startsWith("0")) normalizedMobile = normalizedMobile.slice(1);
    if (/^\d{10}$/.test(normalizedMobile)) normalizedMobile = "+91" + normalizedMobile;
    else if (normalizedMobile.startsWith("91") && normalizedMobile.length === 12) normalizedMobile = "+" + normalizedMobile;
    else if (!normalizedMobile.startsWith("+")) normalizedMobile = "+91" + normalizedMobile;
  }

  const expiresAt = new Date(params.startsAt.getTime() + params.durationDays * 24 * 60 * 60 * 1000);

  // Also create a subscription record so the user gets platform access
  // Find the user's sessionToken from app_users
  let sessionToken: string | null = null; 
  if (normalizedMobile) {
    const [user] = await db.select().from(appUsers).where(eq(appUsers.mobile, normalizedMobile)).limit(1);
    sessionToken = user?.sessionToken ?? null;
  }

  // Insert the grant record
  const [result] = await db.insert(accessGrants).values({
    userMobile: normalizedMobile ?? null,
    userEmail: params.userEmail ?? null,
    userName: params.userName ?? null,
    plan: params.plan,
    durationDays: params.durationDays,
    startsAt: params.startsAt,
    expiresAt,
    status: "active",
    note: params.note ?? null,
    grantedBy: params.grantedBy,
  });

  // If we found the user's sessionToken, also create a subscription so they get access
  if (sessionToken) {
    const planMap: Record<string, "trial" | "monthly" | "quarterly" | "half_yearly" | "yearly"> = {
      monthly: "monthly", quarterly: "quarterly", half_yearly: "half_yearly", yearly: "yearly", custom: "monthly",
    };
    await db.insert(subscriptions).values({
      sessionToken,
      plan: planMap[params.plan] ?? "monthly",
      status: "active",
      amountPaid: 0,
      razorpayOrderId: `GRANT_${result.insertId}`,
      startsAt: params.startsAt,
      expiresAt,
    });
  }

  return { success: true, id: result.insertId, expiresAt, sessionToken };
}

/**
 * List all access grants (for admin panel)
 */
export async function listAccessGrants() {
  const db = await getDb();
  if (!db) return [];
  // Auto-expire grants that have passed their expiresAt
  const now = new Date();
  await db.update(accessGrants)
    .set({ status: "expired" })
    .where(and(
      eq(accessGrants.status, "active"),
      lte(accessGrants.expiresAt, now),
    ));
  return db.select().from(accessGrants).orderBy(desc(accessGrants.createdAt));
}

/**
 * Revoke an access grant
 */
export async function revokeAccessGrant(grantId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const now = new Date();

  // Get the grant to find the linked subscription
  const [grant] = await db.select().from(accessGrants).where(eq(accessGrants.id, grantId)).limit(1);
  if (!grant) throw new Error("Grant not found");

  // Revoke the grant
  await db.update(accessGrants)
    .set({ status: "revoked", revokedAt: now })
    .where(eq(accessGrants.id, grantId));

  // Also revoke the linked subscription if exists
  if (grant.userMobile) {
    const [user] = await db.select().from(appUsers).where(eq(appUsers.mobile, grant.userMobile)).limit(1);
    if (user?.sessionToken) {
      await db.update(subscriptions)
        .set({ status: "cancelled" })
        .where(and(
          eq(subscriptions.sessionToken, user.sessionToken),
          eq(subscriptions.razorpayOrderId, `GRANT_${grantId}`),
        ));
    }
  }

  return { success: true };
}

/**
 * Extend an access grant by additional days
 */
export async function extendAccessGrant(grantId: number, additionalDays: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const [grant] = await db.select().from(accessGrants).where(eq(accessGrants.id, grantId)).limit(1);
  if (!grant) throw new Error("Grant not found");

  const newExpiresAt = new Date(grant.expiresAt.getTime() + additionalDays * 24 * 60 * 60 * 1000);
  const newDuration = grant.durationDays + additionalDays;

  await db.update(accessGrants)
    .set({ expiresAt: newExpiresAt, durationDays: newDuration, status: "active" })
    .where(eq(accessGrants.id, grantId));

  // Also extend the linked subscription
  if (grant.userMobile) {
    const [user] = await db.select().from(appUsers).where(eq(appUsers.mobile, grant.userMobile)).limit(1);
    if (user?.sessionToken) {
      await db.update(subscriptions)
        .set({ expiresAt: newExpiresAt, status: "active" })
        .where(and(
          eq(subscriptions.sessionToken, user.sessionToken),
          eq(subscriptions.razorpayOrderId, `GRANT_${grantId}`),
        ));
    }
  }

  return { success: true, newExpiresAt };
}
