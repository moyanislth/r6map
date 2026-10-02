#!/usr/bin/env python3
"""合并贡献者导出的标注 JSON → data/callouts/<map>.json

用法:
    python tools/apply_contribution.py <map> <contribution.json> [--dry-run]

输入为网站设置面板导出的 JSON 形状(或仅 custom 数组):
    { "overrides": { "<报点id>": { "x":..., "y":..., "zh":... , "deleted"?:true } },
      "custom":    [ { "floor":..., "x":..., "y":..., "en":..., "zh":... } ] }

规则:
    overrides  按 id 匹配已有报点,覆盖 x/y/en/zh;deleted:true 表示删除该报点
    custom     追加为新报点(不带 id,构建期 --fix 自动补齐);楼层须合法、同层 en 不得重名

新条目没有 id,合并后需执行:
    python tools/build.py --fix && python tools/build.py
"""
import json
import sys
from pathlib import Path

from _common import DATA, ROOT


def fail(msg: str):
    print(f"!! {msg}")
    sys.exit(1)


def main():
    dry = "--dry-run" in sys.argv
    args = [a for a in sys.argv[1:] if a != "--dry-run"]
    if len(args) != 2:
        fail("用法: python tools/apply_contribution.py <map> <contribution.json> [--dry-run]")
    mid, src = args

    cfg = json.loads((DATA / "floors.json").read_text(encoding="utf-8"))
    if mid not in cfg["maps"]:
        fail(f"未知地图 '{mid}'(floors.json 未注册)")
    valid_floors = set(cfg["maps"][mid]["floors"])

    co_path = DATA / "callouts" / f"{mid}.json"
    callouts = json.loads(co_path.read_text(encoding="utf-8")) if co_path.exists() else {}
    data = json.loads(Path(src).read_text(encoding="utf-8"))
    if isinstance(data, list):
        data = {"overrides": {}, "custom": data}
    if not isinstance(data, dict):
        fail("JSON 须为 {overrides, custom} 对象(网站设置面板导出的格式)")
    overrides = data.get("overrides") or {}
    custom = data.get("custom") or []
    if not isinstance(overrides, dict) or not isinstance(custom, list):
        fail("JSON 形状无效:overrides 须为对象,custom 须为数组")

    # ---- overrides:按 id 修正/删除已有报点 ----
    index = {}
    for floor, items in callouts.items():
        for entry in items:
            index[entry.get("id")] = (floor, entry)

    n_fix = n_del = 0
    unmatched = []
    for pid, ov in overrides.items():
        hit = index.get(pid)
        if hit is None:
            unmatched.append(pid)
            continue
        if not isinstance(ov, dict):
            continue
        floor, entry = hit
        if ov.get("deleted"):
            callouts[floor].remove(entry)
            n_del += 1
            print(f"  删除: {floor} '{entry.get('en')}'(贡献者标记 deleted)")
            continue
        for k in ("x", "y", "en", "zh"):
            v = ov.get(k)
            if v in (None, ""):
                continue
            try:
                entry[k] = round(float(v), 4) if k in ("x", "y") else str(v).strip()
            except (TypeError, ValueError):
                fail(f"override '{pid}' 的 '{k}' 值无效: {v!r}")
        n_fix += 1
        print(f"  修正: {floor} '{entry.get('en')}'")

    # ---- custom:追加新报点 ----
    n_add = 0
    skipped = []
    for c in custom:
        if not isinstance(c, dict):  # 形状不对的条目:跳过并报告,不中断合并
            skipped.append(f"非对象条目 {str(c)[:40]}")
            continue
        floor = c.get("floor")
        en = str(c.get("en") or "").strip()
        zh = str(c.get("zh") or "").strip()
        if floor not in valid_floors:
            skipped.append(f"'{en or '?'}'(未知楼层 '{floor}')")
            continue
        if not en:
            skipped.append(f"floor={floor}(缺 en)")
            continue
        if any(x.get("en") == en for x in callouts.get(floor, [])):
            skipped.append(f"'{en}'(同层英文重名)")
            continue
        entry = {"en": en, "zh": zh}
        try:
            entry["x"] = round(float(c["x"]), 4)
            entry["y"] = round(float(c["y"]), 4)
        except (TypeError, ValueError, KeyError):
            pass  # 无坐标则不上图,与文件格式约定一致
        callouts.setdefault(floor, []).append(entry)
        n_add += 1
        tag = "" if zh else "(缺 zh)"
        warn = "  [注意:默认名,建议改为有意义的命名]" if en.startswith("Pin ") else ""
        print(f"  新增: {floor} '{en}' -> '{zh}'{tag}{warn}")

    if unmatched:
        print(f"  [提示] {len(unmatched)} 条 override 未匹配到报点(可能来自自建标注或其他地图):")
        for pid in unmatched[:10]:
            print(f"    - {pid}")

    if dry:
        print(f"[dry-run] 未写回。将: 修正 {n_fix} / 删除 {n_del} / 新增 {n_add}"
              + (f" / 跳过 {len(skipped)}" if skipped else ""))
        return

    if not any((n_fix, n_del, n_add)):
        print("无有效变更,未写回")
        return
    co_path.write_text(json.dumps(callouts, ensure_ascii=False, indent=1), encoding="utf-8")
    if skipped:
        print(f"  [跳过 {len(skipped)} 条]")
        for s in skipped:
            print(f"    - {s}")
    no_zh = sum(1 for items in callouts.values() for x in items if not x.get("zh"))
    print(f"完成: 修正 {n_fix} / 删除 {n_del} / 新增 {n_add} → {co_path.relative_to(ROOT)}")
    if no_zh:
        print(f"[提示] 该图现有 {no_zh} 条报点缺 zh(中文模式将回退显示英文)")
    print("后续: python tools/build.py --fix && python tools/build.py")


if __name__ == "__main__":
    main()
