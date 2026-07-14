// MCX Instrument Registry — verified Upstox instrument tokens (numeric IDs, July 2026 front-month)
// Tokens verified against https://assets.upstox.com/market-quote/instruments/exchange/MCX.json.gz
// on 2026-07-10. These are NUMERIC instrument keys (e.g. MCX_FO|520702) — NOT text-based symbols.
//
// ⚠️  MCX futures are monthly contracts. Tokens change every month when contracts roll over.
// The resolveMcxFrontMonthToken() function in botEngine.ts auto-resolves the current front-month
// token at runtime using the Upstox instrument master, so the bot always uses the correct contract.
// The tokens below are used as fallbacks when the API is unavailable.

export interface MCXInstrument {
  label: string;
  symbol: string;           // Internal symbol used for matching (e.g. "CRUDEOIL")
  instrumentToken: string;  // Current front-month Upstox instrument key (numeric ID)
  upstoxName: string;       // Exact name in Upstox instrument master for auto-resolution
  lotSize: number;          // Number of units per lot
  tickSize: number;         // Minimum price movement (₹)
  tickValue: number;        // ₹ value per tick per lot
  margin: number;           // Approximate margin per lot (₹)
  bestTimes: string;        // Best trading windows (IST)
  category: "metal" | "energy" | "agri";
}

export const MCX_INSTRUMENTS: MCXInstrument[] = [
  {
    label: "Gold",
    symbol: "GOLD",
    instrumentToken: "MCX_FO|552720",   // GOLD front-month Jul 2026
    upstoxName: "GOLD",
    lotSize: 100,      // 100 grams
    tickSize: 1,
    tickValue: 100,    // ₹100 per tick
    margin: 150000,
    bestTimes: "9:00–11:30 AM, 7:30–9:30 PM",
    category: "metal",
  },
  {
    label: "Silver",
    symbol: "SILVER",
    instrumentToken: "MCX_FO|471725",   // SILVER FUT (per KG, has options chain)
    upstoxName: "SILVER",
    lotSize: 30,       // 30 kg per lot
    tickSize: 1,
    tickValue: 30,     // ₹1 × 30 kg = ₹30 per tick
    margin: 120000,
    bestTimes: "9:00–11:30 AM, 7:30–9:30 PM",
    category: "metal",
  },
  {
    label: "Crude Oil",
    symbol: "CRUDEOIL",
    instrumentToken: "MCX_FO|520702",   // CRUDE OIL front-month Jul 2026
    upstoxName: "CRUDE OIL",
    lotSize: 100,      // 100 barrels
    tickSize: 1,       // ₹1 per barrel
    tickValue: 100,    // ₹100 per tick
    margin: 50000,
    bestTimes: "7:30–9:30 PM (US Open), Wed 8:00 PM (EIA)",
    category: "energy",
  },
  {
    label: "Natural Gas",
    symbol: "NATURALGAS",
    instrumentToken: "MCX_FO|538685",   // NATURALGAS front-month Jul 2026
    upstoxName: "NATURALGAS",
    lotSize: 1250,     // 1250 mmBtu
    tickSize: 0.10,
    tickValue: 125,    // ₹125 per tick
    margin: 25000,
    bestTimes: "7:30–9:30 PM, Thu 8:30 PM (EIA NatGas)",
    category: "energy",
  },
  {
    label: "Copper",
    symbol: "COPPER",
    instrumentToken: "MCX_FO|562048",   // COPPER front-month Jul 2026
    upstoxName: "COPPER",
    lotSize: 2500,     // 2500 kg
    tickSize: 0.05,
    tickValue: 125,
    margin: 50000,
    bestTimes: "9:00–11:30 AM, 7:30–9:30 PM",
    category: "metal",
  },
  {
    label: "Zinc",
    symbol: "ZINC",
    instrumentToken: "MCX_FO|562053",   // ZINC front-month Jul 2026
    upstoxName: "ZINC",
    lotSize: 5000,     // 5000 kg
    tickSize: 0.05,
    tickValue: 250,
    margin: 30000,
    bestTimes: "9:00–11:30 AM, 7:30–9:30 PM",
    category: "metal",
  },
  {
    label: "Aluminium",
    symbol: "ALUMINIUM",
    instrumentToken: "MCX_FO|562046",   // ALUMINIUM front-month Jul 2026
    upstoxName: "ALUMINIUM",
    lotSize: 5000,     // 5000 kg
    tickSize: 0.05,
    tickValue: 250,
    margin: 20000,
    bestTimes: "9:00–11:30 AM",
    category: "metal",
  },
];

export const MCX_CATEGORIES = [
  { value: "all", label: "All" },
  { value: "metal", label: "Metals" },
  { value: "energy", label: "Energy" },
  { value: "agri", label: "Agri" },
] as const;

export function getMCXInstrument(symbol: string): MCXInstrument | undefined {
  return MCX_INSTRUMENTS.find(i => i.symbol === symbol);
}

export function getMCXByCategory(category: string): MCXInstrument[] {
  if (category === "all") return MCX_INSTRUMENTS;
  return MCX_INSTRUMENTS.filter(i => i.category === category);
}
