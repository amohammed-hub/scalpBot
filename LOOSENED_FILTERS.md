# Loosened Filters (Temporary) — Revert to DEFAULT values later

## Adeeb Strategy (botEngine.ts ~line 2904)
- ADX BUY: 18 → DEFAULT: 22
- ADX SELL: 22 → DEFAULT: 27
- Anti-chase: 0.5% (0.005) → DEFAULT: 0.3% (0.003)
- touchedCloud BUY tolerance: 1.003 → DEFAULT: 1.001
- touchedCloud SELL tolerance: 0.997 → DEFAULT: 0.999
- distFromCloud pullback gate: 0.003 → DEFAULT: 0.001
- Renko bricks: 2 (unchanged, already optimized)

## Red Bar Theory (botEngine.ts ~line 2617)
- Min bricks: 2 → DEFAULT: 3
- Consecutive streak: 2 → DEFAULT: 3

## Trikal Strategy (botEngine.ts ~line 2735)
- Min bricks: 2 → DEFAULT: 3
- Consecutive streak: 2 → DEFAULT: 3

## Main generateSignal (line 847)
- minConf default: 0.55 (already lowered from 0.65)
- state.minConfidence default: 60 (= 0.60 after /100)

## KEY FIX: Multi-Layer Cascade (line ~4797)
- Added cascade: if main signal=HOLD, try RedBarTheory → Trikal → Adeeb
- These functions were DEFINED but NEVER CALLED before this fix
