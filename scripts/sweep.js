// SL/TP sweep: is 5%/8% stable or a fluke?
// Run:  cp scripts/sweep.js /tmp/s.cjs && node /tmp/s.cjs
const zlib = require("zlib");
const H = { Accept: "application/json" };

const TRADES = [
  ["11:51", "FINNIFTY",  "2026-08-25", 26600, "PE", 312.18, 120],
  ["11:51", "NIFTY",     "2026-08-11", 24600, "PE", 138.13, 130],
  ["11:52", "BANKNIFTY", "2026-08-25", 57800, "PE", 618.23,  60],
  ["12:14", "SENSEX",    "2026-08-13", 78600, "PE", 551.65,  40],
  ["12:35", "FINNIFTY",  "2026-08-25", 26500, "CE", 412.02, 120],
  ["13:09", "SENSEX",    "2026-08-13", 78400, "CE", 629.58,  40],
  ["13:26", "FINNIFTY",  "2026-08-25", 26500, "CE", 401.40, 120],
  ["13:52", "SENSEX",    "2026-08-13", 78500, "CE", 614.73,  40],
  ["14:08", "NIFTY",     "2026-08-11", 24600, "PE", 139.85, 130],
  ["14:32", "SENSEX",    "2026-08-13", 78500, "PE", 492.43,  40],
  ["15:01", "NIFTY",     "2026-08-11", 24600, "PE", 119.33, 130],
  ["15:03", "SENSEX",    "2026-08-13", 78500, "PE", 435.23,  40],
];

// [SL%, TP%, trailArm%]
const CONFIGS = [
  [0.03, 0.05, 0.03],
  [0.04, 0.07, 0.03],
  [0.05, 0.08, 0.05],   // <-- current live config
  [0.05, 0.08, 0.03],
  [0.06, 0.10, 0.03],
  [0.07, 0.12, 0.03],
  [0.08, 0.14, 0.03],
  [0.10, 0.15, 0.03],
];

async function master(exch) {
  const r = await fetch(`https://assets.upstox.com/market-quote/instruments/exchange/${exch}.json.gz`);
  return JSON.parse(zlib.gunzipSync(Buffer.from(await r.arrayBuffer())).toString());
}

function findKey(rows, name, expiry, strike, side) {
  for (const r of rows) {
    if ((r.instrument_type || "") !== side) continue;
    if ((r.asset_symbol || "").toUpperCase() !== name) continue;
    if (Number(r.strike_price) !== strike) continue;
    const e = r.expiry;
    if (!e) continue;
    if (new Date(e > 1e12 ? e : e * 1000).toISOString().slice(0, 10) === expiry) return r.instrument_key;
  }
  return null;
}

async function candles(key) {
  const url = `https://api.upstox.com/v2/historical-candle/${encodeURIComponent(key)}/1minute/2026-08-07/2026-08-07`;
  const j = await (await fetch(url, { headers: H })).json();
  if (!j.data) return [];
  return (j.data.candles || [])
    .map(x => ({ t: new Date(x[0]), h: x[2], l: x[3], c: x[4] }))
    .reverse();
}

function sim(cs, tm, entry, qty, slPct, tpPct, arm) {
  const [hh, mm] = tm.split(":").map(Number);
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
    else if (peak >= entry * (1 + arm) && sl < entry) sl = entry;
    if (c.l <= sl) return { r: sl >= entry ? "TRAIL" : "SL", p: (sl - entry) * qty };
    if (c.h >= tgt) return { r: "TGT", p: (tgt - entry) * qty };
  }
  return { r: "EOD", p: (after[after.length - 1].c - entry) * qty };
}

(async () => {
  console.log("loading masters...");
  const NSE = await master("NSE"), BSE = await master("BSE");
  const data = [];
  for (const [tm, nm, ex, st, sd, en, q] of TRADES) {
    const key = findKey(nm === "SENSEX" ? BSE : NSE, nm, ex, st, sd);
    if (!key) { console.log("keymiss " + nm + st + sd); continue; }
    console.log("fetching " + nm + " " + st + sd);
    const cs = await candles(key);
    if (!cs.length) { console.log("  no candles"); continue; }
    data.push({ tm, en, q, cs });
  }

  console.log("");
  console.log(" SL%   TP%  arm%    net P&L   wins  SL  TRAIL  TGT  EOD");
  const results = [];
  for (const [slPct, tpPct, arm] of CONFIGS) {
    let net = 0, wins = 0;
    const cnt = { SL: 0, TRAIL: 0, TGT: 0, EOD: 0, NODATA: 0 };
    for (const d of data) {
      const r = sim(d.cs, d.tm, d.en, d.q, slPct, tpPct, arm);
      net += r.p;
      if (r.p > 0) wins++;
      cnt[r.r] = (cnt[r.r] || 0) + 1;
    }
    results.push([slPct, tpPct, arm, net]);
    const mark = (slPct === 0.05 && tpPct === 0.08 && arm === 0.05) ? "  <== LIVE" : "";
    console.log(
      String((slPct * 100).toFixed(0)).padStart(4) +
      String((tpPct * 100).toFixed(0)).padStart(6) +
      String((arm * 100).toFixed(0)).padStart(6) +
      String(Math.round(net)).padStart(11) +
      String(wins).padStart(7) +
      String(cnt.SL).padStart(4) +
      String(cnt.TRAIL).padStart(7) +
      String(cnt.TGT).padStart(5) +
      String(cnt.EOD).padStart(5) + mark
    );
  }

  results.sort((a, b) => b[3] - a[3]);
  console.log("");
  console.log("best  : SL " + (results[0][0]*100).toFixed(0) + "% TP " + (results[0][1]*100).toFixed(0) + "% arm " + (results[0][2]*100).toFixed(0) + "%  =>  Rs " + Math.round(results[0][3]));
  console.log("worst : SL " + (results[results.length-1][0]*100).toFixed(0) + "% TP " + (results[results.length-1][1]*100).toFixed(0) + "%  =>  Rs " + Math.round(results[results.length-1][3]));
  console.log("spread: Rs " + Math.round(results[0][3] - results[results.length-1][3]));
})().catch(e => console.log("ERR", e.message));
