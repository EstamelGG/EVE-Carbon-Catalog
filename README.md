# EVE-Carbon-Catalog

`public/` 保存图鉴网页、字体和图标。[renderer/](renderer/) 保存渲染组件的源码、资源和工具。组件构建输出到 `renderer/model-catalog/dist/`，完整站点输出到根目录 `dist/`。两个输出目录都由 Git 忽略。

## 构建与数据来源

在 Cloudflare Pages 使用仓库根目录、构建命令 `npm run build` 和输出目录 `dist`。构建需要 Node.js 22、npm 和 Python 3（命令 `python3`）。构建只做静态组装：打包渲染组件、替换站点品牌文案、写入发布时间。仓库不再下载 SDE，也不再生成物品清单。

图鉴的物品目录、可用性、缩略图归属全部来自 Builder 发布在资源站上的 `res/index/catalog.json`（`categories`、`items`、`renderFallbacks`）。因此更新物品数据只需重新构建并上传资源，不必重新发布站点。`public/icons/identities.json` 只保留势力名称；物品的 `metaGroupID`、`factionID` 随目录分片一起下发。势力优先采用 SDE `factionID`；缺失或为 NPC 公司 ID 时，依次回退到 DNA 第二段阵营标记和 SDE `raceID`。渲染器和图鉴都根据解析后的 `factionID` 拼接 `res/icons/factions/<factionID>.png`，由模型索引所在的资源站提供图标；无势力物品则在线加载 `https://images.evetech.net/types/<TypeID>/icon?size=64`。

## GitHub Pages 发布

首次发布时，在 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。每次推送到 `main`，**Publish Catalog** 都会构建当前提交的 Renderer，并将组件、纹理解码器和图鉴一起发布。也可以手动运行该工作流。

在 **Settings → Secrets and variables → Actions → Variables** 设置模型预览使用的发布地址：

- `RESOURCE_BASE_URL` 指向 Builder 产出的资源站根目录，其下应能访问 `res/model-index.json`。
- 用户可在图鉴右上角的「设置」中选择语言，并覆盖模型索引 URL。填写 `model-index.json` 的完整地址，留空恢复部署默认值。该设置保存在当前浏览器，组件指南和 demo 也使用它。
- `RENDERER_MODULE_URL` 默认留空，图鉴使用本次构建的组件。需要外部组件时才填写其完整 URL。

修改变量后重新运行工作流即可生效。省略资源站变量时，图鉴默认读取 `https://carbon-models.vanquisher.online/res/model-index.json`。使用独立域名时，资源和 ES 模块需允许来自 Pages 站点的跨域请求。

## 本地构建和预览

默认光照、材质参数和按 DNA 匹配的预设定义在 `renderer/model-catalog/src/render-settings.mjs`。修改后重新构建并发布渲染器即可生效。

## iOS Metal Demo

`ios/EVEHullDemo/` 是一个独立的 SwiftUI + MetalKit 技术 Demo，目标是验证原生 Metal 消费现有 GLB 和 KTX2 资产。它直接读取打包进 App 的原始战列舰、护卫舰、太空舱和航母 GLB，不修改模型格式；材质 JSON 由现有 `assembleDNA` 生成，KTX2 在运行时通过 Basis Universal 转成 Metal 纹理。当前已接入 albedo、normal、roughness、material mask、dirt、paint mask、glow、DDS 反射/漫反射 cubemap IBL、GPU skinning、动画通道、方向光阴影、初版 booster 火焰、sprite/spotlight 光点以及 HDR bloom；尚未接入完整 authored effects、机库、SSAO/DOF/TAA 和完整后期处理。

```sh
cd ios/EVEHullDemo
xcodegen generate
open EVEHullDemo.xcodeproj
```

详细限制和构建命令见 `ios/EVEHullDemo/README.md`。

高频共享资源按 `renderer/model-catalog/scripts/page-cache-resources.json` 中的 `pathKeywords` 路径关键词规则按需常驻页面缓存。切换物品或关闭模型窗口会保留这些资源的纹理、数据和共享特效几何；刷新或关闭网页后释放。其他资源仍随模型会话清理。匹配忽略路径大小写，仅检查 URL 路径，不匹配域名或查询参数。缓存区分完整 URL、版本查询参数及纹理采样选项，不预加载命中目录；只在首次使用时缓存。

安装 Node.js 22、npm 和 PowerShell 7 后运行 `./build.ps1`。脚本按锁文件安装 Renderer 依赖并构建完整站点。指定模型资源地址的示例为 `./build.ps1 -ResourceBaseURL https://assets.example.org/`。

单独发布 Renderer 时，在 Actions 中手动运行 **Release Renderer** 并输入新标签。Release 包含组件 JS 和可独立部署的完整 ZIP。[组件构建和使用说明](renderer/README.md)

本地预览可用 `./start.ps1`，支持同样的 URL 参数以及 `-Port`。目录、搜索与可用性都来自资源站 `res/model-index.json` 指向的 `catalog` 分片（必填，索引缺此字段即视为格式不兼容）：`categories` 给出分类 → 组 → 物品 `[TypeID, en, zh, metaGroupID?, factionID?]`，中英文名与 ID 检索都用这份数据；`items` 列出可用物品，`renderFallbacks` 记录 TypeID → 缩略图归属 TypeID，缩略图地址由 `res/renders/<id>.png` 拼接；没有记录的物品回退到 `images.evetech.net`。渲染组件在首屏渲染后后台预加载，打开模型时只请求该物品自己的 `res/index/items/<TypeID>.json`。
