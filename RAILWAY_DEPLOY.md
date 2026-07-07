# ScalpBot — Railway Deployment Guide

## Prerequisites
- Railway account at railway.app
- GitHub account (to push code)

---

## Step 1 — Push code to GitHub

1. Go to Management UI → Code → **Download all files as ZIP**
2. Extract the ZIP on your computer
3. Create a new GitHub repo (private) and push the code:
   ```bash
   cd upstox-scalping-guide
   git init
   git add .
   git commit -m "Initial ScalpBot"
   git remote add origin https://github.com/YOUR_USERNAME/scalpbot.git
   git push -u origin main
   ```

---

## Step 2 — Create Railway project

1. Go to [railway.app](https://railway.app) → **New Project**
2. Select **Deploy from GitHub repo**
3. Connect your GitHub account and select the repo you just pushed

---

## Step 3 — Add MySQL database

1. In your Railway project, click **+ New** → **Database** → **MySQL**
2. Wait for it to provision (30–60 seconds)
3. Click the MySQL service → **Connect** tab → copy the `DATABASE_URL`

---

## Step 4 — Set environment variables

In your Railway project → **Variables** tab, add these:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Paste the MySQL URL from Step 3 |
| `JWT_SECRET` | Any random 64-char string (generate at [randomkeygen.com](https://randomkeygen.com)) |
| `NODE_ENV` | `production` |

Leave all other variables blank — the app works without them.

---

## Step 5 — Run database migrations

After first deploy, open Railway **Shell** tab and run:
```bash
pnpm db:push
```

This creates the required database tables.

---

## Step 6 — Get your permanent URL

Railway auto-assigns a URL like `scalpbot-production.up.railway.app`.

To use a custom domain:
1. Railway project → **Settings** → **Domains** → **Add Custom Domain**
2. Follow the DNS instructions

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | **Yes** | MySQL connection string from Railway |
| `JWT_SECRET` | **Yes** | Random secret for session signing |
| `NODE_ENV` | **Yes** | Set to `production` |
| `PORT` | No | Railway sets this automatically |

---

## Updating the app

Push new code to GitHub → Railway auto-deploys within 2 minutes.

---

## Troubleshooting

**App crashes on start:** Check Railway logs → most likely `DATABASE_URL` is missing or wrong.

**"Table doesn't exist" error:** Run `pnpm db:push` in Railway Shell.

**Token exchange fails:** Make sure your Upstox app's Redirect URI matches your Railway URL exactly: `https://YOUR-RAILWAY-URL/upstox-callback`
