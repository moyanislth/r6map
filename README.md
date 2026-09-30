# R6 地图报点 (r6map)

彩虹六号:围攻全官方地图的中文报点查询站。报点以「点位 + 名称」直接标注在育碧官方蓝图上,纯静态、零后端、零框架。

- 27 张官方地图,20 张已收录约 938 条中英文报点(92% 带精确坐标上图)
- 全站中/英切换;个人标注存浏览器本地,可导出分享
- 预渲染纯 HTML,可部署到 GitHub Pages 等任何静态托管(仓库自带 Actions 工作流)

**在线预览(本地)**:`python tools/build.py` 后 `python -m http.server -d site 8021` 打开 `http://127.0.0.1:8021`

---

## 🤝 贡献指南(重点)

本项目的一切内容贡献都归结为一件事:**修改 `data/` 下的 JSON 文件,然后重新构建**。不需要搭环境、不需要懂前端。

### 0. 你可以贡献什么

| 场景 | 你要做的 |
|---|---|
| 改译名(如"开放区"→"大厅区") | 改 `data/callouts/<地图>.json` 里对应条目的 `zh` |
| 补一条漏掉的报点 | 同文件对应楼层加一个条目(含坐标,见下) |
| 修正报点位置 | 微调该条目的 `x` / `y` |
| 新地图收录 | `floors.json` 加地图 + `callouts/` 加文件(见"新地图"节) |
| 改界面文案 | `data/floors.json` 的 `ui` 节 |

### 1. 核心数据在哪

```
data/
├── floors.json              # ★ 地图总索引(唯一需要"注册"的地方)
├── callouts/<map>.json      # ★ 报点数据,每图一个文件
├── images/maps/<map>/<楼层>.jpg   # 官方蓝图(勿手改,由工具生成)
├── align_fixups.json        # 坐标对齐人工修正(一般不动)
└── sources.json             # 工具维护记录(勿手改)
```

**改报点只需要碰 `data/callouts/<map>.json`**;加新地图才需要动 `floors.json`。

### 2. 报点文件格式

`data/callouts/bank.json` 示例(键 = 楼层,值为条目数组):

```json
{
  "B": [
    { "id": "bank.B.1a2b3c4d5e", "en": "Vault", "zh": "金库", "x": 0.3598, "y": 0.704 }
  ],
  "1F": [
    { "id": "bank.1F.6bfdaa4b68", "en": "Printer", "zh": "打印室", "x": 0.632, "y": 0.7211 }
  ]
}
```

字段说明:

| 字段 | 必填 | 说明 |
|---|---|---|
| `en` | ✅ | 英文报点名(游戏内叫法),同图同层内唯一 |
| `zh` | ✅ | 中文译名;留空字符串则中文模式下不显示该条 |
| `x`, `y` | 推荐 | 蓝图上的归一化坐标(0~1,左上角为原点);缺省则该条不上图 |
| `id` | ➖ | 稳定标识,构建脚本按 `地图.楼层.en` 自动补齐;手工新增时**可以不写** |

楼层 key 只有 7 种:`subB`(地下二层)/ `B`(地下一层)/ `1F` / `2F` / `3F` / `4F`。**没有屋顶和室外**——项目刻意不收录。

> **找坐标最简单的方法**:打开网站上对应地图,双击你想标注的位置(会生成一个橙色标注),右下角 ⚙ → 设置 → 导出,把 JSON 里该点的 `x`/`y` 抄进你的条目即可。

### 3. 提交流程

```bash
git clone <repo> && cd r6map
# 编辑 data/callouts/<map>.json
pip install -r requirements.txt
python tools/build.py        # 构建期自动校验格式,错误会明确指出文件和条目
python -m http.server -d site 8021   # 本地看一眼效果
git checkout -b fix/chalet-typos && git commit -m "..." && git push
# 发 PR
```

构建校验会拦截:未知楼层 key、缺 `en`/`id`、地图中文名重复、楼层图缺失。校验不过构建失败,不会静默上线坏数据。

### 4. 新增一张地图(维护者/进阶贡献者)

1. 官方蓝图:查 [育碧地图页](https://www.ubisoft.com/en-us/game/rainbow-six/siege/game-info/maps) 页面源码里的 `r6-maps-*.zip` 链接(注意部分图带 `_may23` 这类后缀、部分无连字符),在 `floors.json` 的 `maps` 里注册:zip 地址 + `floors` 楼层列表(**顺序 = zip 内图片序号**,需打开 zip 目视确认哪张是哪层)
2. `python tools/fetch_blueprints.py` 下载解压入库
3. 新建 `data/callouts/<map>.json`,照上面格式填报点(坐标可先用网站双击法采集)
4. `python tools/build.py` → 预览 → PR

## 🛠 工具链(全部可重跑)

| 命令 | 作用 | 什么时候跑 |
|---|---|---|
| `python tools/build.py` | 校验 + 预渲染 → `site/` | 每次改数据后 |
| `python tools/fetch_blueprints.py` | 下载官方蓝图 zip 入库 | 新图/重做时 |
| `python tools/fetch_blueprints.py --check` | 对比官方 zip 哈希 | **每赛季**,检测地图重做 |
| `python tools/import_r6calls.py` | 从 [r6calls](https://github.com/DudeKiller82/r6calls)(MIT)导入英文报点名 | 新图收录时 |
| `python tools/align_coords.py` | SIFT 图像对齐 → 自动写入 `x/y`;验证叠加图在 `.cache/align/` | import 之后 |
| `python tools/slim_data.py` | 数据迁移(幂等) | 仅结构性调整时 |

## 📅 每赛季维护 SOP

彩六每年约 1-2 张新图 + 1-2 次地图重做:

1. 跑 `fetch_blueprints.py --check`:哈希变化 = 官方蓝图更新
2. 官方地图页出现新图 → 按"新增一张地图"流程走
3. 重做的图:蓝图自动换新;对应 `callouts/<map>.json` 人工核对报点增删
4. 重建 + PR

## 📐 架构一句话

`data/*.json`(唯一数据源)→ `tools/build.py`(校验+预渲染)→ `site/`(纯静态)。前端逻辑在 `static/app.js`(原生 JS ~330 行:语言切换、缩放平移、标注覆盖层、设置面板),样式 `static/style.css`,模板 `templates/`。设计决策与历史踩坑见 [docs/OPTIMIZATION.md](docs/OPTIMIZATION.md)。

## ⚖️ 版权与致谢

- 地图蓝图图片 © 2015-2026 Ubisoft Entertainment,本站为非商业社区用途
- 英文报点数据基于 [DudeKiller82/r6calls](https://github.com/DudeKiller82/r6calls)(MIT),特此致谢
