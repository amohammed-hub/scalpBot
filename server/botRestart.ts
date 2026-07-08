/**
 * botRestart.ts
 * On server startup, query the DB for any botSessions with status="running"
 * and restart the bot engine for each one, restoring any open trade.
 * This ensures the live price feed and SL/Target monitoring resume
 * automatically after a server restart or code deploy.
 */
import { getDb } from "./db";
import { botSessions, tradeLog, upstoxCredentials } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { startBot, getBotState, type OpenTrade } from "./botEngine";

export async function restartRunningBots(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.log("[BotRestart] DB unavailable — skipping auto-restart");
    return;
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

  console.log(`[BotRestart] Found ${runningSessions.length} session(s) to restore`);

  for (const session of runningSessions) {
    try {
      // Skip if already running in memory (shouldn't happen on fresh start)
      if (getBotState(session.sessionToken)) {
        console.log(`[BotRestart] ${session.sessionToken.slice(0, 8)} already in memory — skipping`);
        continue;
      }

      // Look up access token
      const credRows = await db
        .select()
        .from(upstoxCredentials)
        .where(eq(upstoxCredentials.sessionToken, session.sessionToken))
        .limit(1);
      const accessToken = credRows[0]?.accessToken ?? null;

      // Look up any open trade for this session
      const openTradeRows = await db
        .select()
        .from(tradeLog)
        .where(and(
          eq(tradeLog.sessionToken, session.sessionToken),
          eq(tradeLog.status, "open"),
        ))
        .limit(1);

      let existingOpenTrade: OpenTrade | null = null;
      if (openTradeRows.length > 0) {
        const t = openTradeRows[0];
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
          currentSl: t.slPrice ?? 0,
          isReEntry: false,
          partial1RPrice: 0,
          partial2RPrice: 0,
          partialBooked: 0,
          bookedQty: 0,
          bookedPnl: 0,
        };
        console.log(`[BotRestart] ${session.sessionToken.slice(0, 8)} — restoring open trade #${t.id} ${t.direction} ${t.symbol} @ ₹${t.entryPrice}`);
      }

      // Build onTradeOpen callback — TradeInsert type does NOT include sessionToken/sessionId/botSlot
      // Those come from the session closure variable
      const onTradeOpen = async (trade: {
        symbol: string; symbolLabel: string; instrumentToken: string;
        direction: "BUY" | "SELL"; mode: "paper" | "live";
        entryPrice: number; quantity: number; slPrice: number; targetPrice: number;
        atr: number; confidence: number; status: "open" | "closed" | "cancelled";
        upstoxOrderId?: string; signalReason: string; enteredAt: Date;
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
        });
        return (result as any).insertId ?? 0;
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
        await dbInner.update(botSessions).set({
          tradesCount: (session.tradesCount ?? 0) + 1,
          dailyPnl: (session.dailyPnl ?? 0) + pnl,
        }).where(eq(botSessions.sessionToken, session.sessionToken));
      };

      // Build onTick callback — persist live price to DB on every scan
      const onTick = async (state: import("./botEngine").BotState): Promise<void> => {
        const dbInner = await getDb();
        if (!dbInner) return;
        await dbInner.update(botSessions).set({
          lastPrice: state.lastPrice,
          bidPrice: state.bidPrice,
          askPrice: state.askPrice,
          nextScanAt: state.nextScanAt,
          lastSignal: state.lastSignal?.direction ?? null,
          lastSignalAt: state.lastSignal ? new Date() : undefined,
        }).where(eq(botSessions.sessionToken, state.sessionToken));
      };

      startBot(
        {
          sessionToken: session.sessionToken,
          sessionId: session.id,
          status: "running",
          mode: session.mode,
          instrumentToken: session.instrumentToken ?? "NSE_EQ|INE009A01021",
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
          tradesCount: session.tradesCount ?? 0,
          dailyPnl: session.dailyPnl ?? 0,
          accessToken,
          telegramBotToken: session.telegramBotToken ?? null,
          telegramChatId: session.telegramChatId ?? null,
          telegramEnabled: session.telegramEnabled ?? false,
          botSlot: session.botSlot ?? 0,
        },
        onTradeOpen,
        onTradeClose,
        existingOpenTrade,
        onTick,
      );

      console.log(`[BotRestart] ✅ Restarted bot for session ${session.sessionToken.slice(0, 8)} — ${session.instrumentSymbol} ${session.mode} mode`);
    } catch (err) {
      console.error(`[BotRestart] ❌ Failed to restart session ${session.sessionToken.slice(0, 8)}:`, err);
    }
  }
}
