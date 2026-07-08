import "dotenv/config";
import express from "express";
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
import { upstoxCredentials } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { restartRunningBots } from "../botRestart";

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

      const { apiKey, apiSecret } = rows[0];
      // Always build the redirect_uri from the actual request headers.
      // Behind a reverse proxy (Manus hosting), X-Forwarded-Proto gives us 'https'.
      // This MUST match exactly what the user registered in their Upstox Developer App:
      //   https://<domain>/api/upstox-callback
      const proto = (req.headers['x-forwarded-proto'] as string || req.protocol).split(',')[0].trim();
      const host = (req.headers['x-forwarded-host'] as string || req.get('host') || '');
      const redirectUri = `${proto}://${host}/api/upstox-callback`;

      // Log for debugging — visible in server logs
      console.log('[upstox-callback] token exchange redirect_uri:', redirectUri);
      console.log('[upstox-callback] x-forwarded-proto:', req.headers['x-forwarded-proto']);
      console.log('[upstox-callback] x-forwarded-host:', req.headers['x-forwarded-host']);
      console.log('[upstox-callback] req.protocol:', req.protocol);
      console.log('[upstox-callback] req.host:', req.get('host'));

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
    // Auto-restart any bots that were running before the server went down.
    // This ensures live price feed and SL/Target monitoring resume after deploys.
    restartRunningBots().catch(err => console.error('[BotRestart] Startup error:', err));
  });
}

startServer().catch(console.error);
