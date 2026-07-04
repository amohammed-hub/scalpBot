import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import { upstoxCredentials, botSessions, tradeLog } from "../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";
import { startBot, stopBot, getBotState } from "./botEngine";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  credentials: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return null;
      const rows = await db.select().from(upstoxCredentials).where(eq(upstoxCredentials.userId, ctx.user.id)).limit(1);
      if (rows.length === 0) return null;
      const row = rows[0];
      return { id: row.id, apiKey: row.apiKey, apiSecretMasked: row.apiSecret.slice(0, 4) + "****", hasAccessToken: !!row.accessToken, tokenExpiresAt: row.tokenExpiresAt, redirectUri: row.redirectUri };
    }),
    save: protectedProcedure.input(z.object({ apiKey: z.string().min(1), apiSecret: z.string().min(1), redirectUri: z.string().optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const existing = await db.select({ id: upstoxCredentials.id }).from(upstoxCredentials).where(eq(upstoxCredentials.userId, ctx.user.id)).limit(1);
      if (existing.length > 0) {
        await db.update(upstoxCredentials).set({ apiKey: input.apiKey, apiSecret: input.apiSecret, redirectUri: input.redirectUri }).where(eq(upstoxCredentials.userId, ctx.user.id));
      } else {
        await db.insert(upstoxCredentials).values({ userId: ctx.user.id, apiKey: input.apiKey, apiSecret: input.apiSecret, redirectUri: input.redirectUri });
      }
      return { success: true };
    }),
    saveAccessToken: protectedProcedure.input(z.object({ accessToken: z.string().min(1) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await db.update(upstoxCredentials).set({ accessToken: input.accessToken, tokenExpiresAt: expires }).where(eq(upstoxCredentials.userId, ctx.user.id));
      return { success: true };
    }),
  }),

  bot: router({
    status: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return null;
      const rows = await db.select().from(botSessions).where(eq(botSessions.userId, ctx.user.id)).orderBy(desc(botSessions.updatedAt)).limit(1);
      const inMem = getBotState(ctx.user.id);
      if (rows.length === 0) return null;
      return { ...rows[0], lastPrice: inMem?.lastPrice ?? 0, lastSignal: inMem?.lastSignal ?? null };
    }),
    start: protectedProcedure.input(z.object({ instrumentToken: z.string().default("NSE_EQ|INE009A01021"), instrumentSymbol: z.string().default("RELIANCE"), mode: z.enum(["paper", "live"]).default("paper"), capital: z.number().default(100000), riskPerTradePct: z.number().default(1.0), maxTradesPerDay: z.number().default(5), dailyLossLimitPct: z.number().default(3.0) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      let accessToken: string | null = null;
      if (input.mode === "live") {
        const creds = await db.select().from(upstoxCredentials).where(eq(upstoxCredentials.userId, ctx.user.id)).limit(1);
        if (creds.length === 0 || !creds[0].accessToken) throw new Error("No Upstox access token. Connect your account first.");
        accessToken = creds[0].accessToken;
      }
      const existing = await db.select({ id: botSessions.id }).from(botSessions).where(eq(botSessions.userId, ctx.user.id)).limit(1);
      let sessionId: number;
      if (existing.length > 0) {
        sessionId = existing[0].id;
        await db.update(botSessions).set({ status: "running", mode: input.mode, instrumentToken: input.instrumentToken, instrumentSymbol: input.instrumentSymbol, capital: input.capital, riskPerTradePct: input.riskPerTradePct, maxTradesPerDay: input.maxTradesPerDay, dailyLossLimitPct: input.dailyLossLimitPct, tradesCount: 0, dailyPnl: 0, startedAt: new Date(), stoppedAt: null, lastError: null }).where(eq(botSessions.userId, ctx.user.id));
      } else {
        const result = await db.insert(botSessions).values({ userId: ctx.user.id, status: "running", mode: input.mode, instrumentToken: input.instrumentToken, instrumentSymbol: input.instrumentSymbol, capital: input.capital, riskPerTradePct: input.riskPerTradePct, maxTradesPerDay: input.maxTradesPerDay, dailyLossLimitPct: input.dailyLossLimitPct, tradesCount: 0, dailyPnl: 0, startedAt: new Date() });
        sessionId = Number((result as unknown as { insertId: number }).insertId);
      }
      startBot({ userId: ctx.user.id, sessionId, status: "running", mode: input.mode, instrumentToken: input.instrumentToken, instrumentSymbol: input.instrumentSymbol, capital: input.capital, riskPerTradePct: input.riskPerTradePct, maxTradesPerDay: input.maxTradesPerDay, dailyLossLimitPct: input.dailyLossLimitPct, tradesCount: 0, dailyPnl: 0, accessToken }, async (trade) => {
        const dbInner = await getDb();
        if (!dbInner) return;
        await dbInner.insert(tradeLog).values({ userId: ctx.user.id, sessionId, ...trade });
        const state = getBotState(ctx.user.id);
        if (state) await dbInner.update(botSessions).set({ tradesCount: state.tradesCount, dailyPnl: state.dailyPnl, lastSignal: state.lastSignal?.direction, lastSignalAt: new Date(), status: state.status, lastError: state.lastError }).where(eq(botSessions.userId, ctx.user.id));
      });
      return { success: true, sessionId };
    }),
    stop: protectedProcedure.mutation(async ({ ctx }) => {
      stopBot(ctx.user.id);
      const db = await getDb();
      if (db) await db.update(botSessions).set({ status: "stopped", stoppedAt: new Date() }).where(eq(botSessions.userId, ctx.user.id));
      return { success: true };
    }),
    liveData: protectedProcedure.query(({ ctx }) => {
      const state = getBotState(ctx.user.id);
      if (!state) return { price: 0, signal: null, candles: [] };
      return { price: state.lastPrice, signal: state.lastSignal, candles: state.candles.slice(-30) };
    }),
  }),

  trades: router({
    list: protectedProcedure.input(z.object({ limit: z.number().default(50) }).optional()).query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(tradeLog).where(eq(tradeLog.userId, ctx.user.id)).orderBy(desc(tradeLog.enteredAt)).limit(input?.limit ?? 50);
    }),
    stats: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { totalTrades: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0, avgPnl: 0 };
      const trades = await db.select().from(tradeLog).where(and(eq(tradeLog.userId, ctx.user.id), eq(tradeLog.status, "closed")));
      const totalTrades = trades.length;
      const wins = trades.filter((t) => (t.pnl ?? 0) > 0).length;
      const losses = trades.filter((t) => (t.pnl ?? 0) < 0).length;
      const totalPnl = trades.reduce((a, t) => a + (t.pnl ?? 0), 0);
      return { totalTrades, wins, losses, winRate: totalTrades > 0 ? (wins / totalTrades) * 100 : 0, totalPnl, avgPnl: totalTrades > 0 ? totalPnl / totalTrades : 0 };
    }),
  }),
});

export type AppRouter = typeof appRouter;
