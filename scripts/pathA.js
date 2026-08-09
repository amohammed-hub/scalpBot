// Path A backtest: replay 07-Aug live trades under old vs new SL/TP
// Run:  node scripts/pathA.js
const zlib = require("zlib");
const TOK = process.env.UP_TOKEN || "";
const H = TOK
  ? { Accept: "application/json", Authorization: "Bearer " + TOK }
  : { Accept: "application/json" };

// [time, name, expiry, strike, side, entry, qty, actualPnl]
const TRADES = [
  ["11:51", "FINNIFTY",  "2026-08-25", 26600, "PE", 312.18, 120,  2939],
  ["11:51", "NIFTY",     "2026-08-11", 24600, "PE", 138.13, 130,  -549],
  ["11:52", "BANKNIFTY", "2026-08-25", 57800, "PE", 618.23,  60, -1919],
  ["12:14", "SENSEX",    "2026-08-13", 78600, "PE", 551.65,  40, -1106],
  ["12:35", "FINNIFTY",  "2026-08-25", 26500, "CE", 412.02, 120, -2571],
  ["13:09", "SENSEX",    "2026-08-13", 78400, "CE", 629.58,  40,  -481],
  ["13:26", "FINNIFTY",  "2026-08-25", 26500, "CE", 401.40, 120, -2658],
  ["13:52", "SENSEX",    "2026-08-13", 78500, "CE", 614.73,  40, -1355],
  ["14:08", "NIFTY",     "2026-08-11", 24600, "PE", 139.85, 130,  -111],
  ["14:32", "SENSEX",    "2026-08-13", 78500, "PE", 492.43,  40, -1045],
  ["15:01", "NIFTY",     "2026-08-11", 24600, "PE", 119.33, 130,  -822],
  ["15:03", "SENSEX",    "2026-08-13", 78500, "PE", 435.23,  40, -1259],
];

async function master(exch) {
  const url = `https://assets.upstox.com/market-quote/instruments/exchange/${exch}.json.gz`;
  const r = await fetch(url);
  return JSON.parse(zlib.gunzipSync(Buffer.from(await r.arrayBuffer())).toString());
}

function findKey(rows, name, expiry, strike, side) {
  for (const r of rows) {
    if ((r.instrument_type || "") !== side) continue;
    if ((r.asset_symbol || "").toUpperCase() !== name) continue;
    if (Number(r.strike_price) !== strike) continue;
    const e = r.expiry;
    if (!e) continue;
    const d = new Date(e > 1e12 ? e : e * 1000).toISOString().slice(0, 10);
    if (d === expiry) return r.instrument_key;
  }
  return null;
}

async function candles(key) {
  const url = `https://api.upstox.com/v2/historical-candle/${encodeURIComponent(key)}/1minute/2026-08-07/2026-08-07`;
  const r = await fetch(url, { headers: H });
  const j = await r.json();
  if (!j.data) {
    console.log("   API said:", JSON.stringify(j).slice(0, 200));
    return [];
  }
  return ((j.data.candles) || [])
    .map(x => ({ t: new Date(x[0]), h: x[2], l: x[3], c: x[4] }))
    .reverse();
}

function sim(cs, entryTime, entry, qty, slPct, tpPct, trailArm) {
  const [hh, mm] = entryTime.split(":").map(Number);
  const after = cs.filter(c => {
    const d = new Date(c.t.getTime() + 330 * 60000);
    return d.getUTCHours() * 60 + d.getUTCMinutes() >= hh * 60 + mm;
  });
  if (!after.length) return { r: "NODATA", p: 0 };
  let sl = entry * (1 - slPct);
  const tgt = entry * (1 + tpPct);
  let peak = entry;
  for (const c of after) {
    if (c.h > peak) peak = c.h;
    if (peak >= entry * 1.12 && sl < entry * 1.07) sl = entry * 1.07;
    else if (peak >= entry * (1 + trailArm) && sl < entry) sl = entry;
    if (c.l <= sl) return { r: sl >= entry ? "TRAIL" : "SL", p: (sl - entry) * qty };
    if (c.h >= tgt) return { r: "TGT", p: (tgt - entry) * qty };
  }
  return { r: "EOD", p: (after[after.length - 1].c - entry) * qty };
}

(async () => {
  console.log("loading instrument masters...");
  const NSE = await master("NSE");
  const BSE = await master("BSE");
  console.log("NSE " + NSE.length + " rows, BSE " + BSE.length + " rows");

  const cache = {};
  let oldNet = 0, newNet = 0, actNet = 0;
  const out = [];

  for (const [tm, nm, ex, st, sd, en, q, act] of TRADES) {
    const key = findKey(nm === "SENSEX" ? BSE : NSE, nm, ex, st, sd);
    const label = nm + " " + st + sd;
    if (!key) { out.push([tm, label, "KEYMISS", "", "", "", act]); continue; }
    if (!cache[key]) { console.log("fetching " + label); cache[key] = await candles(key); }
    const cs = cache[key];
    if (!cs.length) { out.push([tm, label, "NOCANDLE", "", "", "", act]); continue; }

    const A = sim(cs, tm, en, q, 0.05, 0.08, 0.05);
    const B = sim(cs, tm, en, q, 0.12, 0.18, 0.03);
    oldNet += A.p; newNet += B.p; actNet += act;
    out.push([tm, label, A.r, Math.round(A.p), B.r, Math.round(B.p), act]);
  }

  console.log("");
  console.log("time   contract           OLD 5/8       NEW 12/18     ACTUAL");
  for (const r of out) {
    console.log(
      String(r[0]).padEnd(7) + String(r[1]).padEnd(19) +
      (r[2] + " " + r[3]).padEnd(14) + (r[4] + " " + r[5]).padEnd(14) + r[6]
    );
  }
  console.log("");
  console.log("actual booked   : Rs " + Math.round(actNet));
  console.log("sim OLD  5%/8%  : Rs " + Math.round(oldNet) + "   <-- sanity check");
  console.log("sim NEW 12%/18% : Rs " + Math.round(newNet));
  console.log("difference      : Rs " + Math.round(newNet - oldNet));
})().catch(e => console.log("ERR", e.message));
