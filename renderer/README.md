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

组件使用 v4 索引，按 TypeID 读取默认 DNA，并按需读取舰体、阵营、种族、材质、图案和布局组成数据。外观参数与布局实例由组件在运行时计算。升级资源站前，先发布新版组件。
