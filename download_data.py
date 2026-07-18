import requests, json, time
from datetime import datetime, timedelta

# Upstox historical candle API (public, no auth needed for index)
BASE = "https://api.upstox.com/v2/historical-candle"
INSTRUMENT = "NSE_INDEX|Nifty 50"
INTERVAL = "1minute"

# Download 6 months: Jan 19 - Jul 17, 2026
start_date = datetime(2026, 1, 19)
end_date = datetime(2026, 7, 17)

all_data = {}
current = start_date
failures = 0

while current <= end_date:
    # Skip weekends
    if current.weekday() >= 5:
        current += timedelta(days=1)
        continue
    
    date_str = current.strftime("%Y-%m-%d")
    url = f"{BASE}/{INSTRUMENT}/{INTERVAL}/{date_str}/{date_str}"
    
    try:
        resp = requests.get(url, timeout=10)
        data = resp.json()
        candles = data.get("data", {}).get("candles", [])
        if candles:
            all_data[date_str] = candles
            print(f"  {date_str}: {len(candles)} candles")
        else:
            # Market holiday or no data
            pass
    except Exception as e:
        failures += 1
        print(f"  {date_str}: FAILED ({e})")
        if failures > 5:
            time.sleep(2)
    
    current += timedelta(days=1)
    time.sleep(0.15)  # Rate limit

# Save
with open("/home/ubuntu/upstox-scalping-guide/nifty_1min_6months.json", "w") as f:
    json.dump(all_data, f)

total_candles = sum(len(v) for v in all_data.values())
print(f"\nDone: {len(all_data)} trading days, {total_candles} total candles")
