export type UpstoxTokenHealthStatus =
  | "valid"
  | "expired"
  | "error"
  | "no_db"
  | "not_configured"
  | "no_token";

export type UpstoxTokenDisplayState =
  | "valid"
  | "checking"
  | "expired"
  | "error"
  | "missing";

/**
 * ScalpBot paper/demo mode uses live Upstox market data but never places an
 * exchange order. Sandbox tokens are restricted to sandbox order APIs and
 * must not be sent to market-quote, option-chain, contract, or candle APIs.
 */
export function selectMarketDataAccessToken(credentials: {
  accessToken?: string | null;
} | null | undefined): string | null {
  const token = credentials?.accessToken?.trim();
  return token ? token : null;
}

/**
 * A stored token is only presence, not proof of authorization. Fail closed:
 * show green only after the server has validated the token against Upstox.
 */
export function getUpstoxTokenDisplayState(
  hasStoredAccessToken: boolean,
  healthStatus?: UpstoxTokenHealthStatus,
): UpstoxTokenDisplayState {
  if (healthStatus === "valid") return "valid";
  if (healthStatus === "expired") return "expired";
  if (healthStatus === "error" || healthStatus === "no_db") return "error";
  if (healthStatus === "no_token" || healthStatus === "not_configured") return "missing";
  return hasStoredAccessToken ? "checking" : "missing";
}

export function getUpstoxTokenDisplayLabel(state: UpstoxTokenDisplayState): string {
  switch (state) {
    case "valid":
      return "Token OK";
    case "checking":
      return "Checking Token";
    case "expired":
      return "Token Expired";
    case "error":
      return "Token Error";
    case "missing":
      return "No Token";
  }
}

export function tokenHealthBlocksAuthenticatedMarketData(
  status?: UpstoxTokenHealthStatus,
): boolean {
  return status !== "valid";
}
