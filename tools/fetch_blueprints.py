#!/usr/bin/env python3
"""下载育碧官方蓝图 zip 并按楼层入库。

用法:
    python tools/fetch_blueprints.py            # 下载缺失的 zip + 提取全部楼层图
    python tools/fetch_blueprints.py --check    # 仅对比哈希,报告官方更新(不下载)

数据源约定见 data/floors.json(每图的 zip URL 与楼层→图片序号映射)。
输出:
    data/images/maps/<map>/<floorKey>.jpg   楼层蓝图图
    data/sources.json                        每图 zip 的 URL / sha256 / 提取时间(仅维护用)
"""
import hashlib
import json
import shutil
import sys
import time
import zipfile
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
FLOORS = ROOT / "data" / "floors.json"
IMG_DIR = ROOT / "data" / "images" / "maps"
CACHE = ROOT / ".cache" / "zips"
SOURCES = ROOT / "data" / "sources.json"

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def get_zip(mid: str, url: str) -> Path | None:
    """返回本地 zip 路径;下载失败返回 None。"""
    CACHE.mkdir(parents=True, exist_ok=True)
    dest = CACHE / f"{mid}.zip"
    if dest.exists() and dest.stat().st_size > 10000:
        try:
            zipfile.ZipFile(dest)
            return dest
        except zipfile.BadZipFile:
            pass
    print(f"  下载 {mid} ...")
    try:
        r = requests.get(url, headers=UA, timeout=180)
        r.raise_for_status()
        dest.write_bytes(r.content)
        zipfile.ZipFile(dest)  # 校验
        return dest
    except Exception as e:
        print(f"  !! {mid} 下载失败: {e}")
        return None


def extract(zp: Path, mid: str, floors: list[str], img_map: dict | None, excluded: list[int]) -> list[Path]:
    """解压楼层图 → data/images/maps/<mid>/<floorKey>.jpg,返回图片路径列表。"""
    out = []
    with zipfile.ZipFile(zp) as z:
        imgs = sorted(
            n for n in z.namelist()
            if not n.startswith("__MACOSX") and not Path(n).name.startswith("._")
            and Path(n).suffix.lower() in (".jpg", ".jpeg", ".png")
        )
        # zip 内子目录排序可能打乱顺序,按文件名末尾数字稳定排序
        import re
        def sort_key(n):
            m = re.search(r"(\d+)\.[a-z]+$", n.lower())
            return (int(m.group(1)) if m else 999, n)
        imgs.sort(key=sort_key)
        for i, floor_key in enumerate(floors):
            idx = (img_map or {}).get(floor_key, i)
            if idx >= len(imgs):
                print(f"  !! {mid}: 楼层 {floor_key} 无对应图片")
                continue
            dest = IMG_DIR / mid / f"{floor_key}.jpg"
            dest.parent.mkdir(parents=True, exist_ok=True)
            with z.open(imgs[idx]) as src, open(dest, "wb") as f:
                shutil.copyfileobj(src, f)
            out.append(dest)
    return out


def main():
    check_only = "--check" in sys.argv
    cfg = json.loads(FLOORS.read_text(encoding="utf-8"))
    src = json.loads(SOURCES.read_text(encoding="utf-8")) if SOURCES.exists() else {"maps": {}}
    floor_names = cfg["floor_names"]
    ok = 0
    for mid, m in cfg["maps"].items():
        print(f"[{mid}] {m['name_en']}")
        if check_only:
            zp = CACHE / f"{mid}.zip"
            if not zp.exists():
                print("  本地无 zip,跳过(跑一次完整模式入库)")
                continue
            old = src["maps"].get(mid, {}).get("zip_sha256")
            new = sha256(zp)
            print(f"  {'哈希一致' if old == new else '!! 官方 zip 有更新(地图重做?)——需重跑完整模式并人工核对报点'}")
            continue
        zp = get_zip(mid, m["zip"])
        if not zp:
            continue
        floors = m["floors"]
        files = extract(zp, mid, floors, m.get("img_map"), m.get("excluded_imgs", []))
        n_imgs = len([n for n in zipfile.ZipFile(zp).namelist()
                      if Path(n).suffix.lower() in (".jpg", ".jpeg", ".png") and not n.startswith("__MACOSX")])
        src["maps"][mid] = {
            "zip_url": m["zip"],
            "zip_sha256": sha256(zp),
            "zip_imgs": n_imgs,
            "floors": {k: floor_names[k] for k in floors},
            "excluded_imgs": m.get("excluded_imgs", []),
            "fetched_at": time.strftime("%Y-%m-%d"),
        }
        ok += 1
        print(f"  {len(files)} 张楼层图入库")
    if not check_only:
        SOURCES.write_text(json.dumps(src, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n完成 {ok}/27 张图")


if __name__ == "__main__":
    main()
