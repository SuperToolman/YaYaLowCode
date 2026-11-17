# 开发环境离线镜像打包

## 使用入口

在 `E:\OverPorject\yaya-low-code\web` 以 `pnpm dev` 启动开发页面。使用系统管理员登录，在 `/settings/about` 点击“打包离线镜像”。该入口与对应 Next API 只在 `NODE_ENV=development` 时开放，正式客户镜像不开放打包功能。

模态框读取与关于页面相同的 `CHANGELOG.md` 版本解析器，并展示输出目录、离线 ZIP 结构、目标 Linux 架构、环境变量声明及默认值、数据卷和容器端口。默认 `linux/amd64`，ARM 服务器可选 `linux/arm64`。版本和部署清单在提交与后台启动时再次核对，防止确认后修改文件却误用旧配置。

环境需要 Node.js 24+、`scripts/` 下已安装的依赖、Docker Linux Engine 与 Buildx。Windows 可使用 Docker Desktop 的 Linux 容器模式。环境不就绪时显示具体检查结果，可启动 Docker 后重新检查。构建所需基础镜像及依赖可能仍需联网下载；生成的包无需推送到镜像仓库。

Windows 打包脚本会在每次调用 Docker 前读取当前用户已启用的系统 HTTP(S) 代理，传给 Docker CLI 的 `HTTP_PROXY` / `HTTPS_PROXY`，使 Buildx 在宿主机发起的镜像认证请求也能使用代理。手工设置的进程代理环境变量优先；不修改全局环境或 Docker Desktop 设置，也不将代理写入离线包。Docker Desktop 自身仍须使用有效的系统或手动代理，负责 Engine 的镜像网络访问。仅使用 PAC 自动配置而未设置系统静态代理时，可显式配置进程的 `HTTPS_PROXY`。

## 环境变量与数据

`deploy/platform-runtime.json` 是部署配置来源。打包会将其变量名、必填标记、默认值、Web/API 端口和数据卷声明写入 `manifest.json`，并合并实际构建镜像 `Config.Env` 的变量；镜像本身也保留自己的 `ENV`。模态框展示的是打包前可确认的部署声明，镜像自动附带的运行时变量在构建后读取。

不会读取开发机 `.env` 的实际密码或密钥作为发布默认值；客户实例的数据库密码、签名密钥、域名等在运营平台部署时配置。数据卷声明随包发布，开发机数据库和已有卷内容不进入包。需要调整通用默认值、变量或挂载目录时，修改 `deploy/platform-runtime.json` 后重新检查并确认打包。

## 任务与输出

按钮调用现有 `scripts/package-platform.mjs` 的发布实现：Docker Buildx 构建 → 临时容器 Web/API 启动检查 → 镜像 inspect/save → SHA-256 → ZIP64。原有 `scripts/package-platform.ps1` 和命令行发布方式保持可用。

成功产物位于 `dist/releases/<版本>-<UUID>.zip`，只有 `manifest.json` 和 `image.tar`，可直接下载并上传至运营平台“平台版本管理”。失败不发布 ZIP，临时归档与 `.partial` 文件由原发布脚本清理。

打包由独立 Node 后台进程执行，关闭弹窗、刷新页面或 Next HMR 不主动终止任务。弹窗每 2 秒查询状态，并展示最近 64 KiB 构建日志与具体错误；重新打开时恢复最近任务。任务文件与日志保存在 `dist/releases/.jobs/`，同一开发平台最多执行一个页面打包任务；进程异常退出后会标记任务中断，下次可重新开始。结束任务和产物不会自动删除，可在不打包时自行清理旧记录。

## 接口边界

Next 开发工具接口为 `/api/settings/platform-package`、`/:id`、`/:id/download`。每次请求由 Rust 验证当前登录令牌、账号状态及系统管理员角色（`*`），不信任前端隐藏按钮或自行解码的 JWT。启动还验证同源 Origin，确认请求限制为 4 KiB，只接受版本、Linux 架构和部署清单摘要。输出目录和执行脚本固定，不接受客户端 Shell 命令或文件路径。下载流式返回 ZIP。

同源校验使用请求实际 `Host`（含端口），避免 Next 开发服务器将 `request.url` 归一为 `localhost` 后误拦截通过 `127.0.0.1` 或局域网地址访问的请求。不同来源、不同端口、缺少 Origin 及明确 cross-site 的请求仍被拒绝；不使用客户端传入的 `x-forwarded-host` 放行。2026-11-12 已在实际开发服务复现并修复该误拦截，补充对应回归测试。

## 本次验证（2026-11-12）

- 打包脚本测试 7 项通过，覆盖完整 ZIP/清单与环境变量合并、阶段回报、版本/部署清单变化拒绝、后台进程失败落盘和释放锁、导出失败清理。
- 页面与服务测试 6 项通过，覆盖确认架构与部署配置、Docker 不可用、任务恢复、生产环境隐藏、未登录及非管理员拒绝、同源校验、请求体限制和中断恢复。
- TypeScript、变更文件 ESLint、HTTP/结构/样式边界检查通过；真实开发接口未登录返回 401。
- 本机实际执行 Docker/Buildx 环境检查成功。使用 Chromium 对真实 Next 页面和 HeroUI 模态框完成环境变量、卷/端口 Tab、提交配置、任务进度的检查；该轮浏览器检查模拟 API 响应，没有创建实际打包任务。
- 本轮没有重新构建完整低代码镜像或生成新的正式 ZIP；完整构建由用户确认弹窗后执行，复用既有已实现的离线发布流程。
