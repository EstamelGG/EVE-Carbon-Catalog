# EVE 物品图鉴

运行 `.\start.ps1` 后打开 http://127.0.0.1:8795/ 。可用 -Renderer、-Published、-Cache、-Addon 和 -Port 指定位置。

public 中的图鉴页面、卡片、目录树、详情弹窗、使用指南、样式、字体和图标取自第一代 EVE-Model-Viewer-2 提交 717c11021e9f0b041ee68356bf2d80d285615417。site-config.json 使用同源资源。组件文件由同级 EVE-Carbon-Renderer 提供。详情页统一传 item-id。组件通过发布目录解析 DNA；详情中的 DNA 和同船体变体也读取同一份发布数据。独立调用组件仍可直接指定 dna。

public/catalog.json 保存分类、组、物品的编号和双语名称，不另存 DNA。运行 `py -3 import_catalog.py PATH_TO_PUBLISHED_DIST` 可刷新。卡片预览、可用状态及阵营等展示信息来自已有发布索引。
