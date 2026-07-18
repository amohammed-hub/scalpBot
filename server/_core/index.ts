// ── PROCESS-LEVEL CRASH PREVENTION ──────────────────────────────────────────
// Catch unhandled promise rejections and uncaught exceptions to prevent
// the Node.js process from crashing (which kills all running bots).
process.on("unhandledRejection", (reason, promise) => {
  console.error("[PROCESS] ⚠ Unhandled Promise Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[PROCESS] ⚠ Uncaught Exception:", err.message, err.stack);
  // Do NOT exit — keep the process alive so bots continue running
});

import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { sdk } from "./sdk";
import { getDb } from "../db";
import { upstoxCredentials, botSessions, tradeLog } from "../../drizzle/schema";
import { eq, and, gte, inArray } from "drizzle-orm";
import { restartRunningBots } from "../botRestart";
import { startBotWatchdog } from "../botWatchdog";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.use(cookieParser());
  registerStorageProxy(app);
  registerOAuthRoutes(app);

  // Upstox token exchange proxy — called from standalone HTML to avoid CORS
  app.post('/api/upstox-token', async (req, res) => {
    try {
      const { code, client_id, client_secret, redirect_uri } = req.body;
      if (!code || !client_id || !client_secret || !redirect_uri) {
        res.status(400).json({ error: 'Missing required fields: code, client_id, client_secret, redirect_uri' });
        return;
      }
      const params = new URLSearchParams({ code, client_id, client_secret, redirect_uri, grant_type: 'authorization_code' });
      const upstoxResp = await fetch('https://api.upstox.com/v2/login/authorization/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: params.toString()
      });
      const data = await upstoxResp.json();
      // Add CORS headers so the standalone HTML file can call this
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.status(upstoxResp.status).json(data);
    } catch (err: any) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.status(500).json({ error: err.message });
    }
  });

  // CORS preflight for the token endpoint
  app.options('/api/upstox-token', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.sendStatus(204);
  });
  // Simple health check endpoint for Railway/uptime monitoring
  app.get('/api/health', (_req, res) => {
    res.status(200).json({ ok: true, timestamp: Date.now() });
  });

  // ── Server-side Upstox OAuth Callback ──────────────────────────────────────────
  // Upstox redirects here with ?code= after PIN entry.
  // We handle it server-side so the query params are never stripped by the platform.
  // After exchanging the code for a token, we redirect to the frontend /upstox-callback
  // with a ?status= param so the UI can show success/error.
  app.get('/api/upstox-callback', async (req, res) => {
    const code = req.query.code as string | undefined;
    const error = req.query.error as string | undefined;
    const errorDesc = req.query.error_description as string | undefined;

    if (error || !code) {
      const msg = encodeURIComponent(error ? `${error}${errorDesc ? ': ' + errorDesc : ''}` : 'No code returned by Upstox');
      res.redirect(302, `/upstox-callback?status=error&msg=${msg}`);
      return;
    }

    try {
      const db = await getDb();
      if (!db) {
        res.redirect(302, `/upstox-callback?status=error&msg=${encodeURIComponent('DB unavailable')}`);
        return;
      }

      // The session token is passed as the OAuth `state` parameter so the server
      // can look up credentials without needing cookies or localStorage.
      const state = req.query.state as string | undefined;
      const sessionToken = state ? decodeURIComponent(state) : undefined;

      if (!sessionToken) {
        res.redirect(302, `/upstox-callback?status=error&msg=${encodeURIComponent('Session not found. Please save credentials first.')}`);
        return;
      }

      const rows = await db
        .select()
        .from(upstoxCredentials)
        .where(eq(upstoxCredentials.sessionToken, sessionToken))
        .limit(1);

      if (!rows.length || !rows[0].apiKey || !rows[0].apiSecret) {
        res.redirect(302, `/upstox-callback?status=error&msg=${encodeURIComponent('API Key/Secret not found. Save credentials in Settings first.')}`);
        return;
      }

      const { apiKey, apiSecret, redirectUri: savedRedirectUri } = rows[0];

      // Use the redirectUri saved in DB — this is the exact URI the frontend sent to Upstox
      // during the authorization request. It MUST match byte-for-byte for the token exchange.
      // Fallback: build from request headers if DB value is missing or is the default placeholder.
      let redirectUri: string;
      const isPlaceholder = !savedRedirectUri ||
        savedRedirectUri === 'http://localhost:8000/callback' ||
        savedRedirectUri.startsWith('http://localhost');

      if (!isPlaceholder) {
        redirectUri = savedRedirectUri;
      } else {
        const proto = (req.headers['x-forwarded-proto'] as string || req.protocol).split(',')[0].trim();
        const host = (req.headers['x-forwarded-host'] as string || req.get('host') || '');
        redirectUri = `${proto}://${host}/api/upstox-callback`;
      }

      console.log('[upstox-callback] using redirect_uri:', redirectUri, '| from DB:', !isPlaceholder);

      const params = new URLSearchParams({
        code,
        client_id: apiKey,
        client_secret: apiSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      });

      const tokenResp = await fetch('https://api.upstox.com/v2/login/authorization/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: params.toString(),
      });

      const tokenData = await tokenResp.json() as { access_token?: string; error?: string; error_description?: string };

      if (!tokenResp.ok || !tokenData.access_token) {
        const errMsg = tokenData.error_description || tokenData.error || `HTTP ${tokenResp.status}`;
        res.redirect(302, `/upstox-callback?status=error&msg=${encodeURIComponent('Token exchange failed: ' + errMsg)}`);
        return;
      }

      const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await db
        .update(upstoxCredentials)
        .set({ accessToken: tokenData.access_token, tokenExpiresAt: expires })
        .where(eq(upstoxCredentials.sessionToken, sessionToken));

      res.redirect(302, `/upstox-callback?status=success`);
    } catch (err: any) {
      res.redirect(302, `/upstox-callback?status=error&msg=${encodeURIComponent(err.message || 'Unknown error')}`);
    }
  });

  // ── Scheduled: Daily Upstox Token Refresh (8:30 AM IST = 03:00 UTC) ──────────
  // This endpoint is called by the Manus heartbeat cron system.
  // It re-initiates the Upstox OAuth flow by sending a Telegram reminder
  // (since Upstox requires manual login — no refresh token is available).
  app.post('/api/scheduled/token-refresh', async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req as any);
      if (!user.isCron || !user.taskUid) {
        res.status(403).json({ error: 'cron-only endpoint' });
        return;
      }
      const db = await getDb();
      if (!db) {
        res.status(500).json({ error: 'DB unavailable' });
        return;
      }
      // Look up credentials by cronTaskUid
      const rows = await db
        .select()
        .from(upstoxCredentials)
        .where(eq(upstoxCredentials.autoRefreshCronTaskUid, user.taskUid))
        .limit(1);
      if (!rows.length) {
        // Orphan cron — return 200 so platform stops retrying
        res.json({ ok: true, skipped: 'orphan' });
        return;
      }
      const creds = rows[0];
      // Upstox does NOT support refresh tokens — every day requires a new OAuth login.
      // We send a Telegram reminder to the user to log in and get a new token.
      // If Telegram is not configured, we log a reminder to the server console.
      const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
      const telegramChatId = process.env.TELEGRAM_CHAT_ID;
      const loginUrl = `https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id=${creds.apiKey}&redirect_uri=${encodeURIComponent(creds.redirectUri || '')}`;
      const message = [
        '\u23F0 <b>Daily Token Refresh Reminder</b>',
        '',
        'Your Upstox access token expires at midnight. Please refresh it now:',
        '',
        `1. Open your ScalpBot app`,
        `2. Go to Settings \u2192 Get Token Automatically`,
        `3. Log in with Mobile Number \u2192 OTP \u2192 PIN (NOT QR code)`,
        '',
        '\u26a0\ufe0f Token must be refreshed before 9:15 AM for Live trading.',
        '',
        `\u{1F916} ScalpBot \u2014 ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`,
      ].join('\n');
      if (telegramBotToken && telegramChatId) {
        try {
          await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: telegramChatId, text: message, parse_mode: 'HTML' }),
            signal: AbortSignal.timeout(10000),
          });
        } catch (e) {
          console.error('[token-refresh] Telegram send failed:', e);
        }
      } else {
        console.log('[token-refresh] No Telegram configured. Reminder: refresh Upstox token for session', creds.sessionToken.slice(0, 8));
      }
      res.json({ ok: true, sessionToken: creds.sessionToken.slice(0, 8), reminded: true });
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
        stack: err.stack,
        context: { url: req.url, taskUid: req.headers['x-task-uid'] },
        timestamp: new Date().toISOString(),
      });
    }
  });

  // ── Scheduled: End-of-Day Summary (11:30 PM IST = 18:00 UTC) ────────────────
  // Sends a daily P&L summary via Telegram for all sessions that have Telegram configured.
  app.post('/api/scheduled/eod-summary', async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req as any);
      if (!user.isCron || !user.taskUid) {
        res.status(403).json({ error: 'cron-only endpoint' });
        return;
      }
      const db = await getDb();
      if (!db) { res.json({ ok: true, skipped: 'no-db' }); return; }
      // BUG 20 fix: Use IST midnight (Railway runs UTC)
      const eodNowMs = Date.now(); const eodIstOff = 5.5 * 60 * 60 * 1000;
      const eodIstNow = new Date(eodNowMs + eodIstOff); eodIstNow.setUTCHours(0, 0, 0, 0);
      const todayStart = new Date(eodIstNow.getTime() - eodIstOff);
      // Find all sessions with Telegram enabled
      const activeSessions = await db
        .select()
        .from(botSessions)
        .where(eq(botSessions.telegramEnabled, 1 as any))
        .limit(50);
      let summariesSent = 0;
      for (const session of activeSessions) {
        if (!session.telegramBotToken || !session.telegramChatId) continue;
        const token = session.sessionToken;
        const slotTokens = [token, `${token}-slot1`, `${token}-slot2`, `${token}-slot3`];
        const trades = await db
          .select()
          .from(tradeLog)
          .where(and(
            inArray(tradeLog.sessionToken, slotTokens),
            eq(tradeLog.status, 'closed'),
            gte(tradeLog.enteredAt, todayStart),
          ));
        if (trades.length === 0) continue;
        type TradeRow = typeof trades[number];
        const totalPnl = trades.reduce((s: number, t: TradeRow) => s + (t.pnl ?? 0), 0);
        const wins = trades.filter((t: TradeRow) => (t.pnl ?? 0) > 0).length;
        const losses = trades.filter((t: TradeRow) => (t.pnl ?? 0) <= 0).length;
        const winRate = Math.round(wins / trades.length * 100);
        const pnlSign = totalPnl >= 0 ? '+' : '';
        const dateStr = todayStart.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        const bestPnl = Math.max(...trades.map((t: TradeRow) => t.pnl ?? 0));
        const worstPnl = Math.min(...trades.map((t: TradeRow) => t.pnl ?? 0));
        const pnlEmoji = totalPnl >= 0 ? '\uD83D\uDFE2' : '\uD83D\uDD34';
        const message = [
          `${pnlEmoji} <b>End-of-Day Summary \u2014 ${dateStr}</b>`,
          ``,
          `\uD83D\uDCB0 Net P&L: <b>${pnlSign}\u20B9${totalPnl.toFixed(0)}</b>`,
          `\uD83D\uDCCA Trades: ${trades.length} | Wins: ${wins} | Losses: ${losses} | Win Rate: ${winRate}%`,
          `\uD83C\uDFC6 Best: +\u20B9${bestPnl.toFixed(0)} | \uD83D\uDCC9 Worst: \u20B9${worstPnl.toFixed(0)}`,
          ``,
          `\uD83E\uDD16 ScalpBot MCX closed \u2014 ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`,
        ].join('\n');
        try {
          await fetch(`https://api.telegram.org/bot${session.telegramBotToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: session.telegramChatId, text: message, parse_mode: 'HTML' }),
            signal: AbortSignal.timeout(10000),
          });
          summariesSent++;
        } catch { /* non-critical */ }
      }
      res.json({ ok: true, summariesSent });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // NSE Close Summary — fires at 3:30 PM IST (10:00 UTC) for NSE/BankNifty sessions
  app.post('/api/scheduled/nse-summary', async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req as any);
      if (!user.isCron || !user.taskUid) {
        res.status(403).json({ error: 'cron-only endpoint' });
        return;
      }
      const db = await getDb();
      if (!db) { res.json({ ok: true, skipped: 'no-db' }); return; }
      const nowMs = Date.now(); const istOff = 5.5 * 60 * 60 * 1000;
      const istNow = new Date(nowMs + istOff); istNow.setUTCHours(0, 0, 0, 0);
      const todayStart = new Date(istNow.getTime() - istOff);
      const activeSessions = await db
        .select()
        .from(botSessions)
        .where(eq(botSessions.telegramEnabled, 1 as any))
        .limit(50);
      let summariesSent = 0;
      for (const session of activeSessions) {
        if (!session.telegramBotToken || !session.telegramChatId) continue;
        const token = session.sessionToken;
        const slotTokens = [token, `${token}-slot1`, `${token}-slot2`, `${token}-slot3`];
        const trades = await db
          .select()
          .from(tradeLog)
          .where(and(
            inArray(tradeLog.sessionToken, slotTokens),
            eq(tradeLog.status, 'closed'),
            gte(tradeLog.enteredAt, todayStart),
          ));
        const mcxKeywords = ['GOLD', 'SILVER', 'CRUDE', 'OIL', 'NATGAS', 'GAS', 'COPPER', 'ZINC', 'MCX'];
        type NseTradeRow = typeof trades[number];
        const nseTrades = trades.filter((t: NseTradeRow) => {
          const sym = (t.symbol ?? '').toUpperCase();
          return !mcxKeywords.some(k => sym.includes(k));
        });
        if (nseTrades.length === 0) continue;
        const totalPnl = nseTrades.reduce((s: number, t: NseTradeRow) => s + (t.pnl ?? 0), 0);
        const wins = nseTrades.filter((t: NseTradeRow) => (t.pnl ?? 0) > 0).length;
        const losses = nseTrades.filter((t: NseTradeRow) => (t.pnl ?? 0) <= 0).length;
        const winRate = Math.round(wins / nseTrades.length * 100);
        const pnlSign = totalPnl >= 0 ? '+' : '';
        const dateStr = todayStart.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        const bestPnl = Math.max(...nseTrades.map((t: NseTradeRow) => t.pnl ?? 0));
        const worstPnl = Math.min(...nseTrades.map((t: NseTradeRow) => t.pnl ?? 0));
        const pnlEmoji = totalPnl >= 0 ? '\uD83D\uDFE2' : '\uD83D\uDD34';
        const message = [
          `${pnlEmoji} <b>NSE Close Summary \u2014 ${dateStr}</b>`,
          ``,
          `\uD83D\uDCB0 Net P&L: <b>${pnlSign}\u20B9${totalPnl.toFixed(0)}</b>`,
          `\uD83D\uDCCA Trades: ${nseTrades.length} | Wins: ${wins} | Losses: ${losses} | Win Rate: ${winRate}%`,
          `\uD83C\uDFC6 Best: +\u20B9${bestPnl.toFixed(0)} | \uD83D\uDCC9 Worst: \u20B9${worstPnl.toFixed(0)}`,
          ``,
          `\uD83E\uDD16 ScalpBot NSE closed \u2014 ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`,
        ].join('\n');
        try {
          await fetch(`https://api.telegram.org/bot${session.telegramBotToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: session.telegramChatId, text: message, parse_mode: 'HTML' }),
            signal: AbortSignal.timeout(10000),
          });
          summariesSent++;
        } catch { /* non-critical */ }
      }
      res.json({ ok: true, summariesSent });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = parseInt(process.env.PORT || "3000");

  server.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${port}/`);
    // Load persisted paper cost config from DB
    loadPaperCostsFromDb().catch(err => console.warn('[PaperCost] Startup load error:', err));
    // Auto-restart any bots that were running before the server went down.
    // This ensures live price feed and SL/Target monitoring resume after deploys.
    restartRunningBots().catch(err => console.error('[BotRestart] Startup error:', err));
    // Start the health watchdog — checks every 60s for sessions that fell out of memory
    startBotWatchdog();
  });
}

startServer().catch(console.error);
import { loadPaperCostsFromDb } from "../riskManager";
