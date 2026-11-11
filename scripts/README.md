# 仓库辅助脚本

本目录的 Node.js 工具拥有独立的 `package.json`、`package-lock.json` 和 `node_modules/`，统一使用 npm 管理依赖。仓库根目录不作为 Node.js 包；`web/`、`yaya-website/` 等项目分别管理自己的依赖。

在仓库根目录执行：

```powershell
npm --prefix scripts ci --ignore-scripts
npm --prefix scripts run test:package
npm --prefix scripts run package:platform
```

也可以进入 `scripts/` 后执行 `npm ci --ignore-scripts` 和相应的 `npm run` 命令。`archiver` 用于生成离线 ZIP，`jszip` 仅供测试读取并校验 ZIP 内容。

平台打包的要求和参数见 [平台打包文档](../docs/platform-packaging.md)。PowerShell 入口仍为 `./scripts/package-platform.ps1`，需先安装本目录依赖。
