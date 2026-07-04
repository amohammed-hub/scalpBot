import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, float } from "drizzle-orm/mysql-core";

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
  capital: float("capital").default(100000),
  riskPerTradePct: float("riskPerTradePct").default(1.0),
  maxTradesPerDay: int("maxTradesPerDay").default(5),
  dailyLossLimitPct: float("dailyLossLimitPct").default(3.0),
  tradesCount: int("tradesCount").default(0),
  dailyPnl: float("dailyPnl").default(0),
  startedAt: timestamp("startedAt"),
  stoppedAt: timestamp("stoppedAt"),
  lastSignal: varchar("lastSignal", { length: 16 }),
  lastSignalAt: timestamp("lastSignalAt"),
  lastError: text("lastError"),
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
  exitReason: varchar("exitReason", { length: 32 }),
  pnl: float("pnl"),
  pnlPct: float("pnlPct"),
  upstoxOrderId: varchar("upstoxOrderId", { length: 64 }),
  signalReason: text("signalReason"),
  enteredAt: timestamp("enteredAt").defaultNow().notNull(),
  exitedAt: timestamp("exitedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type TradeLog = typeof tradeLog.$inferSelect;
export type InsertTradeLog = typeof tradeLog.$inferInsert;
