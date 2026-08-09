// ADX test: what was the market regime at each 07-Aug entry?
const TOKENS = {
  NIFTY:     "NSE_INDEX|Nifty 50",
  BANKNIFTY: "NSE_INDEX|Nifty Bank",
  FINNIFTY:  "NSE_INDEX|Nifty Fin Service",
  SENSEX:    "BSE_INDEX|SENSEX",
};

const TRADES = [
  ["11:51", "FINNIFTY",   2939],
  ["11:51", "NIFTY",      -549],
  ["11:52", "BANKNIFTY", -1919],
  ["12:14", "SENSEX",    -1106],
  ["12:35", "FINNIFTY",  -2571],
  ["13:09", "SENSEX",     -481],
  ["13:26", "FINNIFTY",  -2658],
  ["13:52", "SENSEX",    -1355],
  ["14:08", "NIFTY",      -111],
  ["14:32", "SENSEX",    -1045],
  ["15:01", "NIFTY",      -822],
  ["15:03", "SENSEX",    -1259],
];

// exact copy of calcADX from botEngine.ts
function calcADX(candles, period = 14) {
  if (candles.length < period * 2) return 0;
  const slice = candles.slice(-(period * 2));
  let plusDM = 0, minusDM = 0, tr = 0;
  for (let i = 1; i < slice.length; i++) {
    const curr = slice[i], prev = slice[i - 1];
    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;
    if (upMove > downMove && upMove > 0) plusDM += upMove;
    if (downMove > upMove && downMove > 0) minusDM += downMove;
    tr += Math.max(curr.high - curr.low,
                   Math.abs(curr.high - prev.close),
                   Math.abs(curr.low - prev.close));
  }
  if (tr === 0) return 0;
  const dip = (plusDM / tr) * 100;
  const dim = (minusDM / tr) * 100;
  return dip + dim === 0 ? 0 : (Math.abs(dip - dim) / (dip + dim)) * 100;
}

async function candles(token) {
  const url = "https://api.upstox.com/v2/historical-candle/" +
    encodeURIComponent(token) + "/1minute/2026-08-07/2026-08-07";
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  const j = await r.json();
  if (!j.data) { console.log("  API:", JSON.stringify(j).slice(0, 150)); return []; }
  return (j.data.candles || [])
        .map(x => ({ t: new Date(x[0]), high: x[2], low: x[3], close: x[4] }))
    .reverse();
}

(async () => {
  const cache = {};
  const rows = [];
  for (const [tm, nm, pnl] of TRADES) {
    const tok = TOKENS[nm];
    if (!cache[tok]) { console.log("fetching " + nm); cache[tok] = await candles(tok); }
    const cs = cache[tok];
    if (!cs.length) { rows.push([tm, nm, "NODATA", "", pnl]); continue; }
    const [hh, mm] = tm.split(":").map(Number);
    const upTo = cs.filter(c => {
      const d = new Date(c.t.getTime() + 330 * 60000);
      return d.getUTCHours() * 60 + d.getUTCMinutes() <= hh * 60 + mm;
    });
    const adx = calcADX(upTo, 14);
    const regime = adx > 28 ? "TRENDING" : adx < 22 ? "CHOPPY" : "DEADBAND";
    rows.push([tm, nm, adx.toFixed(1), regime, pnl]);
  }

  console.log("");
  console.log("time   index      ADX    regime      P&L");
  for (const r of rows) {
    console.log(String(r[0]).padEnd(7) + String(r[1]).padEnd(11) +
                String(r[2]).padEnd(7) + String(r[3]).padEnd(12) + r[4]);
  }

  const choppy = rows.filter(r => r[3] === "CHOPPY");
  const dead   = rows.filter(r => r[3] === "DEADBAND");
  const trend  = rows.filter(r => r[3] === "TRENDING");
  const sum = a => a.reduce((s, r) => s + r[4], 0);
  console.log("");
  console.log("CHOPPY   entries: " + choppy.length + "  P&L Rs " + sum(choppy));
  console.log("DEADBAND entries: " + dead.length   + "  P&L Rs " + sum(dead));
  console.log("TRENDING entries: " + trend.length  + "  P&L Rs " + sum(trend));
})().catch(e => console.log("ERR", e.message));
