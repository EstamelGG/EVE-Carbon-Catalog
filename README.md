# EVE 物品图鉴

运行 `.\start.ps1`，打开 http://127.0.0.1:8795/ 。启动器调用同级 EVE-Carbon-Renderer 仓库的本地资源服务。可用 -Renderer、-Published、-Cache、-Addon 和 -Port 指定位置。前端代码只需要同源的 eve-model-viewer.js 和组件服务。

catalog.json 保存分类、组、物品的编号和双语名称，以及物品的 SOF DNA。运行 `py -3 import_catalog.py PATH_TO_PUBLISHED_DIST` 可刷新目录。树、搜索及物品详情通过 TypeID 导航（例如 #item=85236）；渲染仅向组件传入 DNA。没有 SOF DNA 的物品显示目录详情。
