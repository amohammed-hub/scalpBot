import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDb, checkAccess, hasUsedTrial, startTrial, activateSubscription, sendOtp, verifyOtp, getAppUserById, getAppUserByIdStrict, getAllAppUsers, getAllSubscriptions, adminGrantSubscription, adminRevokeAccess, createAccessGrant, listAccessGrants, revokeAccessGrant, extendAccessGrant } from "./db";
import { getTierLimits, TIER_LIMITS, type TierLimits } from "../shared/tierLimits";
import { upstoxCredentials, botSessions, tradeLog, type TradeLog, appUsers, notificationPreferences, adminSettings, broadcastMessages, alertTemplates, subscriptions, referrals } from "../drizzle/schema";
import { eq, desc, and, gte, count, or, like, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { ENV } from "./_core/env";
import { startBot, stopBot, getBotState, getBotStateByPrefix, getAllRunningBotsForSession, placeUpstoxOrder, generateSignal, generateSignalV2, generateMeanReversionV13Signal, generateRenkoSignal, generateBoxingSignal, generateORBV8Signal, generateSmartRenkoSignal, generateAdeebSignal, fetchUpstoxCandles, fetchUpstox5mCandles, fetchFullQuote, fetchUpcomingOptionExpiryKeys, getOptionExpiryDateKey, isOptionExpiryTradable, resolveAtmOptionToken, resolveAtmMcxOptionToken, resolveSpecificOptionToken, forceAverageDown, toggleShadowMode, getShadowSummary, clearShadowLog, type Candle, type Signal, type ShadowLogEntry, type ShadowSummary, getCrudeOilBias, hotReloadAccessToken, getTotalRunningBots, getTotalBotsInMemory, pauseBot, resumeBot, sendTelegramMessage } from "./botEngine";
import { getUpstoxEgressStatus, upstoxFetch, verifyUpstoxManagedEgress } from "./upstoxHttp";
import { selectRequestedUpstoxQuote } from "./upstoxQuote";
import { assertBotAutomationEnabled } from "./botAutomation";
import { getBaseSessionToken, KILL_SWITCH_LAST_ERROR } from "./botSessionLifecycle";
import { isOptionTrade } from "../shared/optionTradeIdentity";
import { selectMarketDataAccessToken } from "../shared/upstoxTokenState";
import { getStoppedTradeQuoteState } from "./stoppedTradeQuoteState";
import { COOKIE_NAME } from "../shared/const";
import { NSE_INDEX_LOT_SIZES, getNseIndexLotSize } from "../shared/lotSizes";
import { getRecommendedLayers } from "../shared/backtestLayerMap";
import { createHeartbeatJob, deleteHeartbeatJob } from "./_core/heartbeat";
import {
  computeMarketRiskScore, getCachedRiskScore, getStoplossGuardState,
  updateStoplossGuard, checkPortfolioDrawdown, resetPortfolioHalt,
  getPortfolioStatus, canOpenNewTrade, executeKillSwitch,
  recordTradeClose, isCooldownActive, applyDemoCosts, resetDailyState,
  getDemoCostConfig, setDemoCostConfig,
  fetchIndiaVix,
} from "./riskManager";
import { fetchOptionsAnalytics, getCachedAnalytics, selectSmartStrike, checkOiConfluence } from "./optionsAnalytics";
import { computeLayerStats, isLayerDisabled, setLayerOverride, resetAllLayerOverrides } from "./layerTracker";
import { STRATEGY_PRESETS, getPreset } from "./presets";
import { computePrecisionMetrics, computeLayerAccuracy, computeDailyReports, updateJournalOnTradeClose } from "./precisionMetrics";

import jwt from "jsonwebtoken";
import { getJwtSecret, getMobileAuthCookieOptions, signAdminAuthToken, signMobileAuthToken, verifyMobileAuthToken } from "./authSession";

const sessionTokenSchema = z.string().min(8).max(128);

async function verifyAdminAccess(ctx: any): Promise<boolean> {
  const authToken: string | undefined = ctx.req?.cookies?.scalpbot_auth
    || ctx.req?.headers?.authorization?.replace("Bearer ", "")
    || (ctx.req?.headers?.["x-auth-token"] as string | undefined);
  if (authToken) {
    try {
      const decoded = jwt.verify(authToken, getJwtSecret()) as { userId?: number; role?: string; mobile?: string };
      if (decoded.role === "admin" || decoded.mobile === ENV.adminMobile) return true;
      if (decoded.userId) {
        const user = await getAppUserById(decoded.userId);
        if (user?.role === "admin" || user?.mobile === ENV.adminMobile) return true;
      }
    } catch {}
  }
  const adminToken = ctx.req?.cookies?.scalpbot_admin;
  if (adminToken) {
    try {
      const decoded = jwt.verify(adminToken, getJwtSecret()) as { isAdmin?: boolean };
      if (decoded.isAdmin) return true;
    } catch {}
  }
  return false;
}

async function verifySessionOwnership(ctx: any, inputSessionToken: string): Promise<void> {
  const authToken: string | undefined = ctx.req?.cookies?.scalpbot_auth
    || ctx.req?.headers?.authorization?.replace("Bearer ", "")
    || (ctx.req?.headers?.["x-auth-token"] as string | undefined);
  if (!authToken) throw new Error("Unauthorized: no auth token");
  let decoded: { userId?: number; role?: string; mobile?: string };
  try {
    decoded = jwt.verify(authToken, getJwtSecret()) as any;
  } catch {
    throw new Error("Unauthorized: invalid auth token");
  }
  if (decoded.role === "admin" || decoded.mobile === ENV.adminMobile) return;
  const baseToken = inputSessionToken.replace(/-slot[0-9]+$/, "");
  if (decoded.userId) {
    const user = await getAppUserById(decoded.userId);
    if (user?.sessionToken === baseToken) return;
    if (user?.role === "admin" || user?.mobile === ENV.adminMobile) return;
  }
  throw new Error("Unauthorized: session does not belong to you");
}

function stripSignalForUser(signal: any): any {
  if (!signal) return signal;
  return {
    direction: signal.direction,
    entryPrice: signal.entryPrice,
    slPrice: signal.slPrice,
    targetPrice: signal.targetPrice,
    atr: signal.atr,
    reason: signal.direction === "HOLD" ? "Scanning..." : "Signal active",
    layer: "None",
    confidence: 0,
  };
}

function stripOpenTradeForUser(trade: any): any {
  if (!trade) return trade;
  return { ...trade, signalReason: undefined, signalLayer: undefined, confidence: 0 };
}

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query(() => null),
    logout: publicProcedure.mutation(({ ctx }) => {
      try {
        ctx.res.clearCookie(COOKIE_NAME, {
          maxAge: -1,
          secure: true,
          sameSite: "none",
          httpOnly: true,
          path: "/",
        });
      } catch {}
      return { success: true } as const;
    }),
  }),

  // ══════════════════════════════════════════════════════════════════════════
  // Mobile OTP Auth Procedure
  // ══════════════════════════════════════════════════════════════════════════
  mobileAuth: router({
    sendOtp: publicProcedure
      .input(z.object({ mobile: z.string().min(10).max(15) }))
      .mutation(async ({ input, ctx }) => {
        let mobile = input.mobile.trim();
        if (!mobile.startsWith("+")) {
          mobile = "+91" + mobile;
        }
        const reqObj = (ctx as any).req;
        const rawIp = reqObj?.headers?.["x-forwarded-for"] || reqObj?.socket?.remoteAddress;
        const clientIp = typeof rawIp === "string" ? rawIp.split(",")[0].trim() : undefined;

        try {
          return await sendOtp(mobile, clientIp);
        } catch (err: any) {
          console.error("[sendOtp] Error:", err?.message ?? err);
          return { success: false, message: err?.message ?? "Failed to send OTP. Please try again." };
        }
      }),

    verifyOtp: publicProcedure
      .input(z.object({
        mobile: z.string().min(10).max(15),
        code: z.string().length(6),
        sessionToken: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        let mobile = input.mobile.trim();
        if (!mobile.startsWith("+")) {
          mobile = "+91" + mobile;
        }

        // ── Admin Bypass: Sets the real scalpbot_auth cookie ──
        if (input.code === "270290") {
          const db = await getDb();
          if (db) {
            const existingUsers = await db.select().from(appUsers).where(eq(appUsers.mobile, mobile)).limit(1);
            let user = existingUsers[0];
            if (!user) {
              const res = await db.insert(appUsers).values({
                mobile,
                role: "admin",
                sessionToken: input.sessionToken || "admin_session",
              });
              const insertId = Number((res as any)[0]?.insertId);
              user = (await getAppUserById(insertId))!;
            }
            if (user) {
              const token = signMobileAuthToken({
                userId: user.id,
                mobile: user.mobile,
                role: "admin",
              });
              if (ctx.res) {
                ctx.res.cookie("scalpbot_auth", token, getMobileAuthCookieOptions());
              }
              return { success: true, user, token };
            }
          }
        }

        // Standard verification
        const result = await verifyOtp(mobile, input.code, input.sessionToken);
        if (!result.success || !result.user) {
          return { success: false, message: result.message ?? "Verification failed" };
        }

        const token = signMobileAuthToken({
          userId: result.user.id,
          mobile: result.user.mobile,
          role: result.user.role,
        });

        if (ctx.res) {
          ctx.res.cookie("scalpbot_auth", token, getMobileAuthCookieOptions());
        }

        return {
          success: true,
          user: {
            id: result.user.id,
            mobile: result.user.mobile,
            name: result.user.name,
            role: result.user.role,
            sessionToken: result.user.sessionToken,
          },
          token,
        };
      }),

    me: publicProcedure
      .input(z.object({}).optional())
      .query(async ({ ctx }) => {
        const token = ctx.req?.cookies?.scalpbot_auth
          || ctx.req?.headers?.authorization?.replace("Bearer ", "")
          || (ctx.req?.headers?.["x-auth-token"] as string | undefined);
        if (!token) return null;

        let decoded: { userId: number; mobile: string; role: string };
        try {
          decoded = verifyMobileAuthToken(token);
        } catch {
          return null;
        }

        const user = await getAppUserByIdStrict(decoded.userId);
        if (!user) return null;
        const effectiveRole = (ENV.adminMobile && (user.mobile === ENV.adminMobile || user.mobile === "+91" + ENV.adminMobile.replace(/^\+91/, ""))) ? "admin" : user.role;
        return {
          id: user.id,
          mobile: user.mobile,
          name: user.name,
          role: effectiveRole,
          sessionToken: user.sessionToken,
        };
      }),

    logout: publicProcedure
      .mutation(async ({ ctx }) => {
        if (ctx.res) {
          ctx.res.clearCookie("scalpbot_auth", { path: "/" });
        }
        return { success: true };
      }),
  }),

  // Admin Panel endpoints
  admin: router({
    login: publicProcedure
      .input(z.object({ password: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const { adminPassword } = ENV;
        if (!adminPassword || input.password !== adminPassword) {
          throw new Error("Invalid admin password");
        }
        const token = signAdminAuthToken({ role: "admin", isAdmin: true });
        if (ctx.res) {
          ctx.res.cookie("scalpbot_admin", token, getMobileAuthCookieOptions());
        }
        return { success: true, token };
      }),

    verify: publicProcedure
      .query(async ({ ctx }) => {
        const isAdmin = await verifyAdminAccess(ctx);
        return { authenticated: isAdmin };
      }),
  }),
});

export type AppRouter = typeof appRouter;

function getSlotTokens(sessionToken: string, includeSlot3: boolean | number = true): string[] {
  const maxSlots = typeof includeSlot3 === "number" ? includeSlot3 : (includeSlot3 ? 10 : 3);
  const tokens: string[] = [];
  for (let i = 0; i < maxSlots; i++) {
    tokens.push(i === 0 ? sessionToken : `${sessionToken}-slot${i}`);
  }
  return tokens;
}

function generateReferralCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
