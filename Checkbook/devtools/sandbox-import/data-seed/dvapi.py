#!/usr/bin/env python3
"""Minimal Dataverse Web API client using SP client-credentials.
Secret read from ~/.config/checkbook-dataload.secret (never printed)."""
import json, os, sys, time, urllib.request, urllib.parse, urllib.error

ORG    = "https://orgd866b25a.crm.dynamics.com"
TENANT = "f018fa8e-c7ba-46dc-9591-233769e79664"
_appid_file = os.path.expanduser("~/.config/checkbook-dataload.appid")
APPID = (open(_appid_file).read().strip() if os.path.exists(_appid_file) else "") \
        or "8e54ae46-3242-4105-a061-5e798af3c508"
SECRET = open(os.path.expanduser("~/.config/checkbook-dataload.secret")).read().strip()

_tok = {"v": None, "exp": 0}
def token():
    if _tok["v"] and time.time() < _tok["exp"] - 120:
        return _tok["v"]
    body = urllib.parse.urlencode({
        "client_id": APPID, "client_secret": SECRET,
        "scope": ORG + "/.default", "grant_type": "client_credentials",
    }).encode()
    url = f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token"
    try:
        r = json.loads(urllib.request.urlopen(urllib.request.Request(url, body), timeout=60).read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"token request failed HTTP {e.code} (appid={APPID}, secretlen={len(SECRET)}): {e.read().decode()[:400]}")
    _tok["v"] = r["access_token"]; _tok["exp"] = time.time() + int(r.get("expires_in", 3600))
    return _tok["v"]

def _req(method, path, body=None, extra=None):
    url = ORG + "/api/data/v9.2/" + path
    h = {"Authorization": "Bearer " + token(), "Accept": "application/json",
         "OData-MaxVersion": "4.0", "OData-Version": "4.0", "Content-Type": "application/json"}
    if extra: h.update(extra)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        resp = urllib.request.urlopen(req, timeout=120)
        rb = resp.read()
        return resp, (json.loads(rb) if rb else None)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} -> HTTP {e.code}: {e.read().decode()[:500]}")

def get(path): return _req("GET", path)[1]
import re as _re
def post(entityset, body):
    """create; returns new record GUID (from header or representation body)"""
    resp, data = _req("POST", entityset, body, {"Prefer": "return=representation"})
    m = _re.search(r"\(([0-9a-fA-F-]{36})\)", resp.headers.get("OData-EntityId", "") or "")
    if m: return m.group(1)
    if isinstance(data, dict):
        for k, v in data.items():
            if k.endswith("id") and isinstance(v, str) and _re.fullmatch(r"[0-9a-fA-F-]{36}", v):
                return v
    return None
def patch(entityset, gid, body): _req("PATCH", f"{entityset}({gid})", body)
def find_id(entityset, name):
    """return GUID of record whose book_name == name, else None"""
    flt = "book_name eq '%s'" % name.replace("'", "''")
    qs = urllib.parse.urlencode({"$filter": flt, "$top": "1"}, quote_via=urllib.parse.quote)
    q = f"{entityset}?{qs}"
    for rec in (get(q).get("value") or []):
        for k, v in rec.items():
            if k.endswith("id") and isinstance(v, str) and _re.fullmatch(r"[0-9a-fA-F-]{36}", v):
                return v
    return None

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "whoami"
    if cmd == "whoami":
        print("WhoAmI OK ->", get("WhoAmI"))
    elif cmd == "count":
        for es in sys.argv[2:]:
            try:
                j = get(es + "?$count=true&$top=1")
                print(f"  {es}: {j.get('@odata.count', '?')} rows")
            except Exception as e:
                print(f"  {es}: ERR {e}")
