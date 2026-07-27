/**
 * botRestart.ts
 * On server startup, query the DB for any botSessions with status="running"
 * and restart them. This ensures bots survive Autoscale cold starts (serverless scale-to-0).
 * If there is an open trade, it is restored so the bot can continue managing it.
 * If there is no open trade, the bot restarts in scanning mode (looking for new signals).
 *
 * SAFETY RULES:
 * 1. If the bot key is already in memory, skip it.
 * 2. partial1RPrice and partial2RPrice MUST be recalculated from entry/SL — never 0.
 * 3. Access token is loaded from DB for market data access.
 */
import { getDb } from "./db";
import { botSessions, tradeLog, upstoxCredentials } from "../drizzle/schema";
import { eq, and, desc, gte } from "drizzle-orm";
import { startBot, getBotState, fetchFullQuote, resolveSpecificOptionToken, resolveAtmMcxOptionToken, resolveMcxFuturesToken, type OpenTrade, type BotState } from "./botEngine";
import { getNseIndexLotSize } from "../shared/lotSizes";
import { getRecommendedLayers } from "../shared/backtestLayerMap";
import axios from "axios";

// Type alias for a row from botSessions (Drizzle infers this)
type BotSessionRow = typeof botSessions.$inferSelect;

/**
 * restartSingleSession
 *
 * Attempts to restart the bot for a single session row. Exported so that
 * botWatchdog.ts can call it for sessions that fall out of memory after startup.
 *
 * Returns true if the bot was started, false if it was skipped (already running
 * or no open trade), throws on unexpected errors.
 */
