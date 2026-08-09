// Step 2: collect Trikal + RedBar signals over N days using the REAL strategy code
// Prereq: ./node_modules/.bin/esbuild server/botEngine.ts --bundle --platform=node --packages=external --format=cjs --outfile=/app/be.cjs
// Run:    cp scripts/sigCollect.js /tmp/g.cjs && node /tmp/g.cjs
const be = require("/app/be.cjs");

const INDEX = "NSE_INDEX|Nifty 50";
const FROM = "2026-07-13";
const TO   = "2026-08-07";

async function fetchRange() {
  const url = "https://api.upstox.com/v2/historical-candle/" +
    encodeURIComponent(INDEX) + "/1minute/" + TO + "/" + FROM;
  const j = await (await fetch(url, { headers: { Accept: "application/json" } })).json();
  if (!j.data) { console.log("API:", JSON.stringify(j).slice(0, 200)); return []; }
  return (j.data.candles || []).map(x => ({
    timestamp: new Date(x[0]).getTime(),
    open: x[1], high: x[2], low: x[3], close: x[4], volume: x[5],
  })).reverse();
}

function istDate(ts) {
  return new Date(ts + 330 * 60000).toISOString().slice(0, 10);
}

(async () => {
  console.log("fetching " + FROM + " to " + TO + " ...");
  const all = await fetchRange();
  console.log("total candles: " + all.length);
  if (!all.length) return;

  // group by IST trading day
  const byDay = {};
  for (const c of all) {
    const d = istDate(c.timestamp);
    (byDay[d] = byDay[d] || []).push(c);
  }
  const days = Object.keys(byDay).sort();
  console.log("trading days: " + days.length);
  console.log("");

  const tally = { Trikal: [], RedBar: [] };

  for (const day of days) {
    const cs = byDay[day];
    let lastTrikal = "", lastRedBar = "";
    for (let i = 30; i < cs.length; i++) {
      const win = cs.slice(Math.max(0, i - 399), i + 1);
      const hh = new Date(cs[i].timestamp + 330 * 60000);
      const tm = String(hh.getUTCHours()).padStart(2, "0") + ":" +
                 String(hh.getUTCMinutes()).padStart(2, "0");

      try {
        const t = be.generateSmartRenkoSignal(win, 1.5, 2.5);
        if (t.direction !== "HOLD") {
          const sig = t.direction + tm;
          if (sig !== lastTrikal) {
            tally.Trikal.push({ day, tm, dir: t.direction, conf: t.confidence, px: t.entryPrice });
            lastTrikal = sig;
          }
        }
      } catch (e) { /* skip */ }

      try {
        const r = be.generateRenkoSignal(win, 1.5, 3.0);
        if (r.direction !== "HOLD") {
          const sig = r.direction + tm;
          if (sig !== lastRedBar) {
            tally.RedBar.push({ day, tm, dir: r.direction, conf: r.confidence, px: r.entryPrice });
            lastRedBar = sig;
          }
        }
      } catch (e) { /* skip */ }
    }
  }

  for (const name of ["Trikal", "RedBar"]) {
    const s = tally[name];
    console.log("=== " + name + ": " + s.length + " signals over " + days.length + " days ===");
    for (const x of s.slice(0, 25)) {
      console.log("  " + x.day + "  " + x.tm + "  " + x.dir.padEnd(5) +
                  (x.conf * 100).toFixed(0) + "%  @" + x.px.toFixed(1));
    }
    if (s.length > 25) console.log("  ... " + (s.length - 25) + " more");
    const buys = s.filter(x => x.dir === "BUY").length;
    console.log("  BUY " + buys + " / SELL " + (s.length - buys) +
                "  | avg " + (s.length / days.length).toFixed(1) + " per day");
    console.log("");
  }
})().catch(e => console.log("ERR", e.message, e.stack ? e.stack.slice(0, 300) : ""));
