// MCX Instrument Registry — pre-filled Upstox instrument tokens, lot sizes, tick values
// Used in Settings MCX quick-launch and Hero Zero scanner
//
// IMPORTANT: MCX futures are monthly contracts. The instrument token format is MCX_FO|<SYMBOL><EXPIRY>
// e.g., MCX_FO|GOLDM24AUGFUT for Gold Mini August 2024 expiry.
// The tokens below use the generic MCX_FO|SYMBOL format as a base — you MUST verify the
// active near-month contract from the Upstox instrument master CSV (downloadable from
// https://assets.upstox.com/market-quote/instruments/exchange/NSE.csv.gz for NSE and
// https://assets.upstox.com/market-quote/instruments/exchange/MCX.csv.gz for MCX).
// Replace instrumentToken with the exact key for the current front-month contract.

export interface MCXInstrument {
  label: string;
  symbol: string;
  instrumentToken: string; // Upstox instrument key format: MCX_FO|<symbol>
  lotSize: number;         // Number of units per lot
  tickSize: number;        // Minimum price movement (₹)
  tickValue: number;       // ₹ value per tick per lot
  margin: number;          // Approximate margin per lot (₹)
  bestTimes: string;       // Best trading windows (IST)
  category: "metal" | "energy" | "agri";
}

export const MCX_INSTRUMENTS: MCXInstrument[] = [
  {
    label: "Gold Mini",
    symbol: "GOLDM",
    instrumentToken: "MCX_FO|GOLDM",
    lotSize: 10,       // 10 grams
    tickSize: 1,       // ₹1 per gram
    tickValue: 10,     // ₹10 per tick
    margin: 15000,     // ~₹15,000 per lot
    bestTimes: "9:00–11:30 AM, 7:30–9:30 PM",
    category: "metal",
  },
  {
    label: "Gold",
    symbol: "GOLD",
    instrumentToken: "MCX_FO|GOLD",
    lotSize: 100,      // 100 grams
    tickSize: 1,
    tickValue: 100,    // ₹100 per tick
    margin: 150000,
    bestTimes: "9:00–11:30 AM, 7:30–9:30 PM",
    category: "metal",
  },
  {
    label: "Silver Mini",
    symbol: "SILVERM",
    instrumentToken: "MCX_FO|SILVERM",
    lotSize: 5000,     // 5 kg (5000 grams)
    tickSize: 1,
    tickValue: 5000,   // ₹5,000 per ₹1 move
    margin: 20000,
    bestTimes: "9:00–11:30 AM, 7:30–9:30 PM",
    category: "metal",
  },
  {
    label: "Silver",
    symbol: "SILVER",
    instrumentToken: "MCX_FO|SILVER",
    lotSize: 30000,    // 30 kg
    tickSize: 1,
    tickValue: 30000,
    margin: 120000,
    bestTimes: "9:00–11:30 AM, 7:30–9:30 PM",
    category: "metal",
  },
  {
    label: "Crude Oil",
    symbol: "CRUDEOIL",
    instrumentToken: "MCX_FO|CRUDEOIL",
    lotSize: 100,      // 100 barrels
    tickSize: 1,       // ₹1 per barrel
    tickValue: 100,    // ₹100 per tick
    margin: 50000,
    bestTimes: "7:30–9:30 PM (US Open), Wed 8:00 PM (EIA)",
    category: "energy",
  },
  {
    label: "Crude Oil Mini",
    symbol: "CRUDEOILM",
    instrumentToken: "MCX_FO|CRUDEOILM",
    lotSize: 10,       // 10 barrels
    tickSize: 1,
    tickValue: 10,
    margin: 5000,
    bestTimes: "7:30–9:30 PM (US Open), Wed 8:00 PM (EIA)",
    category: "energy",
  },
  {
    label: "Natural Gas",
    symbol: "NATURALGAS",
    instrumentToken: "MCX_FO|NATURALGAS",
    lotSize: 1250,     // 1250 mmBtu
    tickSize: 0.10,
    tickValue: 125,    // ₹125 per tick
    margin: 25000,
    bestTimes: "7:30–9:30 PM, Thu 8:30 PM (EIA NatGas)",
    category: "energy",
  },
  {
    label: "Copper Mini",
    symbol: "COPPERM",
    instrumentToken: "MCX_FO|COPPERM",
    lotSize: 1000,     // 1000 kg
    tickSize: 0.05,
    tickValue: 50,
    margin: 18000,
    bestTimes: "9:00–11:30 AM, 7:30–9:30 PM",
    category: "metal",
  },
  {
    label: "Aluminium Mini",
    symbol: "ALUMINIUMM",
    instrumentToken: "MCX_FO|ALUMINIUMM",
    lotSize: 1000,
    tickSize: 0.05,
    tickValue: 50,
    margin: 8000,
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
