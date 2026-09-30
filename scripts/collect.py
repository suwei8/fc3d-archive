#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
UA = "fc3d-archive/0.1 (+https://github.com/suwei8/fc3d-archive)"

TIANQI_URL = "https://www.800820.cn/kj/3d_sjh.html"
TAIHU_URL = "https://www.cpzj.com/3d/yydd/"

FIELDS = [
    "beijing", "taihu", "trial_number", "focus", "gold",
    "corresponding", "bottom_focus", "bottom_gold",
]

LABELS = {
    "beijing": "北京",
    "taihu": "太湖",
    "trial_number": "试机号",
    "focus": "关注码",
    "gold": "金码",
    "corresponding": "对应码",
    "bottom_focus": "底部关注码",
    "bottom_gold": "底部金码",
}


def fetch(url: str) -> str:
    r = requests.get(url, headers={"User-Agent": UA}, timeout=25)
    r.raise_for_status()
    if not r.encoding or r.encoding.lower() == "iso-8859-1":
        r.encoding = r.apparent_encoding
    return r.text


def _cells(tr) -> list[str]:
    return [c.get_text(" ", strip=True) for c in tr.find_all(["th", "td"])]


def _issue_token(value: str) -> str | None:
    m = re.search(r"20\d{5}", value.replace(" ", ""))
    return m.group(0) if m else None


def parse_tianqi(html: str) -> dict[str, dict[str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    rows: dict[str, dict[str, str]] = {}
    for tr in soup.find_all("tr"):
        cells = _cells(tr)
        if len(cells) < 7:
            continue
        issue = _issue_token(cells[0])
        if not issue:
            continue
        compact = [re.sub(r"\s+", "", c) for c in cells]
        trial = re.sub(r"\D", "", compact[3])
        focus = re.sub(r"\D", "", compact[4])
        gold = re.sub(r"\D", "", compact[5])
        corresponding = re.sub(r"\D", "", compact[6])
        if len(trial) == 3 and len(focus) == 3 and len(gold) == 1 and len(corresponding) == 3:
            rows[issue] = {
                "trial_number": trial,
                "focus": focus,
                "gold": gold,
                "corresponding": corresponding,
            }
    return rows


def parse_taihu(html: str) -> dict[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    rows: dict[str, str] = {}
    for tr in soup.find_all("tr"):
        cells = _cells(tr)
        if len(cells) < 4:
            continue
        issue = _issue_token(cells[0])
        if not issue:
            continue
        phrase = re.sub(r"\s+", "", cells[3])
        if phrase:
            rows[issue] = phrase
    return rows


def newest_issue(*collections) -> str:
    issues: set[str] = set()
    for collection in collections:
        issues.update(collection.keys())
    if not issues:
        raise RuntimeError("No issue number could be parsed from upstream sources")
    return max(issues, key=int)


def load_existing(issue: str) -> dict[str, Any] | None:
    path = ROOT / "raw" / issue[:4] / f"{issue}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def build_record(issue: str, tianqi: dict[str, dict[str, str]], taihu: dict[str, str]) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    existing = load_existing(issue)
    fields = {key: None for key in FIELDS}
    if existing:
        fields.update(existing.get("fields", {}))

    sources: dict[str, Any] = {}
    if issue in tianqi:
        for key, value in tianqi[issue].items():
            locked = existing and existing.get("status") == "verified" and fields.get(key) is not None
            if not locked:
                fields[key] = value
        sources["tianqi-sjh"] = {
            "url": TIANQI_URL,
            "fetched_at": now,
            "fields": ["trial_number", "focus", "gold", "corresponding"],
        }

    if issue in taihu:
        locked = existing and existing.get("status") == "verified" and fields.get("taihu") is not None
        if not locked:
            fields["taihu"] = taihu[issue]
        sources["cpzj-taihu"] = {
            "url": TAIHU_URL,
            "fetched_at": now,
            "fields": ["taihu"],
        }

    status = "verified" if existing and existing.get("status") == "verified" else "candidate"
    return {
        "issue": issue,
        "status": status,
        "verified_by": existing.get("verified_by") if existing else None,
        "fields": fields,
        "sources": sources,
        "collected_at": now,
        "notes": existing.get("notes", []) if existing else [],
    }


def render_md(record: dict[str, Any]) -> str:
    status = record["status"]
    populated_status = "✅ 人工确认" if status == "verified" else "⚠️ 自动采集/待核验"
    lines = [
        f"# 福彩3D {record['issue']}期",
        "",
        f"> 当前状态：**{status}**",
        "",
        "| 字段 | 数据 | 状态 |",
        "| --- | --- | --- |",
    ]
    for key in FIELDS:
        value = record["fields"].get(key)
        shown = "、".join(value) if isinstance(value, list) else (value or "—")
        field_status = populated_status if shown != "—" else "⏳ 待采集"
        lines.append(f"| {LABELS[key]} | {shown} | {field_status} |")

    lines.extend(["", "## 数据源", ""])
    if record.get("sources"):
        for source_id, meta in record["sources"].items():
            lines.append(f"- {source_id}: {meta['url']}")
    else:
        lines.append("- 暂无自动来源记录")

    lines.extend([
        "",
        "## 说明",
        "",
        "- 自动采集结果默认保持 candidate，未经人工核图不得升级为 verified。",
        "- 已人工确认的字段不会被后续自动采集覆盖。",
        "",
    ])
    return "\n".join(lines)


def write_record(record: dict[str, Any]) -> None:
    issue = record["issue"]
    year = issue[:4]
    raw_dir = ROOT / "raw" / year
    data_dir = ROOT / "data" / year
    raw_dir.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)
    (raw_dir / f"{issue}.json").write_text(
        json.dumps(record, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (data_dir / f"{issue}.md").write_text(render_md(record), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--issue", help="期号，例如 2026263；省略则取上游最新期")
    parser.add_argument("--tianqi-file", help="离线调试：读取天齐 HTML")
    parser.add_argument("--taihu-file", help="离线调试：读取太湖 HTML")
    args = parser.parse_args()

    tianqi_html = Path(args.tianqi_file).read_text(encoding="utf-8") if args.tianqi_file else fetch(TIANQI_URL)
    taihu_html = Path(args.taihu_file).read_text(encoding="utf-8") if args.taihu_file else fetch(TAIHU_URL)

    tianqi = parse_tianqi(tianqi_html)
    taihu = parse_taihu(taihu_html)
    issue = args.issue or newest_issue(tianqi, taihu)

    if issue not in tianqi and issue not in taihu:
        raise SystemExit(f"Issue {issue} not found in current upstream pages")

    record = build_record(issue, tianqi, taihu)
    write_record(record)
    print(json.dumps(record, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
