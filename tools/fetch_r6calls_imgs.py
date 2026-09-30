#!/usr/bin/env python3
"""下载 r6calls (MIT) 的楼层图片 → .cache/r6calls_img/<prefix>-<index>.jpg
用途:与官方蓝图做图像对齐,推导报点坐标。断点续传 + 重试。
用法: python tools/fetch_r6calls_imgs.py
"""
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / ".cache" / "map-data.json"
OUT = ROOT / ".cache" / "r6calls_img"
CDN = "https://cdn.jsdelivr.net/gh/DudeKiller82/r6calls@master/site/img/{prefix}/{prefix}-{i}.jpg"
UA = {"User-Agent": "Mozilla/5.0"}
MAX_INDEX = 6  # 楼层最多 5-6 层,404 即停


def fetch(url: str, tries: int = 3):
    for a in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=25) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(2 * (a + 1))
        except Exception:
            time.sleep(2 * (a + 1))
    return None


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    data = json.loads(SRC.read_text(encoding="utf-8"))
    ok = skip = miss = 0
    for rid, m in data.items():
        prefix = m["imgUrlPrefix"]
        for i in range(MAX_INDEX):
            dest = OUT / f"{prefix}-{i}.jpg"
            if dest.exists():
                skip += 1
                continue
            blob = fetch(CDN.format(prefix=prefix, i=i))
            if blob and len(blob) > 5000:
                dest.write_bytes(blob)
                ok += 1
            else:
                miss += 1  # 超出楼层数的正常 404
    files = list(OUT.glob("*.jpg"))
    print(f"下载 {ok},已有 {skip},404/失败 {miss};现共 {len(files)} 张")


if __name__ == "__main__":
    main()
