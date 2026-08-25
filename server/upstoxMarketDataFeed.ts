import WebSocket from "ws";
import protobuf from "protobufjs";

const AUTHORIZE_URL = "https://api.upstox.com/v3/feed/market-data-feed/authorize";
const MAX_RECONNECT_ATTEMPTS = 8;
const BASE_RECONNECT_MS = 500;
const MAX_RECONNECT_MS = 30_000;
const DEFAULT_STALE_MS = 5_000;
const CONNECT_TIMEOUT_MS = 10_000;

const PROTO_SCHEMA = `
syntax = "proto3";
package com.upstox.marketdatafeederv3udapi.rpc.proto;
message LTPC { double ltp = 1; int64 ltt = 2; int64 ltq = 3; double cp = 4; }
message MarketLevel { repeated Quote bidAskQuote = 1; }
message Quote { int64 bidQ = 1; double bidP = 2; int64 askQ = 3; double askP = 4; }
message MarketOHLC { repeated OHLC ohlc = 1; }
message OHLC { string interval = 1; double open = 2; double high = 3; double low = 4; double close = 5; int64 vol = 6; int64 ts = 7; }
message OptionGreeks { double delta = 1; double theta = 2; double gamma = 3; double vega = 4; double rho = 5; }
message MarketFullFeed { LTPC ltpc = 1; MarketLevel marketLevel = 2; OptionGreeks optionGreeks = 3; MarketOHLC marketOHLC = 4; double atp = 5; int64 vtt = 6; double oi = 7; double iv = 8; double tbq = 9; double tsq = 10; }
message IndexFullFeed { LTPC ltpc = 1; MarketOHLC marketOHLC = 2; }
message FullFeed { oneof FullFeedUnion { MarketFullFeed marketFF = 1; IndexFullFeed indexFF = 2; } }
message FirstLevelWithGreeks { LTPC ltpc = 1; Quote firstDepth = 2; OptionGreeks optionGreeks = 3; int64 vtt = 4; double oi = 5; double iv = 6; }
message Feed { oneof FeedUnion { LTPC ltpc = 1; FullFeed fullFeed = 2; FirstLevelWithGreeks firstLevelWithGreeks = 3; } RequestMode requestMode = 4; }
enum RequestMode { ltpc = 0; full_d5 = 1; option_greeks = 2; full_d30 = 3; }
enum Type { initial_feed = 0; live_feed = 1; market_info = 2; }
enum MarketStatus { PRE_OPEN_START = 0; PRE_OPEN_END = 1; NORMAL_OPEN = 2; NORMAL_CLOSE = 3; CLOSING_START = 4; CLOSING_END = 5; }
message MarketInfo { map<string, MarketStatus> segmentStatus = 1; }
message FeedResponse { Type type = 1; map<string, Feed> feeds = 2; int64 currentTs = 3; MarketInfo marketInfo = 4; }
`;

const root = protobuf.parse(PROTO_SCHEMA).root;
const FeedResponse = root.lookupType("com.upstox.marketdatafeederv3udapi.rpc.proto.FeedResponse");

type FeedLike = {
  ltpc?: { ltp?: number; ltt?: number | string; ltq?: number | string; cp?: number };
  fullFeed?: { marketFF?: { ltpc?: FeedLike["ltpc"]; marketLevel?: { bidAskQuote?: Array<{ bidP?: number; askP?: number; bidQ?: number; askQ?: number }> } } };
  firstLevelWithGreeks?: { ltpc?: FeedLike["ltpc"]; firstDepth?: { bidP?: number; askP?: number; bidQ?: number; askQ?: number } };
};

export interface WsQuote {
  instrumentKey: string;
  ltp: number;
  bid: number;
  ask: number;
  bidQty: number;
  askQty: number;
  close: number;
  ltt: number;
  receivedAt: number;
}

export interface WsFeedStatus {
  state: "idle" | "authorizing" | "connecting" | "open" | "backoff" | "closed" | "error";
  subscribedKeys: number;
  quoteCount: number;
  lastMessageAt: number | null;
  lastQuoteAt: number | null;
  reconnectAttempts: number;
  lastError: string | null;
}

