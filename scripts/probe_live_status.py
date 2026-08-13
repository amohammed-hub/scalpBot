#!/usr/bin/env python3
"""Probe the live dashboard allStatus endpoint for the current in-memory bot state."""
import json, os, urllib.request

TOKENS = ["8d17c6ad-934f-4c91-b47f-6d54926b8e0a", "b9fe46ea-122d-494d-a097-3f5d8cf32d4e"]
URL = "https://scalpbot.up.railway.app/api/trpc/multiBots.allStatus?batch=1&input="

for tok in TOKENS:
    payload = {"0": {"json": {"sessionToken": tok, "isAdmin": True}}}
    req = urllib.request.Request(
        URL + urllib.request.quote(json.dumps(payload)),
        headers={"Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read().decode())
        result = data[0]["result"]
        if "data" in result:
            bots = result["data"]["json"].get("bots", [])
            print(f"\n=== token={tok[:8]}… bots={len(bots)}")
            for b in bots:
                print(f"  {b.get('instrumentLabel','?'):12s} tokenKey={b.get('sessionToken','?')[-18:]:18s} slot={b.get('botSlot','?')} tradesToday={b.get('tradesCount','?')} status={b.get('status','?')}")
        else:
            print(f"=== token={tok[:8]}… ERROR:", str(result)[:200])
    except Exception as e:
        print(f"=== token={tok[:8]}… request failed: {e}")