export async function restartSingleSession(session: BotSessionRow): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  // Skip if already running in memory
  if (getBotState(session.sessionToken)) {
    console.log(`[BotRestart] ${session.sessionToken.slice(0, 8)} already in memory — skipping`);
    return false;
  }

  // BUG-9 FIX: Calculate dailyPnl from today's closed trades (same as bot.start)
  // This avoids double-counting when bot_sessions.dailyPnl is stale but trade_log.bookedPnl was persisted
  const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const todayStartIST = new Date(nowIST);
  todayStartIST.setUTCHours(0, 0, 0, 0);
  const todayStartUTC = new Date(todayStartIST.getTime() - 5.5 * 60 * 60 * 1000);
  const todayPnlRows = await db
    .select({ pnl: tradeLog.pnl })
    .from(tradeLog)
    .where(and(
      eq(tradeLog.sessionToken, session.sessionToken),
      eq(tradeLog.status, "closed"),
      gte(tradeLog.exitedAt, todayStartUTC), // BUG-12 fix: use exitedAt — a trade entered yesterday but closed today should count in today's P&L
    ));
  const restoredDailyPnl = todayPnlRows.reduce((sum: number, r: { pnl: number | null }) => sum + (r.pnl ?? 0), 0);

  // Check if there is an open trade to restore
  const openTradeRows = await db
    .select()
    .from(tradeLog)
    .where(and(
      eq(tradeLog.sessionToken, session.sessionToken),
      eq(tradeLog.status, "open"),
    ))
    .orderBy(desc(tradeLog.enteredAt))
    .limit(1);
  // Build existingOpenTrade if there is one to restore
  let existingOpenTrade: OpenTrade | undefined = undefined;
  if (openTradeRows.length > 0) {
    const t = openTradeRows[0];
    const slDist = Math.abs(t.entryPrice - (t.slPrice ?? t.entryPrice));
    const partial1RPrice = t.partial1RPrice ?? (t.direction === "BUY"
      ? t.entryPrice + slDist
      : t.entryPrice - slDist);
    const partial2RPrice = t.partial2RPrice ?? (t.direction === "BUY"
      ? t.entryPrice + slDist * 2
      : t.entryPrice - slDist * 2);
    existingOpenTrade = {
      dbId: t.id,
      symbol: t.symbol,
      symbolLabel: t.symbolLabel ?? t.symbol,
      instrumentToken: t.instrumentToken ?? session.instrumentToken ?? "",
      direction: t.direction,
      mode: t.mode,
      entryPrice: t.entryPrice,
      quantity: t.quantity,
      slPrice: t.slPrice ?? 0,
      targetPrice: t.targetPrice ?? 0,
      atr: t.atr ?? 0,
      confidence: t.confidence ?? 0,
      upstoxOrderId: t.upstoxOrderId ?? undefined,
      enteredAt: t.enteredAt,
      trailingSlEnabled: session.trailingSlEnabled ?? false,
      trailingSlPct: session.trailingSlPct ?? 0.5,
      currentSl: session.currentSl ?? t.slPrice ?? 0,
      isReEntry: false,
      partial1RPrice,
      partial2RPrice,
      partialBooked: (t.partialBooked ?? 0) as 0 | 1 | 2,
      bookedQty: t.bookedQty ?? 0,
      bookedPnl: t.bookedPnl ?? 0,
      bookedPnlAddedToDaily: (t.bookedPnl ?? 0) > 0, // BUG-1 fix: if bookedPnl was persisted, dailyPnl already includes it
      // BUG-9 fix: Infer averageCount from quantity — if trade qty > initial lot allocation, it was averaged
      averageCount: (() => {
        const lotSz = session.lotSize ?? 1;
        const capital = session.capital ?? 100000;
        const riskPct = session.riskPerTradePct ?? 1;
        const slDist2 = Math.abs(t.entryPrice - (t.slPrice ?? t.entryPrice)) || t.entryPrice * 0.01;
        const riskAmt = capital * riskPct / 100;
        const initialQty = Math.max(lotSz, Math.floor(riskAmt / slDist2 / lotSz) * lotSz);
        return t.quantity > initialQty ? 1 : 0;
      })(),
      isIndexOptions: !!(session.isIndexOptions),
      entryUnderlyingPrice: session.isIndexOptions
        ? ((t as any).entryUnderlyingPrice ?? undefined)
        : undefined,
      optionMockKey: (() => {
        if (!session.isIndexOptions) return undefined;
        const sym = (session.instrumentSymbol ?? "").toUpperCase();
        const ceOrPe = (t.symbol ?? "").includes("_CE_") || (t.symbol ?? "").endsWith("_CE") ? "CE" : "PE";
        if (sym.includes("GOLD")) return ceOrPe === "CE" ? "MCX_GOLD_CE" : "MCX_GOLD_PE";
        if (sym.includes("SILVER")) return ceOrPe === "CE" ? "MCX_SILVER_CE" : "MCX_SILVER_PE";
        if (sym.includes("CRUDE") || sym.includes("OIL")) return ceOrPe === "CE" ? "MCX_CRUDE_CE" : "MCX_CRUDE_PE";
        if (sym.includes("NATGAS") || sym.includes("GAS")) return ceOrPe === "CE" ? "MCX_NATGAS_CE" : "MCX_NATGAS_PE";
        if (sym.includes("COPPER")) return ceOrPe === "CE" ? "MCX_COPPER_CE" : "MCX_COPPER_PE";
        if (sym.includes("ZINC")) return ceOrPe === "CE" ? "MCX_ZINC_CE" : "MCX_ZINC_PE";
        if (sym.includes("BANK")) return ceOrPe === "CE" ? "BNF_CE" : "BNF_PE";
        return ceOrPe === "CE" ? "NIFTY_CE" : "NIFTY_PE";
      })(),
    };
    console.log(`[BotRestart] ${session.sessionToken.slice(0, 8)} — restoring open trade #${t.id} ${t.direction} ${t.symbol} @ ₹${t.entryPrice} | SL: ₹${t.slPrice} | 1R: ₹${partial1RPrice.toFixed(2)}`);
  } else {
    console.log(`[BotRestart] ${session.sessionToken.slice(0, 8)} — no open trade, restarting in scan mode`);
  }

  // Look up access token (BUG 19 fix: slot bots use base token for creds)
  const baseToken = session.sessionToken.replace(/-slot\d+$/, "");
  const credRows = await db
    .select()
    .from(upstoxCredentials)
    .where(eq(upstoxCredentials.sessionToken, baseToken))
    .limit(1);
  let accessToken = credRows[0]?.accessToken ?? null;
  // FALLBACK: If no credentials found, try any credential row (single-user system)
  if (!accessToken) {
    const allCreds = await db.select().from(upstoxCredentials).limit(10);
    const credWithToken = allCreds.find((c: any) => !!c.accessToken);
    if (credWithToken) {
      accessToken = credWithToken.accessToken;
      await db.update(upstoxCredentials).set({ sessionToken: baseToken }).where(eq(upstoxCredentials.id, credWithToken.id));
      console.log(`[BotRestart] FALLBACK: Migrated credentials from ${credWithToken.sessionToken.slice(0, 8)}... to ${baseToken.slice(0, 8)}...`);
    }
  }

  // Build onTradeOpen callback
  const onTradeOpen = async (trade: {
    symbol: string; symbolLabel: string; instrumentToken: string;
    direction: "BUY" | "SELL"; mode: "demo" | "live";
    entryPrice: number; quantity: number; slPrice: number; targetPrice: number;
    atr: number; confidence: number; status: "open" | "closed" | "cancelled";
    upstoxOrderId?: string; signalReason: string; enteredAt: Date;
    partial1RPrice: number; partial2RPrice: number;
    entryUnderlyingPrice?: number;
  }): Promise<number> => {
    const dbInner = await getDb();
    if (!dbInner) return 0;
    const result = await dbInner.insert(tradeLog).values({
      sessionToken: session.sessionToken,
      sessionId: session.id,
      symbol: trade.symbol,
      symbolLabel: trade.symbolLabel,
      instrumentToken: trade.instrumentToken,
      direction: trade.direction,
      mode: trade.mode,
      entryPrice: trade.entryPrice,
      quantity: trade.quantity,
      slPrice: trade.slPrice,
      targetPrice: trade.targetPrice,
      atr: trade.atr,
      confidence: trade.confidence,
      signalReason: trade.signalReason,
      botSlot: session.botSlot ?? 0,
      status: "open",
      enteredAt: trade.enteredAt,
      partial1RPrice: trade.partial1RPrice,
      partial2RPrice: trade.partial2RPrice,
      entryUnderlyingPrice: trade.entryUnderlyingPrice,
    });
    return Number((result as unknown as [{ insertId: number }])[0].insertId);
  };

  // Build onTradeClose callback
  const onTradeClose = async (dbId: number, exitPrice: number, pnl: number, exitReason: string): Promise<void> => {
    const dbInner = await getDb();
    if (!dbInner) return;
    const capital = session.capital ?? 100000;
    await dbInner.update(tradeLog).set({
      status: "closed",
      exitPrice,
      pnl,
      pnlPct: (pnl / capital) * 100,
      exitReason,
      exitedAt: new Date(),
    }).where(eq(tradeLog.id, dbId));
    // Use live bot state for accurate counters (session snapshot is stale after restart)
    const liveState = getBotState(session.sessionToken);
    await dbInner.update(botSessions).set({
      tradesCount: liveState?.tradesCount ?? ((session.tradesCount ?? 0) + 1),
      dailyPnl: liveState?.dailyPnl ?? ((session.dailyPnl ?? 0) + pnl),
    }).where(eq(botSessions.sessionToken, session.sessionToken));
    // Refresh StoplossGuard from recent trades (same as primary path)
    try {
      const { updateStoplossGuard } = await import("./riskManager");
      const recentRows = await dbInner
        .select({ exitReason: tradeLog.exitReason, pnl: tradeLog.pnl })
        .from(tradeLog)
        .where(and(eq(tradeLog.sessionToken, session.sessionToken), eq(tradeLog.status, "closed")))
        .orderBy(desc(tradeLog.exitedAt))
        .limit(20);
      updateStoplossGuard(recentRows.reverse());
    } catch { /* non-fatal */ }
  };

  // Build onTick callback — persist live price, trailing SL, and tick timestamp to DB on every scan
  const onTick = async (state: BotState): Promise<void> => {
    const dbInner = await getDb();
    if (!dbInner) return;
    await dbInner.update(botSessions).set({
      lastPrice: state.lastPrice,
      bidPrice: state.bidPrice,
      askPrice: state.askPrice,
      nextScanAt: state.nextScanAt,
      lastSignal: state.lastSignal?.direction ?? null,
      lastSignalAt: state.lastSignal ? new Date() : undefined,
      // Trailing SL — written every tick so it survives the next restart
      currentSl: state.openTrade?.currentSl ?? null,
      // Staleness detection — Dashboard shows warning if this is too old
      lastTickAt: Date.now(),
      // Persist optionTradeToken so it survives server restarts
      optionTradeToken: state.optionTradeToken ?? null,
    }).where(eq(botSessions.sessionToken, state.sessionToken));
  };

  // ── MCX Token Resolution on Restart ──────────────────────────────────────────
  // If the DB has a placeholder token (e.g. "MCX_FO|GOLDM"), resolve it before starting the bot.
  let resolvedInstrumentToken = session.instrumentToken ?? "NSE_EQ|INE009A01021";
  let resolvedUnderlyingToken = session.underlyingToken ?? undefined;
  if (resolvedUnderlyingToken?.startsWith("MCX_FO|") && !/\|\d+$/.test(resolvedUnderlyingToken)) {
    const mcxSym = (session.instrumentSymbol ?? "").replace(/^MCX_/, "");
    if (mcxSym) {
      const resolved = await resolveMcxFuturesToken(mcxSym, accessToken);
      if (resolved) {
        console.log(`[BotRestart] MCX resolved placeholder: ${mcxSym} → ${resolved}`);
        resolvedUnderlyingToken = resolved;
        resolvedInstrumentToken = resolved;
        // Update DB so future restarts don't need to re-resolve
        await db.update(botSessions).set({ underlyingToken: resolved, instrumentToken: resolved }).where(eq(botSessions.sessionToken, session.sessionToken));
      }
    }
  } else if (resolvedInstrumentToken.startsWith("MCX_FO|") && !/\|\d+$/.test(resolvedInstrumentToken)) {
    const mcxSym = (session.instrumentSymbol ?? "").replace(/^MCX_/, "");
    if (mcxSym) {
      const resolved = await resolveMcxFuturesToken(mcxSym, accessToken);
      if (resolved) {
        console.log(`[BotRestart] MCX resolved placeholder instrumentToken: ${mcxSym} → ${resolved}`);
        resolvedInstrumentToken = resolved;
        if (!resolvedUnderlyingToken) resolvedUnderlyingToken = resolved;
        await db.update(botSessions).set({ instrumentToken: resolved, underlyingToken: resolved }).where(eq(botSessions.sessionToken, session.sessionToken));
      }
    }
  }

  // Count ACTUAL today's trades from DB — session.tradesCount may be stale after mid-day redeploy
  const todayTradesRows = await db
    .select({ id: tradeLog.id })
    .from(tradeLog)
    .where(and(
      eq(tradeLog.sessionToken, session.sessionToken),
      gte(tradeLog.enteredAt, todayStartUTC)
    ));
  const actualTodayTradesCount = todayTradesRows.length;
  console.log(`[BotRestart] ${session.sessionToken.slice(0,8)} actual today trades: ${actualTodayTradesCount} (DB session.tradesCount was ${session.tradesCount})`);

  startBot(
    {
      sessionToken: session.sessionToken,
      sessionId: session.id,
      status: "running",
      mode: session.mode,
      instrumentToken: resolvedInstrumentToken,
      instrumentSymbol: session.instrumentSymbol ?? "RELIANCE",
      instrumentLabel: session.instrumentLabel ?? "Reliance Industries",
      capital: session.capital ?? 100000,
      riskPerTradePct: session.riskPerTradePct ?? 1.0,
      maxTradesPerDay: session.maxTradesPerDay ?? 5,
      dailyLossLimitPct: session.dailyLossLimitPct ?? 3.0,
      stopLossMultiplier: session.stopLossMultiplier ?? 1.5,
      targetMultiplier: session.targetMultiplier ?? 3.0,
      trailingSlEnabled: session.trailingSlEnabled ?? false,
      trailingSlPct: session.trailingSlPct ?? 0.5,
      minConfidence: session.minConfidence ?? 60,
      scanIntervalSec: session.scanIntervalSec ?? 60,
      tradesCount: actualTodayTradesCount,
      dailyPnl: restoredDailyPnl,
      accessToken,
      telegramBotToken: session.telegramBotToken ?? null,
      telegramChatId: session.telegramChatId ?? null,
      telegramEnabled: session.telegramEnabled ?? false,
      botSlot: session.botSlot ?? 0,
      // Sanitize stale NSE lot sizes persisted before the Jan-2026 revision (e.g. NIFTY 25 → 65)
      lotSize: getNseIndexLotSize(session.instrumentSymbol ?? "") ?? session.lotSize ?? 1,
      isIndexOptions: !!(session.isIndexOptions),
      underlyingToken: resolvedUnderlyingToken,
     optionType: (session.optionType ?? undefined) as "CE" | "PE" | "auto" | undefined,
     consecutiveTickErrors: 0,
      capitalUsed: 0,
     enabledLayers: session.enabledLayers ? (() => { try { return JSON.parse(session.enabledLayers!); } catch { return undefined; } })() : getRecommendedLayers(session.instrumentLabel ?? session.instrumentSymbol ?? ""),
      partial1Pct: session.partial1Pct ?? 30,
      partial2Pct: session.partial2Pct ?? 60,
      carryForward: existingOpenTrade ? !!(openTradeRows[0]?.carryForward) : false,
      averagingEnabled: session.averagingEnabled ?? true,
      averagingLossThreshold: session.averagingLossThreshold ?? 0.20,
      unlimitedTrades: session.unlimitedTrades ?? false,
      openingBurstEnabled: session.openingBurstEnabled ?? false,
      consecutiveUnderlyingSLs: 0, lastUnderlyingSLAt: null,
      // Restore persisted optionTradeToken from DB — prevents underlying price leak after restart
      optionTradeToken: session.optionTradeToken ?? undefined,
      layerTradesCount: {},
    },
    onTradeOpen,
    onTradeClose,
    existingOpenTrade,
    onTick,
  );

  console.log(`[BotRestart] ✅ Restarted bot for session ${session.sessionToken.slice(0, 8)} — ${session.instrumentSymbol} ${session.mode} mode${existingOpenTrade ? ` — protecting open trade #${existingOpenTrade.dbId}` : " — scan mode"}`);
  return true;
}

