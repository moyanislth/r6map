#!/usr/bin/env python3
"""一次性数据瘦身(2026-09 架构重构):
- floors.json:各图 floors 去掉 "R";floor_names 去掉 R/outdoor;ui 清理死文案并补充设置面板文案;
  villa img_map/excluded_imgs 去掉 R 条目
- callouts/*.json:删除 "R" 与 "outdoor" 键(244 条);为有坐标的条目生成稳定 id
- sources.json: floors 记录同步去 R(仅维护用)

用法: python tools/slim_data.py   (幂等)
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

UI_NEW = {
    "click_hint": {"en": "wheel zoom · drag pan · single show coords · double-click pin", "zh": "滚轮缩放 · 拖拽平移 · 单击显坐标 · 双击添加/编辑标注"},
    "pin_done": {"en": "Save", "zh": "保存"},
    "pin_delete": {"en": "Delete", "zh": "删除"},
    "pin_name_en": {"en": "Name (EN)", "zh": "Name (ZH)"},
    "pin_name_zh": {"en": "Name (ZH)", "zh": "名称(中文)"},
    "pin_default": {"en": "Pin", "zh": "点"},
    "settings": {"en": "Settings", "zh": "设置"},
    "settings_export": {"en": "Export my pins", "zh": "导出我的标注"},
    "settings_import": {"en": "Import (paste JSON)", "zh": "导入(粘贴 JSON)"},
    "settings_apply": {"en": "Apply", "zh": "应用"},
    "settings_clear": {"en": "Clear pins of this map", "zh": "清空本图标注"},
    "settings_close": {"en": "Close", "zh": "关闭"},
    "settings_copied": {"en": "Copied ✓", "zh": "已复制 ✓"},
    "settings_import_ok": {"en": "Imported {n} entries", "zh": "已导入 {n} 条"},
    "settings_import_bad": {"en": "Invalid JSON", "zh": "JSON 格式无效"},
    "callout": {"en": "callout", "zh": "报点"},
}


def pin_id(mid: str, floor: str, en: str) -> str:
    h = hashlib.sha1(f"{mid}|{floor}|{en}".encode("utf-8")).hexdigest()[:10]
    return f"{mid}.{floor}.{h}"


def main():
    # ---- floors.json ----
    fp = DATA / "floors.json"
    cfg = json.loads(fp.read_text(encoding="utf-8"))
    cfg["floor_names"].pop("R", None)
    cfg["floor_names"].pop("outdoor", None)
    cfg["ui"] = UI_NEW
    n_removed = 0
    for mid, m in cfg["maps"].items():
        if "R" in m["floors"]:
            m["floors"].remove("R")
            n_removed += 1
        if "img_map" in m and "R" in m["img_map"]:
            del m["img_map"]["R"]
    fp.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"floors.json: {n_removed} 张图移除 R;floor_names/ui 已更新")

    # ---- callouts/*.json ----
    total = kept = 0
    for f in sorted((DATA / "callouts").glob("*.json")):
        mid = f.stem
        d = json.loads(f.read_text(encoding="utf-8"))
        d.pop("R", None)
        d.pop("outdoor", None)
        n = 0
        for floor, items in d.items():
            for it in items:
                n += 1
                it["id"] = pin_id(mid, floor, it["en"])
        total += n
        kept += sum(1 for items in d.values() for it in items if "x" in it)
        f.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"callouts: 保留 {total} 条(其中 {kept} 条有坐标)")

    # ---- sources.json ----
    sp = DATA / "sources.json"
    if sp.exists():
        s = json.loads(sp.read_text(encoding="utf-8"))
        for mid, rec in s.get("maps", {}).items():
            if isinstance(rec.get("floors"), dict) and "R" in rec["floors"]:
                del rec["floors"]["R"]
        sp.write_text(json.dumps(s, ensure_ascii=False, indent=2), encoding="utf-8")
        print("sources.json: floors 记录已同步")


if __name__ == "__main__":
    main()
