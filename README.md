# R6 地图报点 (r6map)

彩虹六号:围攻全官方地图的中文报点查询站。纯静态、零后端、零框架,数据即文件,欢迎共创。

- **27 张官方地图**(截至 2026-09 赛季),20 张含完整中英文报点,其余暂为官方蓝图
- 蓝图大图行内浏览:滚轮缩放、拖拽平移、双击复位
- 标注模式(工具栏"标注"按钮):单击落点、双击命名(中英文)、拖拽微调、一键导出 JSON——用于采集报点坐标,数据暂存浏览器本地
- 每层报点列表(中文主显、英文副显)
- 全站中/英一键切换(右上角),未翻译报点在中文模式下隐藏
- 预渲染纯 HTML,无接口请求,响应极快;可部署到任何静态托管

## 本地运行

```bash
pip install -r requirements.txt
python tools/build.py                # 构建 → site/
python -m http.server -d site 8021   # 预览 http://127.0.0.1:8021
```

## 数据约定(共创入口)

所有数据都是人可直接编辑的 JSON,改完跑 `python tools/build.py` 重新构建即可。

| 文件 | 作用 |
|---|---|
| `data/floors.json` | 地图索引:名称中英、官方蓝图 zip 地址、楼层 key 列表(顺序 = zip 内图片序号)、`ui` 界面文案节 |
| `data/callouts/<map>.json` | 每图一个报点文件,格式见下 |
| `data/images/maps/<map>/<floor>.jpg` | 楼层蓝图原图(由工具下载入库) |
| `data/sources.json` | 维护用:zip 哈希、抓取时间,不参与渲染 |

报点文件格式(键只有 `en`/`zh`,没有其他字段;`zh` 缺失即中文模式隐藏):

```json
{
  "1F": [
    { "en": "Open Space", "zh": "开放区" },
    { "en": "CCTV", "zh": "监控室" }
  ],
  "outdoor": [
    { "en": "Parking Lot", "zh": "停车场" }
  ]
}
```

- 楼层 key:`subB` / `B` / `1F` / `2F` / `3F` / `4F` / `R`,外加特殊组 `outdoor`(室外报点)
- 新增一张地图:在 `floors.json` 加条目(zip 地址 + 楼层),跑 `python tools/fetch_blueprints.py`,再新建对应 `callouts/<map>.json`
- 译名以社区通用叫法为准(金库、柜台、台球室……),有争议欢迎提 PR 讨论
- **地图命名与界面文案统一在 `floors.json`**(`name_en`/`name_zh` 与 `ui` 节),模板不硬编码;想改文案改一处即可
- 采集报点坐标:打开地图页 → 点工具栏"标注" → 单击图上落点 → 双击标注点命名(中/英) → 拖拽微调 → 右下角导出 JSON,把 `x/y/en/zh` 合并进对应 `callouts/<map>.json` 的条目即可(未来版本会用坐标在图上渲染报点点位)

## 与官方保持同步(每赛季维护 SOP)

地图变更频率很低(每年约 1-2 张新图 + 1-2 次重做),按下面流程走一遍即可:

1. `python tools/fetch_blueprints.py --check`:对比官方蓝图 zip 哈希;输出"有更新"即地图被重做
2. 官方索引出现新地图时:在 `floors.json` 加条目(楼层顺序对着官方 zip 里的图目视确认一遍)→ 跑完整模式下载入库
3. 重做的地图:蓝图自动换新;报点文字表需人工在 `callouts/<map>.json` 里核对增删
4. `python tools/build.py` 重建,提交

> 蓝图 zip 的 URL 不完全规律(如 `consulate-blueprints_may23.zip`、新图无连字符),发现 404 时到官方地图页
> `ubisoft.com/.../game-info/maps/<slug>` 页面源码里找真实 zip 文件名。

## 目录结构

```
├── data/            # 全部数据(JSON + 蓝图原图)
├── templates/       # Jinja2 模板(base / index / map)
├── static/          # style.css + app.js(原生 JS,无依赖)
├── tools/
│   ├── fetch_blueprints.py   # 官方蓝图下载/更新检查
│   ├── import_r6calls.py     # 从 r6calls(MIT)导入英文报点
│   ├── apply_translations.py # 译名词典合并进 callouts
│   └── build.py              # 校验 + 图片优化 + 预渲染 → site/
└── site/            # 构建产物(纯静态,可直接部署)
```

## 已知事项

- Villa 官方 zip 内有 5 张图但仅 4 层,其中 1 张(全黑俯视图)楼层归属存疑,暂未展示(`floors.json` 的 `excluded_imgs` 有记录)
- 报点英文数据源自 [DudeKiller82/r6calls](https://github.com/DudeKiller82/r6calls)(MIT);个别拼写错误(Haker→Hacker 等)已修正
- 蓝图图片 © Ubisoft Entertainment,本站为非商业社区用途
