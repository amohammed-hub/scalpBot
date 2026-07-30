import { createHash } from "node:crypto";

export type BrokerSessionIdentitySource = "profile-user-id" | "credential-fingerprint";

export interface BrokerSessionIdentity {
  key: string;
  source: BrokerSessionIdentitySource;
}

const PROFILE_WRAPPER_KEYS = ["data", "result", "profile", "user", "payload"] as const;
const PROFILE_USER_ID_KEYS = ["user_id", "userId"] as const;
const MAX_PROFILE_WRAPPER_DEPTH = 4;

function normalizeBrokerUserId(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Extract Upstox's UCC from the documented profile response while tolerating
 * JSON-string and wrapper variations introduced by transports or proxies.
 */
export function extractUpstoxProfileUserId(payload: unknown): string | null {
  const queue: Array<{ value: unknown; depth: number }> = [{ value: payload, depth: 0 }];
  const visited = new Set<object>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth > MAX_PROFILE_WRAPPER_DEPTH || current.value == null) continue;

    if (typeof current.value === "string") {
      const trimmed = current.value.trim();
      if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) continue;
      try {
        queue.push({ value: JSON.parse(trimmed), depth: current.depth + 1 });
      } catch {
        // A non-JSON string is not a trustworthy broker identity.
      }
      continue;
    }

    if (typeof current.value !== "object") continue;
    if (visited.has(current.value)) continue;
    visited.add(current.value);

    const record = current.value as Record<string, unknown>;
    for (const key of PROFILE_USER_ID_KEYS) {
      const userId = normalizeBrokerUserId(record[key]);
      if (userId) return userId;
    }

    for (const key of PROFILE_WRAPPER_KEYS) {
      if (record[key] != null) {
        queue.push({ value: record[key], depth: current.depth + 1 });
      }
    }
  }

  return null;
}

/**
 * Build a non-secret startup grouping key. The official broker UCC is primary;
 * an exact credential fingerprint is a deterministic fallback when Upstox has
 * accepted the token but its 2xx profile payload has no usable user_id.
 */
export function deriveBrokerSessionIdentity(
  profilePayload: unknown,
  accessToken: string | null | undefined,
): BrokerSessionIdentity | null {
  const brokerUserId = extractUpstoxProfileUserId(profilePayload);
  if (brokerUserId) {
    return {
      key: `profile-user-id:${brokerUserId}`,
      source: "profile-user-id",
    };
  }

  const normalizedToken = accessToken?.trim();
  if (!normalizedToken) return null;

  return {
    key: `credential-sha256:${createHash("sha256").update(normalizedToken).digest("hex")}`,
    source: "credential-fingerprint",
  };
}
