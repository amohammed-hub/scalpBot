#!/usr/bin/env python3
"""Set SMOKE_TEST_TOKEN as a Railway variable on the scalpbot service (production env)."""
import json, os, subprocess, sys

GQL = "https://backboard.railway.app/graphql/v2"
SECRET = "85bee6e7c72c1b16cdc1373861f67491"
PROJECT_ID = "e80b3c31-9ba8-4531-a5c4-c2047211790c"

def gql(token: str, query: str, variables=None):
    body = {"query": query, "variables": variables or {}}
    r = subprocess.run(
        ["curl", "-s", "-H", f"Authorization: Bearer {token}",
         "-H", "Content-Type: application/json", "-d", json.dumps(body), GQL],
        capture_output=True, text=True,
    )
    out = json.loads(r.stdout)
    if "errors" in out:
        print("GQL ERRORS:", json.dumps(out["errors"])[:500])
    return out

def find_token():
    cfg = os.path.expanduser("~/.railway/config.json")
    if os.path.exists(cfg):
        with open(cfg) as f:
            c = json.load(f)
        if isinstance(c, dict):
            for k in ("token", "accessToken"):
                if c.get(k):
                    return c[k]
            # nested under user/projects
            if isinstance(c.get("user"), dict):
                for k in ("token", "accessToken"):
                    if c["user"].get(k):
                        return c["user"][k]
            for proj in c.get("projects", {}).values() if isinstance(c.get("projects"), dict) else []:
                if isinstance(proj, dict) and proj.get("token"):
                    return proj["token"]
    return os.environ.get("RAILWAY_TOKEN") or os.environ.get("RAILWAY_API_TOKEN") or ""

token = find_token()
if not token:
    print("ERROR: no Railway token"); sys.exit(1)

def flat_edges(d, key):
    lst = d.get(key, {})
    if isinstance(lst, dict):
        return [e.get("node", {}) for e in lst.get("edges", [])]
    return []

proj = gql(token, 'query ($id: String!) { project(id: $id) { id name environments { edges { node { id name } } } services { edges { node { id name } } } } }', {"id": PROJECT_ID})
p = proj.get("data", {}).get("project") or {}
print("PROJECT:", p.get("name"), "envs:", [(e["name"], e["id"]) for e in flat_edges(p, "environments")])
print("SERVICES:", [(s["name"], s["id"]) for s in flat_edges(p, "services")])
