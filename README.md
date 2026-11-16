# EVE-Carbon-Catalog

`public/` 保存图鉴网页、字体和图标。[renderer/](renderer/) 保存渲染组件的源码、资源和工具。组件构建输出到 `renderer/model-catalog/dist/`，完整站点输出到根目录 `dist/`。两个输出目录都由 Git 忽略。

## Cloudflare Pages 与 SDE 更新

在 Cloudflare Pages 使用仓库根目录、构建命令 `npm run build` 和输出目录 `dist`。构建需要 Node.js 22、npm 和 Python 3（命令 `python3`）。每次构建读取 CCP Tranquility 的 `latest.jsonl`，下载对应版本的 JSONL 压缩包，核对包内版本，按 Builder 的图形资源条件生成中英文目录。构建使用的版本写在 `dist/site-config.json` 的 `sdeBuild` 中。下载或解析失败时构建会失败。

GitHub 的 **Check Tranquility SDE** 工作流每天北京时间 21:00 检查版本，也支持手动运行。只有官方版本号增大时才向 `main` 提交 `sde-version.txt`，由 Cloudflare Pages 的 Git 集成触发构建。如果项目配置了构建监听路径，需包含此文件。

## GitHub Pages 发布

首次发布时，在 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。每次推送到 `main`，**Publish Catalog** 都会构建当前提交的 Renderer，并将组件、纹理解码器和图鉴一起发布。也可以手动运行该工作流。

在 **Settings → Secrets and variables → Actions → Variables** 设置模型预览使用的发布地址：

- `RESOURCE_BASE_URL` 指向 Builder 产出的资源站根目录，其下应能访问 `res/model-index.json`。
- 用户可在图鉴右上角的「设置」中选择语言，并覆盖模型索引 URL。填写 `model-index.json` 的完整地址，留空恢复部署默认值。该设置保存在当前浏览器，组件指南和 demo 也使用它。
- `RENDERER_MODULE_URL` 默认留空，图鉴使用本次构建的组件。需要外部组件时才填写其完整 URL。

修改变量后重新运行工作流即可生效。省略资源站变量时，图鉴默认读取 `https://carbon-models.vanquisher.online/res/model-index.json`。使用独立域名时，资源和 ES 模块需允许来自 Pages 站点的跨域请求。

## 本地构建和预览

默认光照、材质参数和按 DNA 匹配的预设定义在 `renderer/model-catalog/src/render-settings.mjs`。修改后重新构建并发布渲染器即可生效。

高频共享资源按 `renderer/model-catalog/scripts/page-cache-resources.json` 中的 `pathKeywords` 路径关键词规则按需常驻页面缓存。切换物品或关闭模型窗口会保留这些资源的纹理、数据和共享特效几何；刷新或关闭网页后释放。其他资源仍随模型会话清理。匹配忽略路径大小写，仅检查 URL 路径，不匹配域名或查询参数。缓存区分完整 URL、版本查询参数及纹理采样选项，不预加载命中目录；只在首次使用时缓存。

安装 Node.js 22、npm 和 PowerShell 7 后运行 `./build.ps1`。脚本按锁文件安装 Renderer 依赖并构建完整站点。指定模型资源地址的示例为 `./build.ps1 -ResourceBaseURL https://assets.example.org/`。

单独发布 Renderer 时，在 Actions 中手动运行 **Release Renderer** 并输入新标签。Release 包含组件 JS 和可独立部署的完整 ZIP。[组件构建和使用说明](renderer/README.md)

本地预览可用 `./start.ps1`，支持同样的 URL 参数以及 `-Port`。目录和搜索读取构建时从 SDE 生成的 `dist/catalog.json`。预览状态读取资源站的 `res/model-index.json`，打开模型时才加载渲染组件。
