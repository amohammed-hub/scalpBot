export const KILL_SWITCH_LAST_ERROR = "Kill Switch activated";

export type RestartableSessionSnapshot = {
  status?: string | null;
  lastError?: string | null;
};

export function getBaseSessionToken(sessionToken: string): string {
  return sessionToken.replace(/-slot\d+$/, "");
}

export function hasKillSwitchMarker(lastError?: string | null): boolean {
  return typeof lastError === "string" && lastError.toLowerCase().includes("kill switch");
}

/**
 * Automatic recovery is allowed only for an explicitly running session that
 * has not been stopped by the emergency kill switch. Explicit user start and
 * resume paths clear lastError before making the row running again.
 */
export function canAutoRestartSession(session: RestartableSessionSnapshot): boolean {
  return session.status === "running" && !hasKillSwitchMarker(session.lastError);
}

export type DurableSessionRowIdentity = {
  id: number;
  sessionToken: string;
  updatedAt?: Date | string | number | null;
  createdAt?: Date | string | number | null;
};

function timestampMs(value: Date | string | number | null | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * Keep one durable configuration row for each exact logical bot token.
 * The most recently updated row wins; the primary key is a deterministic
 * final tie-breaker. This selector never groups different tenant tokens or
 * different slot suffixes.
 */
export function partitionCanonicalSessionRows<T extends DurableSessionRowIdentity>(
  rows: readonly T[],
): { canonicalRows: T[]; duplicateRows: T[] } {
  const byToken = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.sessionToken) continue;
    const group = byToken.get(row.sessionToken) ?? [];
    group.push(row);
    byToken.set(row.sessionToken, group);
  }

  const canonicalRows: T[] = [];
  const duplicateRows: T[] = [];
  for (const group of Array.from(byToken.values())) {
    const sorted = [...group].sort((left, right) => {
      const updatedDelta = timestampMs(right.updatedAt) - timestampMs(left.updatedAt);
      if (updatedDelta !== 0) return updatedDelta;
      const createdDelta = timestampMs(right.createdAt) - timestampMs(left.createdAt);
      if (createdDelta !== 0) return createdDelta;
      return right.id - left.id;
    });
    canonicalRows.push(sorted[0]);
    duplicateRows.push(...sorted.slice(1));
  }

  canonicalRows.sort((left, right) => left.sessionToken.localeCompare(right.sessionToken));
  duplicateRows.sort((left, right) => left.sessionToken.localeCompare(right.sessionToken) || left.id - right.id);
  return { canonicalRows, duplicateRows };
}
