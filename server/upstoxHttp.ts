import axios, {
  type AxiosRequestConfig,
  type AxiosResponse,
  type Method,
} from "axios";
import { isIP } from "node:net";
import { HttpsProxyAgent } from "https-proxy-agent";

export const UPSTOX_EGRESS_ENV = {
  mode: "UPSTOX_EGRESS_MODE",
  proxyUrl: "UPSTOX_EGRESS_PROXY_URL",
  allowedIps: "UPSTOX_EGRESS_ALLOWED_IPS",
  checkUrl: "UPSTOX_EGRESS_CHECK_URL",
  verifyTtlMs: "UPSTOX_EGRESS_VERIFY_TTL_MS",
  algoName: "UPSTOX_ALGO_NAME",
} as const;

const DEFAULT_CHECK_URL = "https://api.ipify.org?format=json";
const DEFAULT_VERIFY_TTL_MS = 60_000;
const MIN_VERIFY_TTL_MS = 5_000;
const MAX_VERIFY_TTL_MS = 600_000;

type UpstoxEgressMode = "direct" | "managed-proxy";

interface UpstoxEgressConfig {
  mode: UpstoxEgressMode;
  proxyUrl: string | null;
  allowedIps: string[];
  checkUrl: string;
  verifyTtlMs: number;
  algoName: string | null;
  cacheKey: string;
}

export interface UpstoxEgressStatus {
  mode: UpstoxEgressMode;
  managedProxyConfigured: boolean;
  proxyHost: string | null;
  allowedIps: string[];
  checkHost: string;
  algoNameConfigured: boolean;
  lastVerifiedIp: string | null;
  lastVerifiedAt: string | null;
}

export interface UpstoxEgressProbeResult {
  observedIp: string;
  verifiedAt: string;
  allowedIps: string[];
}

export interface UpstoxLiveOrderHeaders {
  "X-Algo-Name": string;
}

let cachedConfig: UpstoxEgressConfig | null = null;
let cachedClient: ReturnType<typeof axios.create> | null = null;
let lastVerifiedAtMs = 0;
let lastVerifiedIp: string | null = null;
let verificationInFlight: Promise<UpstoxEgressProbeResult> | null = null;

function parseMode(raw: string | undefined): UpstoxEgressMode {
  const value = (raw ?? "direct").trim().toLowerCase();
  if (value === "direct" || value === "managed-proxy") return value;
  throw new Error(
    `${UPSTOX_EGRESS_ENV.mode} must be either "direct" or "managed-proxy"`,
  );
}

function parseAllowedIps(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const ips = Array.from(new Set(raw.split(",").map(value => value.trim()).filter(Boolean)));
  for (const ip of ips) {
    if (isIP(ip) !== 4) {
      throw new Error(`${UPSTOX_EGRESS_ENV.allowedIps} contains a non-IPv4 value`);
    }
  }
  return ips;
}

function parseHttpsUrl(raw: string, envName: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${envName} must be a valid URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${envName} must use HTTPS`);
  }
  return parsed;
}

function parseProxyUrl(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const value = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${UPSTOX_EGRESS_ENV.proxyUrl} must be a valid proxy URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${UPSTOX_EGRESS_ENV.proxyUrl} must use HTTP or HTTPS`);
  }
  if (!parsed.hostname) {
    throw new Error(`${UPSTOX_EGRESS_ENV.proxyUrl} must include a hostname`);
  }
  return value;
}

function parseVerifyTtl(raw: string | undefined): number {
  if (!raw?.trim()) return DEFAULT_VERIFY_TTL_MS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_VERIFY_TTL_MS || value > MAX_VERIFY_TTL_MS) {
    throw new Error(
      `${UPSTOX_EGRESS_ENV.verifyTtlMs} must be an integer from ${MIN_VERIFY_TTL_MS} to ${MAX_VERIFY_TTL_MS}`,
    );
  }
  return value;
}

function parseAlgoName(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const value = raw.trim();
  if (/\r|\n/.test(value)) {
    throw new Error(`${UPSTOX_EGRESS_ENV.algoName} must not contain line breaks`);
  }
  return value;
}