/**
 * restartRunningBots
 *
 * Called once on server startup. Iterates all sessions marked "running" in DB
 * and calls restartSingleSession for each.
 */
export async function restartRunningBots(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.log("[BotRestart] DB unavailable — skipping auto-restart");
    return;
  }


  // STEP 0: Close any stale open trades from previous days.
  // These are trades that were never squared off (server was down during market close).
  try {
    const now = new Date();
    const istMin = ((now.getUTCHours() * 60 + now.getUTCMinutes()) + 330) % 1440;
    const openTrades = await db.select().from(tradeLog).where(eq(tradeLog.status, "open"));
   for (const t of openTrades) {
     const enteredAt = t.enteredAt ? new Date(t.enteredAt) : null;
      if (!enteredAt) continue;
      // PHANTOM TRADE DETECTION: If entry price is impossibly low (< ₹1), it was never actually filled.
      // These are ghost trades from the old actualFillPrice bug (filledQty used as price).
      if (t.entryPrice < 1.0) {
        console.log(`[BotRestart] 🚨 PHANTOM TRADE #${t.id} (${t.symbolLabel ?? t.symbol}) — entry ₹${t.entryPrice} is impossible. Auto-closing as phantom.`);
        await db.update(tradeLog).set({
          status: "closed",
          exitPrice: 0,
          pnl: 0,
          pnlPct: 0,
          exitReason: "Phantom trade — never filled on Upstox (entry < ₹1)",
          exitedAt: now,
        }).where(eq(tradeLog.id, t.id));
        continue;
      }
      const tradeDate = new Date(enteredAt.getTime() + 330 * 60000).toISOString().slice(0, 10);
      const todayDate = new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10);
      const isStale = tradeDate < todayDate;
      // Check if trade is MCX: either instrumentToken starts with MCX, or symbol contains MCX commodity names
      // (demo trades use PAPER_OPT| prefix, so we also check the symbol)
      const mcxCommodities = ["CRUDEOIL", "CRUDE", "GOLD", "SILVER", "NATURALGAS", "COPPER", "ZINC", "LEAD", "ALUMINIUM", "NICKEL"];
      const symbolUpper = (t.symbol ?? "").toUpperCase();
      const isMCX = (t.instrumentToken ?? "").startsWith("MCX") || mcxCommodities.some(c => symbolUpper.includes(c));
      const marketClosed = isMCX ? (istMin >= 23 * 60 + 30 || istMin < 9 * 60) : (istMin >= 15 * 60 + 30 || istMin < 9 * 60 + 15);
      if (isStale || marketClosed) {
        // Respect carry-forward flag: if trade is marked for carry-forward, skip closing it
        if (t.carryForward) {
          console.log(`[BotRestart] Trade #${t.id} (${t.symbolLabel ?? t.symbol}) has carryForward=true — keeping open`);
          continue;
        }
        // Try to fetch the last traded price from Upstox API
        let exitPrice = t.entryPrice; // fallback to entry price if API fails
        let pnl = 0;
        const bookedPnl = t.bookedPnl ?? 0;
        try {
          // Look up access token for this trade's session
          // BUG 19 fix: slot bots store creds under base token (strip -slot1/-slot2)
          const baseSessionToken = t.sessionToken.replace(/-slot\d+$/, "");
          const credRow = await db.select().from(upstoxCredentials)
            .where(eq(upstoxCredentials.sessionToken, baseSessionToken))
            .limit(1);
          const token = credRow[0]?.accessToken;
          if (token && t.instrumentToken) {
            // BUG 17 fix: For options trades, the instrumentToken might be the underlying index
            // or a fake PAPER_OPT token. Skip fetching in both cases.
            const isPaperToken = t.instrumentToken.startsWith("PAPER_OPT|");
            const isIndexToken = t.instrumentToken.startsWith("NSE_INDEX|");
            const isOptionTrade = (t.symbol ?? "").includes("CE") || (t.symbol ?? "").includes("PE");
            if (isPaperToken || (isIndexToken && isOptionTrade)) {
              // For paper/stale option trades: try to resolve real option token and fetch live quote
              let resolved = false;
              try {
                const sym = ((t as any).symbolLabel ?? t.symbol ?? "").toUpperCase();
                const ceOrPe: "CE" | "PE" = sym.includes("CE") ? "CE" : "PE";
                const isMcxTrade = sym.includes("CRUDE") || sym.includes("GOLD") || sym.includes("SILVER") || sym.includes("NATGAS");
                const strikeMatch = sym.match(/(\d{3,6})\s*(CE|PE)/);
                const exactStrike = strikeMatch ? parseInt(strikeMatch[1], 10) : 0;
                let resolvedToken: string | null = null;
                if (exactStrike > 0 && isMcxTrade) {
                  const underlying = t.instrumentToken.replace("PAPER_OPT|", "");
                  const mcxResult = await resolveAtmMcxOptionToken(underlying, ceOrPe, token);
                  resolvedToken = mcxResult?.token ?? null;
                } else if (exactStrike > 0) {
                  const underlying = sym.includes("BANK") ? "NSE_INDEX|Nifty Bank" : sym.includes("FIN") ? "NSE_INDEX|Nifty Fin Service" : "NSE_INDEX|Nifty 50";
                  resolvedToken = await resolveSpecificOptionToken(underlying, ceOrPe, exactStrike, token);
                }
                if (resolvedToken) {
                  const q = await fetchFullQuote(resolvedToken, token);
                  if (q && q.ltp > 0) {
                    exitPrice = q.bid > 0 ? Math.max(q.bid, q.ltp) : q.ltp;
                    resolved = true;
                    console.log(`[BotRestart] Resolved demo trade #${t.id} ${t.symbol} → real token ${resolvedToken} → exit ₹${exitPrice.toFixed(2)}`);
                  }
                }
              } catch (resolveErr) {
                console.warn(`[BotRestart] Could not resolve demo trade #${t.id} ${t.symbol}:`, resolveErr);
              }
              if (!resolved) {
                // Fallback: close at entry price (0 P&L on remaining) — safe default
                exitPrice = t.entryPrice;
              }
            } else {
              const quote = await fetchFullQuote(t.instrumentToken, token);
              if (quote && quote.ltp > 0) {
                exitPrice = quote.bid > 0 ? Math.max(quote.bid, quote.ltp) : quote.ltp;
              }
            }
          }
        } catch (ltpErr) {
          console.warn(`[BotRestart] Could not fetch LTP for trade #${t.id}:`, ltpErr);
        }
        // Calculate P&L using actual exit price
        const staleRemQty = t.quantity - (t.bookedQty ?? 0);
        pnl = t.direction === "BUY"
          ? (exitPrice - t.entryPrice) * staleRemQty
          : (t.entryPrice - exitPrice) * staleRemQty;
        const totalPnl = pnl + bookedPnl;
        const exitReason = isStale
          ? `Stale — auto-closed on startup (previous day) @ ₹${exitPrice.toFixed(2)}`
          : `Market Close — auto-closed on startup @ ₹${exitPrice.toFixed(2)}`;
        await db.update(tradeLog).set({
          status: "closed",
          exitPrice,
          pnl: totalPnl,
          exitReason,
          exitedAt: now,
        }).where(eq(tradeLog.id, t.id));
        console.log(`[BotRestart] Closed stale trade #${t.id} (${t.symbolLabel ?? t.symbol}) — entered ${tradeDate} | exit @ ₹${exitPrice} | P&L: ₹${totalPnl.toFixed(0)}`);
      }
    }
    if (openTrades.length > 0) {
      console.log(`[BotRestart] Checked ${openTrades.length} open trade(s) for staleness`);
    }
  } catch (cleanupErr) {
    console.error("[BotRestart] Stale trade cleanup error:", cleanupErr);
  }
  // Find all sessions that were "running" when the server went down
  const runningSessions = await db
    .select()
    .from(botSessions)
    .where(eq(botSessions.status, "running"));

  if (runningSessions.length === 0) {
    console.log("[BotRestart] No running sessions to restore");
    return;
  }

  console.log(`[BotRestart] Found ${runningSessions.length} session(s) marked running — restarting all...`);

  for (const session of runningSessions) {
    try {
      await restartSingleSession(session);
    } catch (err) {
      console.error(`[BotRestart] ❌ Failed to restart session ${session.sessionToken.slice(0, 8)}:`, err);
    }
  }
}
