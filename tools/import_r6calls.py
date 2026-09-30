#!/usr/bin/env python3
"""从 r6calls (MIT) 的 map-data 提取英文报点 → data/callouts/<map>.json

前置: .cache/map-data.json 已由 node extract.js 生成
    (解析 r6calls 仓库 dev/js/main/main.map-data.js)
注意:
- **破坏性**:会整体覆盖对应地图的 callouts(丢掉已有 zh/x/y),仅在新图收录流水线的
  初始阶段运行;已收录地图勿单独重跑
- 只导入保留楼层(Roof 排除,与 floors.json 一致);outdoor 不导出
- r6calls id → 本站地图 id 的映射读自 floors.json 的 r6calls_id 字段(ID_MAP 为兜底)
- 生成稳定 id;坐标由 tools/align_coords.py 对齐后写入
用法: python tools/import_r6calls.py [map ...]     # 缺省处理全部地图
"""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / ".cache" / "map-data.json"
OUT = ROOT / "data" / "callouts"
FLOORS = ROOT / "data" / "floors.json"

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
    "3rd Floor": "3F", "4th Floor": "4F",
}


def pin_id(mid: str, floor: str, en: str) -> str:
    h = hashlib.sha1(f"{mid}|{floor}|{en}".encode("utf-8")).hexdigest()[:10]
    return f"{mid}.{floor}.{h}"


def main():
    data = json.loads(SRC.read_text(encoding="utf-8"))
    cfg = json.loads(FLOORS.read_text(encoding="utf-8"))
    only = set(sys.argv[1:])
    # rid → mid:floors.json 的 r6calls_id 字段优先,ID_MAP 兜底兼容历史
    rid2mid = {m.get("r6calls_id"): mid for mid, m in cfg["maps"].items() if m.get("r6calls_id")}
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for rid, m in data.items():
        mid = rid2mid.get(rid) or ID_MAP.get(rid)
        if not mid or mid not in cfg["maps"]:
            continue
        if only and mid not in only:
            continue
        idx2key = {f["index"]: FLOOR_NAME_MAP.get(f["name"]["full"])
                   for f in m["floors"]}
        per_floor = {}
        for lab in m["roomLabels"]:
            key = idx2key.get(lab.get("floor"))
            if key is None or key not in cfg["maps"][mid]["floors"]:
                continue
            en = lab["description"].strip()
            if not en:
                continue
            bucket = per_floor.setdefault(key, [])
            if en in [x["en"] for x in bucket]:
                continue
            bucket.append({"id": pin_id(mid, key, en), "en": en})
        (OUT / f"{mid}.json").write_text(
            json.dumps(per_floor, ensure_ascii=False, indent=1), encoding="utf-8")
        n = sum(len(v) for v in per_floor.values())
        total += n
        print(f"{mid:15s} {n:3d} 条  楼层: {', '.join(per_floor)}")
    print(f"\n共 {total} 条(无坐标,跑 tools/align_coords.py 写入)")


if __name__ == "__main__":
    main()
