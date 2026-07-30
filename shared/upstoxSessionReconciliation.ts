export interface BrokerSessionCandidate {
  baseSessionToken: string;
  brokerUserId: string;
  hasOpenTrade: boolean;
  isDurableUserSession: boolean;
  latestUpdatedAtMs: number;
}

/**
 * Return one canonical base session for each authenticated Upstox account.
 *
 * Priority is deliberately safety-first:
 * 1. preserve the session that is already protecting an open trade;
 * 2. otherwise prefer the token linked to the durable app-user record;
 * 3. otherwise prefer the most recently updated persisted session;
 * 4. use the opaque base token only as a deterministic final tie-breaker.
 *
 * Sessions without a verified brokerUserId must never be grouped here.
 */
export function selectCanonicalBrokerSession(
  candidates: readonly BrokerSessionCandidate[],
): BrokerSessionCandidate | null {
  const eligible = candidates.filter(
    candidate => candidate.baseSessionToken.length > 0 && candidate.brokerUserId.length > 0,
  );
  if (eligible.length === 0) return null;

  return [...eligible].sort((left, right) => {
    if (left.hasOpenTrade !== right.hasOpenTrade) {
      return left.hasOpenTrade ? -1 : 1;
    }
    if (left.isDurableUserSession !== right.isDurableUserSession) {
      return left.isDurableUserSession ? -1 : 1;
    }
    if (left.latestUpdatedAtMs !== right.latestUpdatedAtMs) {
      return right.latestUpdatedAtMs - left.latestUpdatedAtMs;
    }
    return left.baseSessionToken.localeCompare(right.baseSessionToken);
  })[0];
}

export function getBaseBotSessionToken(sessionToken: string): string {
  return sessionToken.replace(/-slot\d+$/, "");
}
