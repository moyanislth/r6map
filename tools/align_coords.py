#!/usr/bin/env python3
"""把 r6calls 报点坐标对齐到官方蓝图(SIFT 特征匹配版),产出 x/y。

原理:
- r6calls 楼层图与官方蓝图是同一渲染的不同裁剪+缩放(尺寸无规律)
- 报点在 r6calls 图片内的像素 = label.{top,left} - floor.{top,left}(虚拟画布差)
- SIFT 特征匹配 + RANSAC 仿射(相似变换)估计 r6图 → 官方图 的映射
- 官方归一化坐标 = M @ [r6px, 1] / 官方尺寸

产物:
- data/callouts/<map>.json 条目增加稳定 id 与 x/y(低置信层不写坐标)
- .cache/align/<map>-<floor>.jpg 验证叠加图(红点=报点)
- .cache/align/report.json 每层置信度

用法: python tools/align_coords.py [map ...]     # 缺省处理全部地图
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MAPDATA = ROOT / ".cache" / "map-data.json"
FLOORS = ROOT / "data" / "floors.json"
R6IMG = ROOT / ".cache" / "r6calls_img"
OFFICIAL = ROOT / "data" / "images" / "maps"
CALLOUTS = ROOT / "data" / "callouts"
FIXUPS = ROOT / "data" / "align_fixups.json"
ALIGNDIR = ROOT / ".cache" / "align"

NAME_KEY = {"Sub-Basement": "subB", "Basement": "B", "1st Floor": "1F",
            "2nd Floor": "2F", "3rd Floor": "3F", "4th Floor": "4F"}
MIN_INLIERS = 12
MIN_SCORE = 0.55  # 内点比例
SIFT = cv2.SIFT_create(nfeatures=6000)
BF = cv2.BFMatcher()


def to_gray(im):
    return cv2.cvtColor(np.array(im.convert("RGB")), cv2.COLOR_RGB2GRAY)


def align(off_g, r6_g):
    """SIFT 匹配 → 相似变换。返回 (score, M, inliers) 或 (score, None, 0)。"""
    kp1, des1 = SIFT.detectAndCompute(off_g, None)
    kp2, des2 = SIFT.detectAndCompute(r6_g, None)
    if des1 is None or des2 is None or len(kp2) < 10:
        return -1.0, None, 0
    matches = BF.knnMatch(des2, des1, k=2)
    good = []
    for mn in matches:
        if len(mn) == 2 and mn[0].distance < 0.75 * mn[1].distance:
            good.append(mn[0])
    if len(good) < MIN_INLIERS:
        return -1.0, None, len(good)
    src = np.float32([kp2[g_.queryIdx].pt for g_ in good]).reshape(-1, 1, 2)
    dst = np.float32([kp1[g_.trainIdx].pt for g_ in good]).reshape(-1, 1, 2)
    M, inl = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC,
                                         ransacReprojThreshold=4.0, maxIters=5000)
    if M is None:
        return -1.0, None, 0
    inliers = int(inl.sum())
    score = inliers / len(good)
    return score, M, inliers


def clamp(v):
    v = float(v)
    if v < -0.06 or v > 1.06:
        return None
    return min(1.0, max(0.0, round(v, 4)))


def match_item(items, en, x, y):
    cands = [it for it in items if it["en"] == en]
    if not cands:
        return
    free = [it for it in cands if "x" not in it]
    it = free[0] if free else cands[0]
    it["x"], it["y"] = x, y


def main():
    ALIGNDIR.mkdir(parents=True, exist_ok=True)
    fixups = json.loads(FIXUPS.read_text(encoding="utf-8")) if FIXUPS.exists() else {}
    data = json.loads(MAPDATA.read_text(encoding="utf-8"))
    cfg = json.loads(FLOORS.read_text(encoding="utf-8"))
    # rid → mid:floors.json 的 r6calls_id 字段(旧 club→clubhouse 已随字段迁移)
    rid2mid = {m.get("r6calls_id"): mid for mid, m in cfg["maps"].items() if m.get("r6calls_id")}
    only = set(sys.argv[1:])
    report = {}
    for rid, m in data.items():
        mid = rid2mid.get(rid)
        if not mid:
            continue  # 未收录的 r6calls 地图(含 bartlett 等已排除图)
        if only and mid not in only:
            continue
        prefix = m["imgUrlPrefix"]
        co_path = CALLOUTS / f"{mid}.json"
        if not co_path.exists():
            continue
        co = json.loads(co_path.read_text(encoding="utf-8"))
        labels_by_floor = {}
        for lab in m["roomLabels"]:
            labels_by_floor.setdefault(lab.get("floor"), []).append(lab)

        for floor in m["floors"]:
            if floor["name"]["full"] == "Roof":
                continue
            fi = floor["index"]
            key = NAME_KEY.get(floor["name"]["full"])
            if key is None:
                print(f"  [跳过] {rid}: 未知楼层名 '{floor['name']['full']}'(需在 NAME_KEY 登记)")
                continue
            if key not in co:
                continue
            src = R6IMG / f"{prefix}-{fi}.jpg"
            off_path = OFFICIAL / mid / f"{key}.jpg"
            tag = f"{mid}/{key}"
            if not src.exists() or not off_path.exists():
                report[tag] = {"error": "missing image"}
                continue
            off_img = Image.open(off_path).convert("RGB")
            r6_img = Image.open(src).convert("RGB")
            off_g = to_gray(off_img)
            r6_g = to_gray(r6_img)

            score, M, inliers = align(off_g, r6_g)
            fx = fixups.get(mid, {}).get(key)
            fixed = False
            if isinstance(fx, dict) and "a" in fx:
                a, b, tx, ty = fx["a"], fx["b"], fx["tx"], fx["ty"]
                M = np.float32([[a, -b, tx], [b, a, ty]])
                score, inliers, fixed = 1.0, 999, True
            report[tag] = {"score": round(score, 3), "inliers": inliers, "fixed": fixed}
            # 高内点数时比例阈值放宽(特征多导致比例被稀释,绝对内点数更可信)
            ok = score >= MIN_SCORE or (inliers >= 50 and score >= 0.30)
            if isinstance(fx, dict) and fx.get("force"):
                ok = True  # 人工复核用:强制采用本次计算的 M
            if M is None or (not ok and not fixed):
                report[tag]["note"] = "LOW CONFIDENCE - 坐标未写入"
                continue

            fo_left, fo_top = floor["left"], floor["top"]
            dots = []
            for lab in labels_by_floor.get(fi, []):
                rx, ry = lab["left"] - fo_left, lab["top"] - fo_top
                ox = M[0, 0] * rx + M[0, 1] * ry + M[0, 2]
                oy = M[1, 0] * rx + M[1, 1] * ry + M[1, 2]
                x = clamp(ox / off_img.width)
                y = clamp(oy / off_img.height)
                if x is None or y is None:
                    continue
                match_item(co[key], lab["description"], x, y)
                dots.append((int(ox), int(oy)))

            overlay = np.array(off_img)
            for px, py in dots:
                cv2.circle(overlay, (px, py), 5, (0, 0, 255), -1)
                cv2.circle(overlay, (px, py), 5, (255, 255, 255), 1)
            out = Image.fromarray(overlay)
            out.thumbnail((1400, 1400))
            out.save(ALIGNDIR / f"{mid}-{key}.jpg", quality=80)

        co_path.write_text(json.dumps(co, ensure_ascii=False, indent=1), encoding="utf-8")

    (ALIGNDIR / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    bad = {k: v for k, v in report.items()
           if v.get("score", 1) < MIN_SCORE or "error" in v or "note" in v}
    print(json.dumps(bad, ensure_ascii=False, indent=1) if bad else "全部层对齐良好")


if __name__ == "__main__":
    main()
