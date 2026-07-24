# MCX Trade Blocking Investigation — July 24, 2026

## Root Cause Analysis

### Finding 1: Gold (Bot 2) — WRONG underlying token
- Bot uses `MCX_FO|552720` (GOLDGUINEA FUT 31 JUL 26) as the underlying token
- Gold options have underlying_keys: MCX_FO|495213, MCX_FO|555922, MCX_FO|563946, etc.
- **NONE match MCX_FO|552720 directly**
- However, the NAME-BASED FALLBACK should work because MCX_FO|552720 has name="GOLD" and Gold options also have name="GOLD"
- The fallback fetches the real underlying price from the options' underlying_key
- **Conclusion**: Gold option resolution should work via name-based fallback. If it's failing, it's likely due to API errors or the price scale mismatch between GOLDGUINEA (1 gram) and GOLD options (100 grams)

### Finding 2: Copper (Bot 3) and Natural Gas (Bot 4) — Options expire TODAY
- Copper options: underlying_key MCX_FO|562048 MATCHES bot token. 158 live options. **Nearest expiry: TODAY Jul 24 at 6:30 PM IST**
- NatGas options: underlying_key MCX_FO|538685 MATCHES bot token. 182 live options. **Nearest expiry: TODAY Jul 24 at 6:30 PM IST**
- Crude Oil options: underlying_key MCX_FO|560977 MATCHES bot token. 410 live options. Nearest expiry: Aug 17
- **Conclusion**: Copper and NatGas option resolution should work (tokens match, options haven't expired yet at 3:17 PM)

### Finding 3: Cooldown gates blocking execution (MOST LIKELY CAUSE)
The signal is displayed at line 5372 (state.lastSignal = signal) BEFORE the following gates:
1. Layer filter (line 5378) — unlikely, TrikalStrategy is enabled for MCX
2. ADX filter (line 5397) — only for BankNifty
3. Anti-chasing gate (line 5430) — blocks if 3 consecutive same-direction candles moved >1% for MCX
4. P2 underlying cooldown (line 5460) — 15 min block after 2+ consecutive SLs
5. P1 direction cooldown (line 5488) — 3-10 min block after SL in same direction
6. Same-direction loss-streak (line 5528) — 30 min block after 2 consecutive losses in same direction
7. VRP/OI gate (line 5546) — VRP skipped for MCX, OI only adjusts confidence
8. Direction lock (line 5625) — confirmed NOT blocking MCX (not in CORRELATED_SYMBOLS)
9. Option resolution (line 5684) — if it fails, trade is skipped

### Finding 4: MCX instruments have `disabled: true` in mcxInstruments.ts
- Gold, Silver, NatGas, Copper all have `disabled: true`
- This ONLY blocks NEW bot starts (checked in routers.ts bot.start procedure)
- Running bots are NOT affected by this flag
- The bots ARE running (green dot in screenshot) so this is not the issue

### Finding 5: Bot status from screenshot (3:17 PM IST, Jul 24)
- Bot 1 (Crude Oil): HOLD signal, 4 trades, +₹23,739 — working correctly
- Bot 2 (Gold): BUY signal from Trikal Strategy, 6 trades, +₹6,228 — signal generated but not executed
- Bot 3 (Copper): SELL signal from Trikal Strategy, 6 trades, +₹79 — signal generated but not executed
- Bot 4 (Natural Gas): SELL signal from Trend layer, 5 trades, ₹-544 — signal generated but not executed

## Most Likely Root Cause

The bots have made 4-6 trades today. After hitting SLs (especially NatGas with -₹544), the cooldown gates are blocking new entries:
- P2 underlying cooldown: 15 min after 2+ consecutive SLs
- Same-direction loss-streak: 30 min after 2 consecutive losses in same direction
- Anti-chasing gate: blocks if 3 consecutive candles moved >1% in signal direction

These are TEMPORARY blocks that expire. The user is seeing the bots during a cooldown period.

## Potential Fixes

1. **Show blocked reason in dashboard** — Currently the dashboard shows the signal but doesn't clearly show WHY the trade wasn't executed. Add a "blocked by" indicator.
2. **Reduce MCX cooldowns** — MCX commodities trend strongly. The anti-chasing gate (1% threshold) and direction cooldowns may be too aggressive for MCX.
3. **Add "Force Trade" button** — Allow user to override cooldowns manually.
4. **Fix Gold underlying token** — Update from MCX_FO|552720 (GOLDGUINEA) to a proper GOLD futures token that matches option underlying_keys.

## Key Code Locations
- Signal display: line 5372 `state.lastSignal = signal`
- Anti-chasing gate: line 5430-5455
- P2 underlying cooldown: line 5460-5480
- P1 direction cooldown: line 5488-5520
- Same-direction loss-streak: line 5528-5535
- VRP/OI gate: line 5546-5620
- Option resolution: line 5684-5810
- MCX option resolution function: line 3607-3820
