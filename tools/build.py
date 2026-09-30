#!/usr/bin/env python3
"""构建静态站 → site/

- 校验数据一致性(楼层 key、图片存在、报点格式、地图重名)
- 楼层图:官方 JPEG 原样直出(高清),缩略图 560px
- 预渲染全部页面;报点数据(含坐标)以 JSON 注入,前端渲染点位
用法: python tools/build.py
"""
import json
import shutil
import sys
from pathlib import Path

from PIL import Image
from jinja2 import Environment, FileSystemLoader

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SITE = ROOT / "site"
TPL = ROOT / "templates"
STATIC = ROOT / "static"

QUALITY = 82
THUMB_W = 560


def fail(msg: str):
    print(f"!! {msg}")
    sys.exit(1)


def validate(cfg: dict, callouts: dict):
    errors = []
    seen_names = {}
    for mid, m in cfg["maps"].items():
        valid = set(m["floors"])
        for c in callouts.get(mid, {}):
            if c not in valid:
                errors.append(f"{mid}: callouts 含未知楼层 '{c}'")
        for key in m["floors"]:
            if key not in cfg["floor_names"]:
                errors.append(f"{mid}: 未知楼层 key '{key}'")
            if not (DATA / "images" / "maps" / mid / f"{key}.jpg").exists():
                errors.append(f"{mid}: 缺楼层图片 {key}.jpg")
        for floor, items in callouts.get(mid, {}).items():
            for x in items:
                if "en" not in x:
                    errors.append(f"{mid}/{floor}: 报点缺 en 键: {x}")
                if "id" not in x:
                    errors.append(f"{mid}/{floor}: 报点缺 id(跑 tools/slim_data.py): {x.get('en')}")
                if "x" not in x or "y" not in x:
                    print(f"   提示: {mid}/{floor} 无坐标(不上图,列表无): {x.get('en')}")
        if m["name_zh"] in seen_names:
            errors.append(f"{mid}: 地图中文名 '{m['name_zh']}' 与 {seen_names[m['name_zh']]} 重复")
        seen_names[m["name_zh"]] = mid
    if errors:
        fail("\n".join(errors))


def build_images(cfg: dict):
    for mid, m in cfg["maps"].items():
        src_dir = DATA / "images" / "maps" / mid
        out_dir = SITE / "img" / mid
        out_dir.mkdir(parents=True, exist_ok=True)
        keys = set(m["floors"])
        for f in src_dir.glob("*.jpg"):
            key = f.stem
            if key not in keys and not (key.endswith("-t") and key[:-2] in keys):
                continue
            dest = out_dir / f"{key}.jpg"
            # 高清策略:官方 JPEG 原样直出(零重压缩);PNG/其他格式转码 JPEG q90
            if not dest.exists() or f.stat().st_mtime > dest.stat().st_mtime:
                im = Image.open(f)
                if im.format == "JPEG":
                    shutil.copyfile(f, dest)
                else:
                    im.convert("RGB").save(dest, quality=90, optimize=True, progressive=True)
            tdest = out_dir / f"{key}-t.jpg"
            if not tdest.exists() or f.stat().st_mtime > tdest.stat().st_mtime:
                im = Image.open(f).convert("RGB")
                im.thumbnail((THUMB_W, THUMB_W))
                im.save(tdest, quality=QUALITY, optimize=True, progressive=True)


def main():
    cfg = json.loads((DATA / "floors.json").read_text(encoding="utf-8"))
    floor_names = cfg["floor_names"]
    callouts = {}
    for f in (DATA / "callouts").glob("*.json"):
        callouts[f.stem] = json.loads(f.read_text(encoding="utf-8"))
    validate(cfg, callouts)

    if SITE.exists():
        shutil.rmtree(SITE)
    SITE.mkdir()
    build_images(cfg)
    shutil.copytree(STATIC, SITE / "_", dirs_exist_ok=True)
    for f in (SITE / "_").iterdir():
        shutil.copy2(f, SITE / f.name)
    shutil.rmtree(SITE / "_")

    env = Environment(loader=FileSystemLoader(TPL), autoescape=True)
    env.globals["base"] = ""
    itpl = env.get_template("index.html")
    mtpl = env.get_template("map.html")

    maps_meta = []
    for mid, m in cfg["maps"].items():
        co = callouts.get(mid, {})
        floors = [{"key": k, **floor_names[k]} for k in m["floors"]]
        # 每层报点(仅保留楼层),剔除非保留楼层的孤儿数据
        pins = {k: co.get(k, []) for k in m["floors"] if co.get(k)}
        n = sum(len(v) for v in pins.values())
        first_indoor = next((k for k in m["floors"] if k not in ("subB", "B")), m["floors"][0])
        maps_meta.append({
            "id": mid, "name_en": m["name_en"], "name_zh": m["name_zh"],
            "floors": floors, "pins": pins,
            "has_callouts": n > 0, "n_callouts": n,
            "thumb_floor": first_indoor,
        })
    maps_meta.sort(key=lambda x: (not x["has_callouts"], x["name_zh"]))

    (SITE / "index.html").write_text(
        itpl.render(maps=maps_meta, n_callouted=sum(1 for x in maps_meta if x["has_callouts"])),
        encoding="utf-8")
    (SITE / "maps").mkdir()
    ui = cfg.get("ui", {})
    for m in maps_meta:
        env.globals["base"] = "../"  # 地图页在 site/maps/ 下,资源相对路径退一级
        (SITE / "maps" / f"{m['id']}.html").write_text(
            mtpl.render(m=m, ui=ui), encoding="utf-8")
    env.globals["base"] = ""

    n_imgs = len(list((SITE / "img").glob("*/*.jpg")))
    print(f"构建完成: {1 + len(maps_meta)} 页, {n_imgs} 张图 → site/")


if __name__ == "__main__":
    main()