function readConfig(): UpstoxEgressConfig {
  const rawMode = process.env[UPSTOX_EGRESS_ENV.mode];
  const rawProxyUrl = process.env[UPSTOX_EGRESS_ENV.proxyUrl];
  const rawAllowedIps = process.env[UPSTOX_EGRESS_ENV.allowedIps];
  const rawCheckUrl = process.env[UPSTOX_EGRESS_ENV.checkUrl];
  const rawVerifyTtl = process.env[UPSTOX_EGRESS_ENV.verifyTtlMs];
  const rawAlgoName = process.env[UPSTOX_EGRESS_ENV.algoName];
  const cacheKey = [rawMode, rawProxyUrl, rawAllowedIps, rawCheckUrl, rawVerifyTtl, rawAlgoName].join("\u0000");

  if (cachedConfig?.cacheKey === cacheKey) return cachedConfig;

  const mode = parseMode(rawMode);
  const proxyUrl = parseProxyUrl(rawProxyUrl);
  const allowedIps = parseAllowedIps(rawAllowedIps);
  const checkUrl = (rawCheckUrl?.trim() || DEFAULT_CHECK_URL);
  parseHttpsUrl(checkUrl, UPSTOX_EGRESS_ENV.checkUrl);

  if (mode === "managed-proxy") {
    if (!proxyUrl) {
      throw new Error(
        `${UPSTOX_EGRESS_ENV.proxyUrl} is required when ${UPSTOX_EGRESS_ENV.mode}=managed-proxy`,
      );
    }
    if (allowedIps.length !== 2) {
      throw new Error(
        `${UPSTOX_EGRESS_ENV.allowedIps} must contain exactly two IPv4 addresses for managed-proxy mode`,
      );
    }
  }

  cachedConfig = {
    mode,
    proxyUrl,
    allowedIps,
    checkUrl,
    verifyTtlMs: parseVerifyTtl(rawVerifyTtl),
    algoName: parseAlgoName(rawAlgoName),
    cacheKey,
  };
  cachedClient = null;
  lastVerifiedAtMs = 0;
  lastVerifiedIp = null;
  verificationInFlight = null;
  return cachedConfig;
}

function getClient() {
  const config = readConfig();
  if (cachedClient) return cachedClient;

  cachedClient = config.mode === "managed-proxy"
    ? axios.create({
        httpsAgent: new HttpsProxyAgent(config.proxyUrl!),
        proxy: false,
      })
    : axios.create({ proxy: false });

  return cachedClient;
}

function assertUpstoxUrl(input: string | URL): string {
  const url = input instanceof URL ? input : new URL(input);
  const host = url.hostname.toLowerCase();
  if (host !== "upstox.com" && !host.endsWith(".upstox.com")) {
    throw new Error(`Broker transport refused non-Upstox host: ${host}`);
  }
  if (url.protocol !== "https:") {
    throw new Error("Broker transport requires HTTPS");
  }
  return url.toString();
}

function requestHeadersToObject(headers: HeadersInit | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  const result: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function responseHeadersToHeaders(headers: AxiosResponse["headers"]): Headers {
  const result = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value == null || key.toLowerCase() === "set-cookie") continue;
    result.set(key, Array.isArray(value) ? value.join(", ") : String(value));
  }
  return result;
}

export const upstoxAxios = {
  get<T = any>(url: string | URL, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return getClient().get<T>(assertUpstoxUrl(url), config);
  },
  post<T = any, D = any>(
    url: string | URL,
    data?: D,
    config?: AxiosRequestConfig<D>,
  ): Promise<AxiosResponse<T>> {
    return getClient().post<T, AxiosResponse<T>, D>(assertUpstoxUrl(url), data, config);
  },
  put<T = any, D = any>(
    url: string | URL,
    data?: D,
    config?: AxiosRequestConfig<D>,
  ): Promise<AxiosResponse<T>> {
    return getClient().put<T, AxiosResponse<T>, D>(assertUpstoxUrl(url), data, config);
  },
  delete<T = any>(url: string | URL, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return getClient().delete<T>(assertUpstoxUrl(url), config);
  },
};

