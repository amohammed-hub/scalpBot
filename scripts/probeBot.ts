// One-off probe: fetch bot states from production to see why Natural Gas bot triggers no trades.
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "../server/routers";

const API_BASE = process.env.API_BASE || "https://scalpbot.up.railway.app/api";
const SESSION = process.env.SESSION_TOKEN || "";

async function main() {
  const client = createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: API_BASE })],
  });
  const res = await client.multiBots.getAll.query({ sessionToken: SESSION });
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}
main().catch((e) => {
  console.error("FAILED:", e?.message ?? String(e));
  process.exit(1);
});
