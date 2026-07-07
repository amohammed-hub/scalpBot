# Debug Notes — Auto Token Flow

## Railway Deployment
- Live URL: https://upstox-scalping-guide-production.up.railway.app
- Health: https://upstox-scalping-guide-production.up.railway.app/api/health returns {"ok":true}
- Dashboard: working
- DB tables created: trade_log, upstox_credentials, users

## Auto Token Flow Issue
The flow works like this:
1. User enters API Key + Secret in Settings → clicks Save Credentials
2. Settings.tsx calls `trpc.credentials.save` → saves apiKey/apiSecret/redirectUri to DB by sessionToken
3. User clicks "Get Token Automatically" → redirected to Upstox OAuth
4. After login, Upstox redirects to /upstox-callback?code=XXX
5. UpstoxCallback.tsx calls `trpc.credentials.exchangeCode` with {sessionToken, code, redirectUri}
6. Server looks up apiKey/apiSecret from DB by sessionToken → calls Upstox token API → saves accessToken to DB

## Root Cause of Failure
The Settings page calls `saveCredsMutation.mutateAsync` but uses `.catch(() => {})` which silently swallows errors.
If the DB save fails (e.g. DATABASE_URL not set yet, or network error), the user sees "Credentials saved" toast 
but nothing is actually in the DB. Then when exchangeCode runs, it finds no row and throws 
"API Key and Secret not found. Please save them in Settings first."

## Fix Needed
1. Settings.tsx: Show a clear error if credentials.save fails (don't silently swallow)
2. Settings.tsx: After saving, verify the save worked by re-reading from DB
3. Settings.tsx: The "Get Token Automatically" button should first save credentials to DB, THEN redirect to Upstox
   - Currently it just opens the Upstox URL immediately without ensuring DB save happened first
4. The auto-login button should be a button (not an <a> tag) that:
   a. Saves API key/secret to DB first
   b. Waits for confirmation
   c. Then redirects to Upstox OAuth URL

## sessionToken
- Stored in localStorage as "scalpbot_session"
- Generated as crypto.randomUUID() on first visit
- Used as the key to identify the user's credentials in DB
- IMPORTANT: If user opens app on a NEW device/browser, they get a NEW sessionToken
  → Their credentials won't be found in DB → auto-token will fail
  → This is a fundamental issue for multi-device use

## Current Status
- Railway deployment: LIVE and working
- DB tables: created
- Auto token: BROKEN because credentials not being saved to DB before OAuth redirect