export async function upstoxFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase() as Method;
  const response = await getClient().request<string>({
    url: assertUpstoxUrl(input),
    method,
    headers: requestHeadersToObject(init.headers),
    data: init.body ?? undefined,
    signal: init.signal ?? undefined,
    responseType: "text",
    transformResponse: [value => value],
    validateStatus: () => true,
  });

  return new Response(response.data ?? null, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeadersToHeaders(response.headers),
  });
}

function extractIp(payload: unknown): string | null {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (isIP(trimmed) === 4) return trimmed;
    try {
      return extractIp(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["ip", "address", "origin"]) {
      const value = record[key];
      if (typeof value === "string" && isIP(value.trim()) === 4) return value.trim();
    }
  }
  return null;
}

async function performEgressProbe(): Promise<UpstoxEgressProbeResult> {
  const config = readConfig();
  if (config.mode !== "managed-proxy") {
    throw new Error(
      `Live Upstox orders are blocked until ${UPSTOX_EGRESS_ENV.mode}=managed-proxy`,
    );
  }

  const response = await getClient().get(config.checkUrl, {
    timeout: 8_000,
    responseType: "text",
    transformResponse: [value => value],
  });
  const observedIp = extractIp(response.data);
  if (!observedIp) {
    throw new Error("Managed-egress probe did not return a valid IPv4 address");
  }
  if (!config.allowedIps.includes(observedIp)) {
    throw new Error(
      `Managed-egress probe returned an unapproved address (${observedIp}); live orders remain blocked`,
    );
  }

  lastVerifiedAtMs = Date.now();
  lastVerifiedIp = observedIp;
  return {
    observedIp,
    verifiedAt: new Date(lastVerifiedAtMs).toISOString(),
    allowedIps: [...config.allowedIps],
  };
}

export async function verifyUpstoxManagedEgress(options: { force?: boolean } = {}): Promise<UpstoxEgressProbeResult> {
  const config = readConfig();
  const cacheFresh = lastVerifiedAtMs > 0 && Date.now() - lastVerifiedAtMs < config.verifyTtlMs;
  if (!options.force && cacheFresh && lastVerifiedIp) {
    return {
      observedIp: lastVerifiedIp,
      verifiedAt: new Date(lastVerifiedAtMs).toISOString(),
      allowedIps: [...config.allowedIps],
    };
  }

  if (!verificationInFlight) {
    verificationInFlight = performEgressProbe().finally(() => {
      verificationInFlight = null;
    });
  }
  return verificationInFlight;
}

export async function ensureUpstoxLiveOrderEgress(): Promise<UpstoxLiveOrderHeaders> {
  const config = readConfig();
  if (config.mode !== "managed-proxy") {
    throw new Error(
      `Live Upstox orders are blocked until ${UPSTOX_EGRESS_ENV.mode}=managed-proxy`,
    );
  }
  if (!config.algoName) {
    throw new Error(
      `Live Upstox orders are blocked until ${UPSTOX_EGRESS_ENV.algoName} matches the Algo Name configured in Upstox`,
    );
  }
  await verifyUpstoxManagedEgress();
  return { "X-Algo-Name": config.algoName };
}

export function getUpstoxEgressStatus(): UpstoxEgressStatus {
  const config = readConfig();
  const proxyHost = config.proxyUrl ? new URL(config.proxyUrl).host : null;
  return {
    mode: config.mode,
    managedProxyConfigured: config.mode === "managed-proxy" && Boolean(config.proxyUrl),
    proxyHost,
    allowedIps: [...config.allowedIps],
    checkHost: new URL(config.checkUrl).hostname,
    algoNameConfigured: Boolean(config.algoName),
    lastVerifiedIp,
    lastVerifiedAt: lastVerifiedAtMs ? new Date(lastVerifiedAtMs).toISOString() : null,
  };
}

export function resetUpstoxHttpForTests(): void {
  cachedConfig = null;
  cachedClient = null;
  lastVerifiedAtMs = 0;
  lastVerifiedIp = null;
  verificationInFlight = null;
}
