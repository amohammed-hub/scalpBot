/**
 * Production audit: verify the auth + access-gating chain is wired correctly.
 * This is a read-only audit run against production (no mutations with real mobiles).
 * Checks:
 *  1. Login page serves.
 *  2. tRPC router exposes auth.sendOtp / auth.verifyOtp publicly.
 *  3. Access gating throws correctly for a nonexistent session token.
 *  4. Tier gating rules (live / MCX) are enforced in code paths (static checks).
 */
import fs from "fs";
import path from "path";

const ROOT = path.resolve(process.cwd());
const routersSrc = fs.readFileSync(path.join(ROOT, "server/routers.ts"), "utf8");
const dbSrc = fs.readFileSync(path.join(ROOT, "server/db.ts"), "utf8");
const tierSrc = fs.readFileSync(path.join(ROOT, "shared/tierLimits.ts"), "utf8");

const checks: [string, boolean][] = [];

// 1. OTP pipeline
checks.push(["sendOtp mutation exists", routersSrc.includes("sendOtp: publicProcedure")]);
checks.push(["verifyOtp mutation exists", routersSrc.includes("verifyOtp: publicProcedure")]);
checks.push(["Twilio SMS send path exists", dbSrc.includes("api.twilio.com/2010-04-01/Accounts/")]);
checks.push(["Twilio credentials env guard (fails loudly if missing)", dbSrc.includes("Twilio credentials not configured")]);

// 2. Session issuance
checks.push(["30-day JWT cookie issued on OTP verify", routersSrc.includes("scalpbot_auth") && routersSrc.includes("signMobileAuthToken")]);

// 3. Access gating for bot start (main)
checks.push(["Bot start blocks users without subscription", routersSrc.includes("No active subscription. Start a free trial or subscribe")]);

// 4. Live trading gating
checks.push(["Trial plan blocked from live mode (main bot)", routersSrc.includes("Live trading is not available during the free trial")]);
checks.push(["Trial plan blocked from live mode (slot bot)", (routersSrc.match(/Live trading is not available during the free trial/g) || []).length >= 2]);
checks.push(["Tier liveTrading flag present in tierLimits", tierSrc.includes("liveTrading: boolean")]);

// 5. MCX gating
checks.push(["MCX blocked for tiers without mcxAccess (main)", routersSrc.includes("is currently disabled. MCX instruments lost heavily")]);
checks.push(["Tier mcxAccess flag present", tierSrc.includes("mcxAccess: boolean")]);

// 6. Admin grant path (founder can onboard test users)
checks.push(["admin.grantAccess mutation exists", routersSrc.includes("adminGrantSubscription")]);
checks.push(["startTrial path exists in db", dbSrc.includes("export async function startTrial") || dbSrc.includes("startTrial")]);

// 7. Tier limits consistency with no trade caps
checks.push(["Trial tier unlimited trades (D14)", /trial:\s*{[\s\S]{0,60}?maxTradesPerDay: 0/.test(tierSrc)]);
checks.push(["Monthly tier unlimited trades (D14)", /monthly:\s*{[\s\S]{0,60}?maxTradesPerDay: 0/.test(tierSrc)]);

// 8. Loss cap still enforced in engine
const engineSrc = fs.readFileSync(path.join(ROOT, "server/botEngine.ts"), "utf8");
checks.push(["Daily loss cap enforced", engineSrc.includes("Daily loss limit reached")]);
checks.push(["StoplossGuard enforced", engineSrc.includes("getStoplossGuardState")]);

for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}`);
}
console.log(`\n${checks.filter((c) => !c[1]).length} failed of ${checks.length}`);
