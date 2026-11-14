# EVE Carbon Renderer

组件迁自 EVE-Carbon-Renderer（提交 `f06ece7` 及本地构建脚本更改）。源码位于 `model-catalog/scripts/` 和 `model-catalog/src/`。构建只向 `model-catalog/dist/` 输出文件。模块清单及内容指纹位于 `docs/line-audit/renderer-origins.json`。

在 `renderer/model-catalog/` 运行：

```sh
npm ci
npm run check:origins
npm run build
```

推送 Catalog 的 `main` 会自动构建组件并随图鉴发布到 Pages。在 Actions 中手动运行 **Release Renderer**，输入新标签，可以另行发布组件 JS 和完整 ZIP。独立部署时将 ZIP 解压到同一目录，保留组件旁的 `vendor/basis/` 纹理解码器。

## 按 DNA 使用

```html
<script type="module" src="./eve-model-viewer.js"></script>
<eve-model-viewer dna="af1_t1:sarum:amarr" style="display:block;height:60vh"></eve-model-viewer>
```

传入 `item-id` 时，组件从物品记录取得 DNA，再通过 `POST api/dna-hulls` 加载模型。对已发布物品，请求同时携带物品 ID，用于在共用 DNA 的型号之间保留正确的物品信息和特效。直接传入 `dna` 使用同一接口。战略巡洋舰按所选子系统的 DNA 加载各部件，再组装船体。

服务从发布目录建立物品 ID 和 DNA 索引。没有游戏 DNA 的已发布装备使用 `published:<renderKey>` 查询已有模型（旧记录缺少 renderKey 时用物品 ID）。这种标识只用于查找发布资源。对于游戏 DNA，服务优先复用已发布模型，再按 DNA 和修订检查生成缓存，缺失时由 Blender 读取 SharedCache 生成模型和特效。

Windows 本机启动示例（在 renderer/ 目录执行）：

```powershell
py -3 model-catalog/scripts/serve_dna_hulls.py --cache E:/EVE/SharedCache --published .work/published --frontend ../public --addon ../../upstream/carbonenginejs/tools-blender
```

发布目录包含 assets/ 与 data/，可独立部署；本机副本放在 .work/published。新产物写入 .work/dna-public。构建需要 Windows Python 3、Blender 5.0、tools-blender 及匹配 Blender Python 3.11 的 Pillow 11.3.0。可用 `py -3 -m pip install --target model-catalog/.deps/python311 --platform win_amd64 --python-version 3.11 --only-binary=:all: Pillow==11.3.0` 安装图像解码器。渲染器及图鉴运行均无需原生参考程序。

## 608 和 85236 的分级船体资源

在 Renderer 根目录运行以下命令，再启动或重启本地 DNA 服务。最后一个参数是 Khronos KTX CLI 的路径。转换工具使用同级 Viewer 的离线格式读取器、已展开的 res 目录和已发布的材质配方。浏览器只从 Renderer 服务获取清单和生成物。

```powershell
node tools/build-streamed-hulls.mjs ../../EVE-Carbon-Viewer E:/EVE-Viewer-assets/res .work/published .work/dna-public ktx
```

单船预览和机库内的飞船均直接加载完整船体和带完整 mip 链的高清纹理。资源清单保留其他 LOD 供离线使用。运行以下命令生成机库环境专用的简化网格和最长边 1024 像素的表面贴图（Python 3 需安装 Pillow）。机库加载期间可继续操作当前视图。

```sh
node tools/build-hangar-detail.mjs .work/published .work/dna-public python
```
