# R6 地图报点 (r6map)

彩虹六号:围攻全官方地图的中文报点查询站。报点直接标注在官方蓝图上,纯静态、零后端、零框架,数据即文件,欢迎共创。

- **27 张官方地图**,20 张含完整中文报点,报点以「点位 + 名称小字」直接渲染在蓝图对应位置(870/938 条有坐标)
- 交互:滚轮缩放;**放大后**拖拽平移;单击显示坐标;**双击**添加/编辑标注;拖拽标注微调位置
- 报点分两种:文件数据点(蓝色,来自 `data/callouts/`,共同维护)与个人标注(橙色,存浏览器本地)
- 右下角 ⚙ 设置:导出/导入个人标注(JSON)、清空本图标注
- 全站中/英切换,预渲染纯 HTML,可部署任何静态托管

## 本地运行

```bash
pip install -r requirements.txt
python tools/build.py                # 构建 → site/
python -m http.server -d site 8021   # 预览 http://127.0.0.1:8021
```

## 数据约定(共创入口)

| 文件 | 作用 |
|---|---|
| `data/floors.json` | 地图索引:名称中英、官方蓝图 zip 地址、楼层 key(顺序 = zip 内图片序号)、`ui` 界面文案节 |
| `data/callouts/<map>.json` | 每图报点:按楼层分组,条目为 `{id, en, zh, x?, y?}` |
| `data/images/maps/<map>/<floor>.jpg` | 楼层蓝图原图(高清直出) |
| `data/align_fixups.json` | 坐标对齐的人工修正表(可选) |
| `data/sources.json` | 维护用:zip 哈希、抓取时间 |

- 楼层 key:`subB` / `B` / `1F` / `2F` / `3F` / `4F`(屋顶与室外数据已移除)
- 坐标 `x/y` 为官方蓝图上的归一化值(0-1),由 `tools/align_coords.py` 自动对齐(SIFT 特征匹配)生成;领事馆(r6calls 源图是重做前旧版)暂无坐标
- `id` 稳定派生自 地图|楼层|英文名,改名不失效;个人覆盖层(浏览器本地)按 id 记录改名/移位/删除,可通过设置面板导出分享
- **命名与文案单一来源**:全部在 `floors.json`;改完跑 `python tools/build.py`

## 工具链

```
tools/fetch_blueprints.py    # 官方蓝图下载/哈希更新检查(每赛季)
tools/import_r6calls.py      # 从 r6calls(MIT)导入英文报点(无坐标)
tools/align_coords.py        # SIFT 图像对齐 → 写入 x/y;产出验证叠加图
tools/slim_data.py           # 一次性数据迁移(幂等)
tools/apply_translations.py  # 译名词典合并
tools/build.py               # 校验 + 图片优化 + 预渲染 → site/
```

## 每赛季维护 SOP

1. `python tools/fetch_blueprints.py --check` 对哈希;有更新 = 地图重做
2. 新图:在 `floors.json` 加条目 → 完整模式下载 → r6calls 若已收录,跑 import + align;否则人工标注
3. 重做地图:蓝图自动更新;`align_coords.py` 重跑并对叠加图(`.cache/align/`)目检
4. `python tools/build.py` 重建,提交

## 已知限制

- 领事馆 3 层报点暂无坐标(r6calls 源图是重做前旧版),后续人工标注补齐
- 约 68 条报点(如各图楼梯重复命名)对齐时出界被丢弃,图上暂缺
- 移动端双指缩放待办;Villa 官方 zip 一张存疑图已排除(见 `floors.json` `_note`)
- 蓝图图片 © Ubisoft Entertainment,非商业社区用途;报点数据基于 [r6calls](https://github.com/DudeKiller82/r6calls)(MIT)
