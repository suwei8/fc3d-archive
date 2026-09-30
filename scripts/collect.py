#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
UA = "fc3d-archive/0.1 (+https://github.com/suwei8/fc3d-archive)"

TIANQI_URL = "https://www.800820.cn/kj/3d_sjh.html"
TAIHU_URL = "https://www.cpzj.com/3d/yydd/"
CZ89_HOME_URL = "https://m.cz89.com/"

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


def discover_cz89_nightly_url(home_html: str, issue: str) -> str | None:
    """Find the issue-specific 牛彩网“福彩3D晚间字谜汇总大全” page."""
    soup = BeautifulSoup(home_html, "html.parser")
    year2 = issue[2:4]
    issue_no = str(int(issue[-3:]))
    pattern = re.compile(
        rf"(?:20)?{re.escape(year2)}年0*{re.escape(issue_no)}期福彩3D晚间字谜汇总大全"
    )
    for a in soup.find_all("a", href=True):
        title = re.sub(r"\s+", "", a.get_text(" ", strip=True))
        if pattern.search(title):
            return urljoin(CZ89_HOME_URL, a["href"])
    return None


def parse_cz89_nightly(html: str) -> dict[str, Any]:
    """Parse 北京、牛彩网关注码、其后的金码 from the nightly digest page."""
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text("\n", strip=True)
    result: dict[str, Any] = {}

    beijing = re.search(
        r"(?m)^北京试机号谜语\s*[:：]?\s*([^\n]+?)\s*$",
        text,
    )
    if beijing:
        result["beijing"] = beijing.group(1).strip()

    bottom_focus = re.search(
        r"(?m)^牛彩网关注码\s*[:：]\s*([0-9０-９,，、\s]+?)\s*$",
        text,
    )
    if bottom_focus:
        digits = re.findall(r"\d", bottom_focus.group(1))
        if digits:
            result["bottom_focus"] = digits

        tail = text[bottom_focus.end():]
        bottom_gold = re.search(
            r"(?m)^金码\s*[:：]\s*(\d)\s*$",
            tail,
        )
        if bottom_gold:
            result["bottom_gold"] = bottom_gold.group(1)

    return result


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


def build_record(issue: str, tianqi: dict[str, dict[str, str]], taihu: dict[str, str], cz89: dict[str, Any] | None = None, cz89_url: str | None = None) -> dict[str, Any]:
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

    if cz89:
        for key in ("beijing", "bottom_focus", "bottom_gold"):
            if key not in cz89:
                continue
            locked = existing and existing.get("status") == "verified" and fields.get(key) is not None
            if not locked:
                fields[key] = cz89[key]
        sources["cz89-nightly"] = {
            "url": cz89_url or CZ89_HOME_URL,
            "fetched_at": now,
            "fields": [
                key for key in ("beijing", "bottom_focus", "bottom_gold")
                if key in cz89
            ],
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
    parser.add_argument("--cz89-home-file", help="离线调试：读取牛彩网首页 HTML")
    parser.add_argument("--cz89-page-file", help="离线调试：直接读取牛彩网晚间字谜页 HTML")
    args = parser.parse_args()

    tianqi_html = Path(args.tianqi_file).read_text(encoding="utf-8") if args.tianqi_file else fetch(TIANQI_URL)
    taihu_html = Path(args.taihu_file).read_text(encoding="utf-8") if args.taihu_file else fetch(TAIHU_URL)

    tianqi = parse_tianqi(tianqi_html)
    taihu = parse_taihu(taihu_html)
    issue = args.issue or newest_issue(tianqi, taihu)

    if issue not in tianqi and issue not in taihu:
        raise SystemExit(f"Issue {issue} not found in current upstream pages")

    cz89: dict[str, Any] = {}
    cz89_url: str | None = None
    if args.cz89_page_file:
        cz89_url = "file://" + str(Path(args.cz89_page_file).resolve())
        cz89 = parse_cz89_nightly(Path(args.cz89_page_file).read_text(encoding="utf-8"))
    else:
        home_html = (
            Path(args.cz89_home_file).read_text(encoding="utf-8")
            if args.cz89_home_file
            else fetch(CZ89_HOME_URL)
        )
        cz89_url = discover_cz89_nightly_url(home_html, issue)
        if cz89_url:
            cz89 = parse_cz89_nightly(fetch(cz89_url))

    record = build_record(issue, tianqi, taihu, cz89=cz89, cz89_url=cz89_url)
    write_record(record)
    print(json.dumps(record, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
