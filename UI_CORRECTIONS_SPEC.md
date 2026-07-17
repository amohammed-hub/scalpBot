# UI CORRECTIONS — 4 Items (Priority Order: 3 → 4 → 1 → 2)

## 3. OPEN POSITIONS TABLE (FIRST PRIORITY)
Currently shows "Scanning for signals..." which is WRONG.
Should be a TABLE of all open trades across all 3 bots:
| Bot | Symbol | Direction | Entry | Current | P&L | Duration |
When no trades are open, show "No open positions" — NOT "Scanning for signals."

## 4. CONFIGURATION TAB CLEANUP (SECOND PRIORITY)
4A) Add instrument dropdown + capital field INSIDE each bot card in Command Center
    so user can change instruments without going to Configuration tab.
4B) Remove the "Bot Configuration & Risk Settings" section (Instrument + Capital + Start/Stop)
    from Configuration tab — it's a duplicate of what's in Command Center.
    Keep only: risk parameters, strategies, presets, paper costs, and shadow mode toggle.

## 1. BOT CARDS P&L (THIRD PRIORITY)
Each bot card currently shows "Realized Today" which is confusing. Change to:
- When trade is OPEN: "IN TRADE: BUY CE ₹545 → Current ₹560 = +₹1,500" (live unrealized P&L)
- When NO trade is open: "No open position" + "Last: +₹291 (FinNifty CE)"
- Move "Realized Today" to Trade Log tab only — it's a summary stat, not live info.

## 2. LIVE PRICE CHART (FOURTH PRIORITY)
TradingView chart widget is empty — just showing logo with no candles.
Fix symbol configuration for MCX instruments:
- Crude Oil = MCX:CRUDEOIL1!
- Gold = MCX:GOLD1!
- Silver = MCX:SILVER1!
If TradingView doesn't support these, use Upstox price feed data to render basic candle/line chart.

## RULES:
- Fix one at a time, show each fix before moving to next
- Verify deploy on Railway console (grep) after each fix