type FeedConnection = {
  accessToken: string;
  socket: WebSocket | null;
  keys: Set<string>;
  quotes: Map<string, WsQuote>;
  state: WsFeedStatus["state"];
  lastMessageAt: number | null;
  lastQuoteAt: number | null;
  reconnectAttempts: number;
  lastError: string | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  connectTimer: ReturnType<typeof setTimeout> | null;
  closedByUser: boolean;
  connectingPromise: Promise<void> | null;
};

const connections = new Map<string, FeedConnection>();

function tokenKey(accessToken: string): string {
  return accessToken.slice(0, 12);
}

function getConnection(accessToken: string): FeedConnection {
  let conn = connections.get(accessToken);
  if (!conn) {
    conn = {
      accessToken,
      socket: null,
      keys: new Set(),
      quotes: new Map(),
      state: "idle",
      lastMessageAt: null,
      lastQuoteAt: null,
      reconnectAttempts: 0,
      lastError: null,
      reconnectTimer: null,
      connectTimer: null,
      closedByUser: false,
      connectingPromise: null,
    };
    connections.set(accessToken, conn);
  }
  return conn;
}

async function authorize(accessToken: string): Promise<string> {
  const response = await fetch(AUTHORIZE_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const body = await response.json().catch(() => ({})) as { data?: { authorized_redirect_uri?: string }; errors?: unknown };
  const uri = body.data?.authorized_redirect_uri;
  if (!response.ok || !uri) throw new Error(`Upstox WebSocket authorization failed (${response.status})`);
  return uri;
}

function sendSubscription(conn: FeedConnection): void {
  if (!conn.socket || conn.socket.readyState !== WebSocket.OPEN || conn.keys.size === 0) return;
  const payload = {
    guid: `scalpbot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    method: "sub",
    data: { mode: "full", instrumentKeys: Array.from(conn.keys) },
  };
  // Upstox V3 requests are JSON encoded into a binary WebSocket frame.
  conn.socket.send(Buffer.from(JSON.stringify(payload), "utf8"));
}

function extractQuote(instrumentKey: string, feed: FeedLike, receivedAt: number): WsQuote | null {
  const nested = feed.fullFeed?.marketFF ?? feed.firstLevelWithGreeks;
  const ltpc = feed.ltpc ?? nested?.ltpc;
  if (!ltpc || !Number.isFinite(Number(ltpc.ltp)) || Number(ltpc.ltp) <= 0) return null;
  const depth = feed.fullFeed?.marketFF?.marketLevel?.bidAskQuote?.[0] ?? feed.firstLevelWithGreeks?.firstDepth;
  return {
    instrumentKey,
    ltp: Number(ltpc.ltp),
    bid: Number(depth?.bidP ?? 0),
    ask: Number(depth?.askP ?? 0),
    bidQty: Number(depth?.bidQ ?? 0),
    askQty: Number(depth?.askQ ?? 0),
    close: Number(ltpc.cp ?? 0),
    ltt: Number(ltpc.ltt ?? receivedAt),
    receivedAt,
  };
}

function processMessage(conn: FeedConnection, data: WebSocket.RawData): void {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
  const decoded = FeedResponse.decode(buffer) as unknown as { feeds?: Record<string, FeedLike>; currentTs?: number };
  const receivedAt = Date.now();
  conn.lastMessageAt = receivedAt;
  for (const [instrumentKey, feed] of Object.entries(decoded.feeds ?? {})) {
    const quote = extractQuote(instrumentKey, feed, receivedAt);
    if (quote) {
      conn.quotes.set(instrumentKey, quote);
      conn.lastQuoteAt = receivedAt;
    }
  }
}

function scheduleReconnect(conn: FeedConnection): void {
  if (conn.closedByUser || conn.reconnectTimer || conn.keys.size === 0) return;
  conn.state = "backoff";
  const attempt = Math.min(conn.reconnectAttempts, MAX_RECONNECT_ATTEMPTS);
  const delay = Math.min(MAX_RECONNECT_MS, BASE_RECONNECT_MS * 2 ** attempt);
  conn.reconnectAttempts += 1;
  conn.reconnectTimer = setTimeout(() => {
    conn.reconnectTimer = null;
    void connect(conn);
  }, delay);
}

async function connect(conn: FeedConnection): Promise<void> {
  if (conn.closedByUser || conn.keys.size === 0) return;
  if (conn.connectingPromise) return conn.connectingPromise;
  conn.connectingPromise = (async () => {
    conn.state = "authorizing";
    try {
      const uri = await authorize(conn.accessToken);
      conn.state = "connecting";
      await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(uri, { followRedirects: true, headers: { Authorization: `Bearer ${conn.accessToken}`, Accept: "*/*" } });
        conn.socket = socket;
        let settled = false;
        conn.connectTimer = setTimeout(() => {
          if (!settled) { settled = true; socket.terminate(); reject(new Error("WebSocket connect timeout")); }
        }, CONNECT_TIMEOUT_MS);
        socket.binaryType = "arraybuffer";
        socket.on("open", () => {
          if (conn.connectTimer) clearTimeout(conn.connectTimer);
          conn.connectTimer = null;
          settled = true;
          conn.state = "open";
          conn.reconnectAttempts = 0;
          conn.lastError = null;
          sendSubscription(conn);
          resolve();
        });
        socket.on("message", data => {
          try { processMessage(conn, data); }
          catch (error) { conn.lastError = error instanceof Error ? error.message : String(error); }
        });
        socket.on("error", error => {
          conn.lastError = error instanceof Error ? error.message : String(error);
          conn.state = "error";
          if (!settled) { settled = true; reject(error); }
        });
        socket.on("close", () => {
          conn.socket = null;
          if (conn.connectTimer) clearTimeout(conn.connectTimer);
          conn.connectTimer = null;
          if (!conn.closedByUser) scheduleReconnect(conn);
          else conn.state = "closed";
        });
      });
    } catch (error) {
      conn.lastError = error instanceof Error ? error.message : String(error);
      conn.state = "error";
      scheduleReconnect(conn);
    } finally {
      conn.connectingPromise = null;
    }
  })();
  return conn.connectingPromise;
}

export async function ensureUpstoxMarketDataFeed(accessToken: string, instrumentKeys: string[]): Promise<void> {
  if (!accessToken || instrumentKeys.length === 0) return;
  const conn = getConnection(accessToken);
  conn.closedByUser = false;
  for (const key of instrumentKeys) if (key) conn.keys.add(key);
  await connect(conn);
  if (conn.state === "open") sendSubscription(conn);
}

export function getUpstoxWebSocketQuote(accessToken: string, instrumentKey: string, staleMs = DEFAULT_STALE_MS): WsQuote | null {
  const quote = connections.get(accessToken)?.quotes.get(instrumentKey) ?? null;
  if (!quote || Date.now() - quote.receivedAt > staleMs) return null;
  return quote;
}

export function getUpstoxWebSocketStatus(accessToken: string): WsFeedStatus {
  const conn = connections.get(accessToken);
  if (!conn) return { state: "idle", subscribedKeys: 0, quoteCount: 0, lastMessageAt: null, lastQuoteAt: null, reconnectAttempts: 0, lastError: null };
  return { state: conn.state, subscribedKeys: conn.keys.size, quoteCount: conn.quotes.size, lastMessageAt: conn.lastMessageAt, lastQuoteAt: conn.lastQuoteAt, reconnectAttempts: conn.reconnectAttempts, lastError: conn.lastError };
}

export function closeUpstoxMarketDataFeed(accessToken: string): void {
  const conn = connections.get(accessToken);
  if (!conn) return;
  conn.closedByUser = true;
  if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
  if (conn.connectTimer) clearTimeout(conn.connectTimer);
  conn.socket?.close();
  conn.socket = null;
  conn.state = "closed";
  connections.delete(accessToken);
}

export function closeAllUpstoxMarketDataFeeds(): void {
  for (const token of Array.from(connections.keys())) closeUpstoxMarketDataFeed(token);
}

export function resetUpstoxMarketDataFeedsForTests(): void {
  closeAllUpstoxMarketDataFeeds();
}

export const UPSTOX_WS_LIMITS = Object.freeze({ maxConnectionsPerUser: 2, maxLtpcKeys: 5000, maxFullKeys: 2000, maxCombinedFullKeys: 1500 });
export const UPSTOX_WS_DEFAULT_STALE_MS = DEFAULT_STALE_MS;
export const upstoxWebSocketModuleSource = "Upstox Market Data Feed V3: binary subscription + protobuf response";
