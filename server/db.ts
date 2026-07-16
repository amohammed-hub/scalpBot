import { eq, and, desc, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { InsertUser, users, subscriptions, appUsers, otpCodes } from "../drizzle/schema";
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
export async function sendOtp(mobile: string): Promise<{ success: boolean; message: string }> {
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

  // Generate 6-digit code (or use fixed 000000 for admin bypass)
  const code = isAdminBypass ? "000000" : String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  // Store in DB
  await db.insert(otpCodes).values({ mobile, code, expiresAt });

  // Admin bypass: skip Twilio entirely
  if (isAdminBypass) {
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
    // If client provides a sessionToken, update the user's record to match
    // This ensures credentials/trades stored under the localStorage token stay linked
    await db.update(appUsers).set({
      isVerified: true,
      lastLoginAt: new Date(),
      ...(isAdmin && userRows[0].role !== "admin" ? { role: "admin" as const } : {}),
      ...(clientSessionToken ? { sessionToken: clientSessionToken } : {}),
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
  const rows = await db.select().from(appUsers).where(eq(appUsers.id, userId)).limit(1);
  return rows[0] ?? null;
}

/**
 * Get all app users (for admin panel)
 */
export async function getAllAppUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(appUsers).orderBy(desc(appUsers.createdAt));
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
