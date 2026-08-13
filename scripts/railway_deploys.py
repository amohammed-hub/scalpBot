#!/usr/bin/env python3
"""List recent Railway deployments for the scalpbot project."""
import json, os, subprocess

GQL = "https://backboard.railway.app/graphql/v2"
PROJECT_ID = "e80b3c31-9ba8-4531-a5c4-c2047211790c"

c = json.load(open(os.path.expanduser("~/.railway/config.json")))
token = c["user"]["accessToken"]

q = 'query($id: String!){ project(id:$id){ deployments(first:4){ edges{ node{ id status createdAt } } } } }'
r = subprocess.run(
    ["curl", "-s", "-H", f"Authorization: Bearer {token}",
     "-H", "Content-Type: application/json",
     "-d", json.dumps({"query": q, "variables": {"id": PROJECT_ID}}), GQL],
    capture_output=True, text=True,
)
d = json.loads(r.stdout)
if "errors" in d:
    print("ERRORS:", json.dumps(d["errors"])[:500])
deps = d.get("data", {}).get("project", {}).get("deployments", {}).get("edges", [])
for e in deps:
    n = e["node"]
    print(n["status"], "|", n["createdAt"], "|", n["id"])
