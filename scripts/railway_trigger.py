#!/usr/bin/env python3
"""Inspect Railway service deploy trigger and force a build from the latest commit."""
import json, os, subprocess, sys

GQL = "https://backboard.railway.app/graphql/v2"


def gql(token: str, query: str, variables: dict | None = None):
    body = {"query": query, "variables": variables or {}}
    r = subprocess.run(
        ["curl", "-s", "-H", f"Authorization: Bearer {token}",
         "-H", "Content-Type: application/json", "-d", json.dumps(body), GQL],
        capture_output=True, text=True,
    )
    return json.loads(r.stdout)


def find_token():
    cfg_path = os.path.expanduser("~/.railway/config.json")
    if os.path.exists(cfg_path):
        with open(cfg_path) as f:
            c = json.load(f)
        if isinstance(c, dict) and c.get("token"):
            return c["token"]
    # fallback: read from env (set by railway CLI session)
    tok = os.environ.get("RAILWAY_TOKEN") or os.environ.get("RAILWAY_API_TOKEN")
    return tok or ""


token = find_token()
if not token:
    print("ERROR: no Railway token found")
    sys.exit(1)

# 1. Who am I
r = gql(token, "{ me { id name } }")
print("ME:", json.dumps(r, separators=(",", ":"))[:200])

# 2. Find the service + its deploy trigger settings
query = """
query ($projectId: ID!) {
  project(id: $projectId) {
    id name
    environments { id name }
    services { id name }
  }
}
"""
r = gql(token, query, {"projectId": "e80b3c31-9ba8-4531-a5c4-c2047211790c"})
svc = None
for s in r.get("data", {}).get("project", {}).get("services", []):
    if "scalping" in s["name"]:
        svc = s
        break
print("SERVICE:", svc)
if not svc:
    sys.exit(1)

# 3. Inspect deploy triggers (git integration settings)
query2 = """
query ($serviceId: ID!, $environmentId: ID!) {
  service(id: $serviceId) {
    id name
    environment(id: $environmentId) {
      id name
      services { id gitBranch }
    }
  }
}
"""
r2 = gql(token, query2, {"serviceId": svc["id"], "environmentId": "2e96bea7-5f3d-405c-b556-e27a6137d40c"})
print("BRANCH CONFIG:", json.dumps(r2.get("data", {}), separators=(",", ":"))[:400])
