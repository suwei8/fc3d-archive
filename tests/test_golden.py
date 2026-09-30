import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_2026258_golden_fixture_is_locked():
    path = ROOT / "raw" / "2026" / "2026258.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["status"] == "verified"
    assert data["fields"] == {
        "beijing": "踏霜行",
        "taihu": "山君坐镇",
        "trial_number": "018",
        "focus": "546",
        "gold": "5",
        "corresponding": "369",
        "bottom_focus": ["1", "3"],
        "bottom_gold": "8",
    }
