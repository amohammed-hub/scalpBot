# Admin Panel Integration Notes

## Dashboard Structure (Dashboard.tsx - 3166 lines)
- Sidebar: lines 882-983 (aside element)
- Nav items array: lines 892-901 (Dashboard, Risk Calculator, Settings)
- Special nav buttons: Hero Zero (903), P&L Analytics (908), Backtester (913), Precision Verify (918)
- User info + logout: lines 923-944
- Main content: starts at line 985 (<main>)
- No view/tab state exists — it's a single-view dashboard

## Admin Router (routers.ts line 3481-3665)
- admin.login: password-based, sets scalpbot_admin cookie
- admin.verify: checks scalpbot_admin cookie
- admin.users: returns getAllAppUsers()
- admin.subscriptions: returns getAllSubscriptions()
- admin.grantAccess: grant subscription to a sessionToken
- admin.revokeAccess: revoke access for a sessionToken
- admin.stats: totalUsers, activeSubscriptions, trialUsers, totalRevenue, mrr
- admin.logout: clears scalpbot_admin cookie
- admin.userActivity: bot sessions + trade counts per user

## Plan
- Add a `showAdminPanel` state (boolean) to Dashboard
- Add "Admin Panel" button in sidebar (only if meQuery.data?.role === 'admin')
- When showAdminPanel is true, render AdminPanel component instead of main dashboard content
- AdminPanel uses trpc.admin.* endpoints but auth via scalpbot_auth cookie (role check) instead of separate admin password
- Need to update admin endpoints to also accept scalpbot_auth cookie with role='admin'

## meQuery returns
- id, mobile, name, role, sessionToken
- role can be 'admin' or 'user'
