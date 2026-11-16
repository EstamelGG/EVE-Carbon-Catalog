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
<script type="module" src="https://eve.vanquisher.online/eve-model-viewer.js"></script>
<eve-model-viewer model-index="https://carbon-models.vanquisher.online/res/model-index.json" dna="af1_t1:sarum:amarr" style="display:block;height:60vh"></eve-model-viewer>
```

每页只需加载一次组件 JS。每个实例通过 `model-index` 指定索引，JavaScript 用法为 `viewer.configure({ itemId: 587, modelIndex: "https://carbon-models.vanquisher.online/res/model-index.json" })`。相对索引地址以嵌入页面为基准，索引内的 `res/` 路径以索引所在目录为基准。后续局部更新沿用该实例的地址。跨域部署时，组件和资源站均需允许嵌入页面的来源。

组件使用 v3 索引， 按需读取物品目录、模型详情及选中舰体和阵营的配方。升级资源站前，先发布新版组件。

组件从发布索引查找物品 ID 和 DNA，加载已发布模型或 DNA 配方。战略巡洋舰按所选子系统加载部件并组装船体。

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
