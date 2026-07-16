import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, float, boolean, bigint } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Kept for framework compatibility but not used for app features.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ── Subscriptions ────────────────────────────────────────────────────────────
export const subscriptions = mysqlTable("subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  sessionToken: varchar("sessionToken", { length: 128 }).notNull(),
  plan: mysqlEnum("plan", ["trial", "monthly", "quarterly", "half_yearly", "yearly"]).notNull(),
  status: mysqlEnum("status", ["active", "expired", "cancelled"]).default("active").notNull(),
  razorpayOrderId: varchar("razorpayOrderId", { length: 128 }),
  razorpayPaymentId: varchar("razorpayPaymentId", { length: 128 }),
  razorpaySubscriptionId: varchar("razorpaySubscriptionId", { length: 128 }),
  amountPaid: int("amountPaid").default(0), // in paise
  startsAt: timestamp("startsAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Subscription = typeof subscriptions.$inferSelect;

// ── Upstox Credentials ────────────────────────────────────────────────────────
// sessionToken: browser-generated UUID stored in localStorage — no Manus login required
export const upstoxCredentials = mysqlTable("upstox_credentials", {
  id: int("id").autoincrement().primaryKey(),
  sessionToken: varchar("sessionToken", { length: 128 }).notNull(),
  apiKey: varchar("apiKey", { length: 128 }).notNull(),
  apiSecret: varchar("apiSecret", { length: 256 }).notNull(),
  accessToken: text("accessToken"),
  tokenExpiresAt: timestamp("tokenExpiresAt"),
  redirectUri: varchar("redirectUri", { length: 512 }).default("http://localhost:8000/callback"),
  autoRefreshCronTaskUid: varchar("autoRefreshCronTaskUid", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type UpstoxCredentials = typeof upstoxCredentials.$inferSelect;

// ── Bot Sessions ──────────────────────────────────────────────────────────────
export const botSessions = mysqlTable("bot_sessions", {
  id: int("id").autoincrement().primaryKey(),
  sessionToken: varchar("sessionToken", { length: 128 }).notNull(),
  status: mysqlEnum("status", ["running", "stopped", "paused", "error"]).default("stopped").notNull(),
  mode: mysqlEnum("mode", ["paper", "live"]).default("paper").notNull(),
  instrumentToken: varchar("instrumentToken", { length: 128 }).default("NSE_EQ|INE009A01021"),
  instrumentSymbol: varchar("instrumentSymbol", { length: 32 }).default("RELIANCE"),
  instrumentLabel: varchar("instrumentLabel", { length: 128 }).default("Reliance Industries"),
  capital: float("capital").default(100000),
  riskPerTradePct: float("riskPerTradePct").default(1.0),
  maxTradesPerDay: int("maxTradesPerDay").default(5),
  dailyLossLimitPct: float("dailyLossLimitPct").default(3.0),
  stopLossMultiplier: float("stopLossMultiplier").default(1.5),
  targetMultiplier: float("targetMultiplier").default(3.0),
  trailingSlEnabled: boolean("trailingSlEnabled").default(false),
  trailingSlPct: float("trailingSlPct").default(0.5),
  minConfidence: float("minConfidence").default(60),
  scanIntervalSec: int("scanIntervalSec").default(60),
  tradesCount: int("tradesCount").default(0),
  dailyPnl: float("dailyPnl").default(0),
  startedAt: timestamp("startedAt"),
  stoppedAt: timestamp("stoppedAt"),
  lastSignal: varchar("lastSignal", { length: 16 }),
  lastSignalAt: timestamp("lastSignalAt"),
  lastPrice: float("lastPrice").default(0),
  bidPrice: float("bidPrice").default(0),
  askPrice: float("askPrice").default(0),
  nextScanAt: bigint("nextScanAt", { mode: "number" }).default(0),
  lastError: text("lastError"),
  // Telegram alert config (server-side, so bot can send alerts directly)
  telegramBotToken: varchar("telegramBotToken", { length: 256 }),
  telegramChatId: varchar("telegramChatId", { length: 64 }),
  telegramEnabled: boolean("telegramEnabled").default(false),
  // Trailing SL — updated on every tick so it survives server restarts
  currentSl: float("currentSl"),
  // Last tick timestamp (unix ms) — used for staleness detection on Dashboard
  lastTickAt: bigint("lastTickAt", { mode: "number" }).default(0),
  // Multi-bot slot (0 = primary, 1 = secondary, 2 = tertiary)
  botSlot: int("botSlot").default(0),
  // Lot size for quantity rounding (1 for equity, 15 for BankNifty futures, etc.)
  lotSize: int("lotSize").default(1),
  // Options mode: when true, bot reads underlying for signals and trades ATM CE/PE
  isIndexOptions: boolean("isIndexOptions").default(false),
  underlyingToken: varchar("underlyingToken", { length: 128 }),
  optionType: varchar("optionType", { length: 8 }),
  // End-of-day summary cron task UID (set when EOD summary is enabled)
  eodSummaryCronTaskUid: varchar("eodSummaryCronTaskUid", { length: 128 }),
  // Strategy layer selection (JSON array of enabled layer names)
  enabledLayers: text("enabledLayers"),
  // Configurable partial profit booking percentages (persisted for restart)
  partial1Pct: float("partial1Pct").default(30),
  partial2Pct: float("partial2Pct").default(60),
  // Averaging/DCA settings
  averagingEnabled: boolean("averagingEnabled").default(true),
  averagingLossThreshold: float("averagingLossThreshold").default(0.20),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type BotSession = typeof botSessions.$inferSelect;

// ── Trade Log ─────────────────────────────────────────────────────────────────
export const tradeLog = mysqlTable("trade_log", {
  id: int("id").autoincrement().primaryKey(),
  sessionToken: varchar("sessionToken", { length: 128 }).notNull(),
  sessionId: int("sessionId"),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  symbolLabel: varchar("symbolLabel", { length: 128 }),
  instrumentToken: varchar("instrumentToken", { length: 128 }),
  direction: mysqlEnum("direction", ["BUY", "SELL"]).notNull(),
  mode: mysqlEnum("mode", ["paper", "live"]).default("paper").notNull(),
  entryPrice: float("entryPrice").notNull(),
  exitPrice: float("exitPrice"),
  quantity: int("quantity").notNull(),
  slPrice: float("slPrice"),
  targetPrice: float("targetPrice"),
  atr: float("atr"),
  confidence: float("confidence"),
  status: mysqlEnum("status", ["open", "closed", "cancelled"]).default("open").notNull(),
  exitReason: varchar("exitReason", { length: 255 }),
  pnl: float("pnl"),
  pnlPct: float("pnlPct"),
  upstoxOrderId: varchar("upstoxOrderId", { length: 64 }),
  signalReason: text("signalReason"),
  botSlot: int("botSlot").default(0),
  // Partial profit booking levels — stored so they survive server restarts exactly
  partial1RPrice: float("partial1RPrice"),
  partial2RPrice: float("partial2RPrice"),
  // Partial booking state — persisted so it survives server restarts
  partialBooked: int("partialBooked").default(0),
  bookedQty: int("bookedQty").default(0),
  bookedPnl: float("bookedPnl").default(0),
  // Carry-forward: if true, trade should not be auto-closed on server restart
  carryForward: boolean("carryForward").default(false),
  // Options mode: underlying price at time of entry (for delta approximation P&L when live premium unavailable)
  entryUnderlyingPrice: float("entryUnderlyingPrice"),
  enteredAt: timestamp("enteredAt").defaultNow().notNull(),
  exitedAt: timestamp("exitedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type TradeLog = typeof tradeLog.$inferSelect;
export type InsertTradeLog = typeof tradeLog.$inferInsert;

// ── Signal Journal ───────────────────────────────────────────────────────────
// Logs EVERY signal generated (whether traded or rejected) for precision verification
export const signalJournal = mysqlTable("signal_journal", {
  id: int("id").autoincrement().primaryKey(),
  sessionToken: varchar("sessionToken", { length: 128 }).notNull(),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  instrumentToken: varchar("instrumentToken", { length: 128 }),
  direction: mysqlEnum("direction", ["BUY", "SELL"]).notNull(),
  layer: varchar("layer", { length: 64 }).notNull(), // signal layer (Supertrend, MACD/BB, etc.)
  confidence: float("confidence").notNull(),
  entryPrice: float("entryPrice").notNull(), // price at signal time
  suggestedSl: float("suggestedSl"), // suggested SL at signal time
  suggestedTarget: float("suggestedTarget"), // suggested target at signal time
  atr: float("atr"), // ATR at signal time
  // Market context at signal time
  regime: varchar("regime", { length: 32 }), // trending/ranging/high_vol/low_vol
  vixLevel: float("vixLevel"), // India VIX at signal time
  oiBias: varchar("oiBias", { length: 16 }), // bullish/bearish/neutral from options flow
  // Outcome tracking
  outcome: mysqlEnum("outcome", ["traded", "rejected", "pending"]).default("pending").notNull(),
  rejectReason: varchar("rejectReason", { length: 128 }), // why signal was rejected (risk gate, cooldown, etc.)
  tradeId: int("tradeId"), // FK to trade_log.id if traded
  // Post-trade outcome (filled after trade closes)
  exitPrice: float("exitPrice"),
  pnl: float("pnl"),
  exitReason: varchar("exitReason", { length: 255 }),
  holdDurationMs: bigint("holdDurationMs", { mode: "number" }), // how long the trade was held
  maxFavorableExcursion: float("maxFavorableExcursion"), // max profit during trade (MFE)
  maxAdverseExcursion: float("maxAdverseExcursion"), // max loss during trade (MAE)
  // Timestamps
  signalAt: timestamp("signalAt").defaultNow().notNull(),
  outcomeAt: timestamp("outcomeAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type SignalJournal = typeof signalJournal.$inferSelect;
export type InsertSignalJournal = typeof signalJournal.$inferInsert;

// ── App Users (Mobile OTP Auth) ─────────────────────────────────────────────
export const appUsers = mysqlTable("app_users", {
  id: int("id").autoincrement().primaryKey(),
  mobile: varchar("mobile", { length: 15 }).notNull().unique(), // E.164 format: +919876543210
  name: varchar("name", { length: 128 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  isVerified: boolean("isVerified").default(false).notNull(),
  sessionToken: varchar("sessionToken", { length: 128 }), // links to existing sessionToken-based data
  lastLoginAt: timestamp("lastLoginAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type AppUser = typeof appUsers.$inferSelect;
export type InsertAppUser = typeof appUsers.$inferInsert;

// ── OTP Codes ───────────────────────────────────────────────────────────────
export const otpCodes = mysqlTable("otp_codes", {
  id: int("id").autoincrement().primaryKey(),
  mobile: varchar("mobile", { length: 15 }).notNull(),
  code: varchar("code", { length: 6 }).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  verified: boolean("verified").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type OtpCode = typeof otpCodes.$inferSelect;
