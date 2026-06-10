#!/usr/bin/env python3
"""Spike: pagina e baixa todos os workflows de uma subconta via API interna GHL."""
import json, os, sys, time, urllib.request, urllib.parse

LOC = "WPIUKW3L4lDyMhLhKYKG"
TOKEN = os.environ["GHL_TOKEN"]
BASE = "https://backend.leadconnectorhq.com"
HEADERS = {
    "authorization": f"Bearer {TOKEN}",
    "channel": "APP",
    "source": "WEB_USER",
    "accept": "application/json",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
}
OUT = os.path.dirname(os.path.abspath(__file__))


def get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or HEADERS)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, json.loads(r.read().decode())


def list_workflows():
    rows, offset, limit = [], 0, 100
    while True:
        qs = urllib.parse.urlencode({
            "type": "workflow", "limit": limit, "offset": offset,
            "sortBy": "name", "sortOrder": "asc",
        })
        st, d = get(f"{BASE}/workflow/{LOC}/list?{qs}")
        batch = d.get("rows", [])
        rows.extend(batch)
        total = d.get("count", len(rows))
        print(f"  página offset={offset}: +{len(batch)} (total {len(rows)}/{total})")
        offset += limit
        if len(rows) >= total or not batch:
            break
        time.sleep(0.2)
    # filtra só workflows reais (type=workflow), descarta pastas
    return [r for r in rows if r.get("type") == "workflow"]


def fetch_full(wf):
    wid = wf["id"]
    out = {"list_entry": wf}
    # detalhe
    st, detail = get(f"{BASE}/workflow/{LOC}/{wid}?includeScheduledPauseInfo=true")
    out["detail_status"] = st
    out["detail"] = detail
    # steps do Firebase (URL assinada, sem auth)
    file_url = detail.get("fileUrl")
    if file_url:
        try:
            req = urllib.request.Request(file_url)
            with urllib.request.urlopen(req, timeout=30) as r:
                out["steps"] = json.loads(r.read().decode())
                out["steps_status"] = r.status
        except Exception as e:
            out["steps_error"] = str(e)
    # triggers
    st, trig = get(f"{BASE}/workflow/{LOC}/trigger?workflowId={wid}")
    out["triggers_status"] = st
    out["triggers"] = trig
    return out


def main():
    print("== listando workflows ==")
    wfs = list_workflows()
    print(f"  {len(wfs)} workflows (type=workflow)\n")
    os.makedirs(f"{OUT}/all", exist_ok=True)
    summary = []
    for i, wf in enumerate(wfs, 1):
        print(f"[{i}/{len(wfs)}] {wf['name'][:50]}")
        full = fetch_full(wf)
        json.dump(full, open(f"{OUT}/all/{wf['id']}.json", "w"), ensure_ascii=False, indent=2)
        steps = (full.get("steps") or {}).get("templates", [])
        trigs = full.get("triggers") if isinstance(full.get("triggers"), list) else []
        summary.append({
            "id": wf["id"], "name": wf["name"], "status": wf.get("status"),
            "n_steps": len(steps), "n_triggers": len(trigs),
            "detail_status": full.get("detail_status"),
            "steps_status": full.get("steps_status", full.get("steps_error")),
        })
        time.sleep(0.2)
    json.dump(summary, open(f"{OUT}/all/_summary.json", "w"), ensure_ascii=False, indent=2)
    print("\n== RESUMO ==")
    for s in summary:
        print(f"  {s['name'][:42]:42} | {str(s['status']):10} | steps={s['n_steps']:2} | trig={s['n_triggers']} | http={s['detail_status']}/{s['steps_status']}")


if __name__ == "__main__":
    main()
