# Debug Notes - Admin Subscription Bypass

## Root Cause
- User is accessing Railway deployment (upstox-scalping-guide-production.up.railway.app) which has OLD code
- The Manus deployment (upstoxbot-gbvrdllk.manus.space) has the fix
- User's DB role was updated from "user" to "admin" via SQL
- The JWT cookie still has role="user" (issued before DB update)
- mobileAuth.me reads from DB so it returns role="admin" now
- But the Railway deployment doesn't have the `meQuery.data?.role !== "admin"` condition

## Current State
- DB: app_users id=1, mobile=+918686742267, role=admin (UPDATED)
- ADMIN_MOBILE env = +918686742267
- Manus code has: `{accessQuery.data && !accessQuery.data.hasAccess && meQuery.data?.role !== "admin" && (`
- checkAccess endpoint checks: decoded.role === "admin" OR decoded.mobile === ENV.adminMobile OR dbUser.role === "admin"
- verifyOtp now auto-promotes to admin on login

## Fix Needed
The user needs to either:
1. Use the Manus deployment URL and re-login (clear cookies or logout)
2. OR we need to make the fix even more robust - skip paywall entirely for admin
