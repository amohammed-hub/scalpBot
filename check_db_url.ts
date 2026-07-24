import { env } from "./server/_core/env";
console.log("DATABASE_URL host:", process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "unknown");
console.log("DATABASE_URL db:", process.env.DATABASE_URL?.split("/").pop()?.split("?")[0] ?? "unknown");
process.exit(0);
