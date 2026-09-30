#!/usr/bin/env python3
"""从 r6calls (MIT) 的 map-data 提取英文报点 → data/callouts/<map>.json

前置: .cache/map-data.json 已由 node extract.js 生成
    (解析 r6calls 仓库 dev/js/main/main.map-data.js)
用法: python tools/import_r6calls.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / ".cache" / "map-data.json"
OUT = ROOT / "data" / "callouts"
FLOORS = ROOT / "data" / "floors.json"

# r6calls 地图 id → 本项目 id(bartlett 已不在官方 27 图列表,跳过)
ID_MAP = {
    "bank": "bank", "border": "border", "chalet": "chalet", "club": "clubhouse",
    "coastline": "coastline", "consulate": "consulate", "favela": "favela",
    "fortress": "fortress", "hereford": "hereford", "house": "house", "kafe": "kafe",
    "kanal": "kanal", "oregon": "oregon", "outback": "outback", "plane": "plane",
    "skyscraper": "skyscraper", "themepark": "themepark", "tower": "tower",
    "villa": "villa", "yacht": "yacht",
}
FLOOR_NAME_MAP = {
    "Sub-Basement": "subB", "Basement": "B", "1st Floor": "1F", "2nd Floor": "2F",
    "3rd Floor": "3F", "4th Floor": "4F", "Roof": "R",
}


def main():
    data = json.loads(SRC.read_text(encoding="utf-8"))
    cfg = json.loads(FLOORS.read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for rid, mid in ID_MAP.items():
        m = data[rid]
        idx2key = {f["index"]: FLOOR_NAME_MAP[f["name"]["full"]] for f in m["floors"]}
        valid_keys = set(cfg["maps"][mid]["floors"]) | {"outdoor"}
        per_floor: dict[str, list] = {}
        for lab in m.get("roomLabels", []):
            key = idx2key.get(lab.get("floor"), "outdoor")
            if key not in valid_keys:
                continue
            en = lab["description"].strip()
            if not en:
                continue
            bucket = per_floor.setdefault(key, [])
            if en not in [x["en"] for x in bucket]:  # 去重
                bucket.append({"en": en})
        (OUT / f"{mid}.json").write_text(
            json.dumps(per_floor, ensure_ascii=False, indent=1), encoding="utf-8")
        n = sum(len(v) for v in per_floor.values())
        total += n
        print(f"{mid:15s} {n:3d} 条  楼层: {', '.join(per_floor)}")
    print(f"\n共 {total} 条英文报点 → data/callouts/")


if __name__ == "__main__":
    main()
