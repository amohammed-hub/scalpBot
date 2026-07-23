# Audit Notes — Jul 23, 2026

## What Already Exists:

### Referral System (Backend)
- referral.myReferral — returns referralCode, referralCount, extraBotSlots (routers.ts:4824-4852)
- referral.applyCode — applies code, grants +1 extraBotSlots to referrer (routers.ts:4853-4889)
- referral.listAll — admin-only, lists all referrals (routers.ts:4890-4907)
- ReferralSection UI in Settings.tsx (lines 1537-1613) — shows code, copy button, apply input
- Schema: app_users has referralCode, referredBy, extraBotSlots; referrals table exists

### Anti-Duplicate — ALREADY FIXED
- routers.ts line 2468-2470: "Multiple bots CAN run the same instrument"
- Only blocks same STRIKE via excludeStrikes diversification
- No "Cannot run same instrument" error anywhere

### Bot Allocation
- Trial blocked from live at bot.start (line 410) and startSecondary (line 2452)
- extraBotSlots returned in subscription.checkAccess
- Dashboard shows 4th slot if isAdmin OR extraBotSlots > 0

### Admin Panel Existing Tabs
- users, subscriptions, activity, grants, notifications, broadcast, templates

## What Needs Implementation:
1. "Refer & Earn" card on Dashboard
2. Admin Panel: Referrals tab, Override Bot Count, System Health
3. Dashboard grid lg:grid-cols-4 when extraBotSlots > 0
