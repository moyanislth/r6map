"""tools 共享常量与工具函数。"""
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def pin_id(mid: str, floor: str, en: str) -> str:
    """报点稳定 id:sha1(地图|楼层|英文名) 前 10 位。"""
    h = hashlib.sha1(f"{mid}|{floor}|{en}".encode("utf-8")).hexdigest()[:10]
    return f"{mid}.{floor}.{h}"
