# 平台离线镜像部署包

在项目根使用 Node.js 24 和 Docker Buildx。打包工具是 `scripts/` 下的独立 Node.js 包，配置、锁文件和依赖均放在该目录；根目录不安装 Node.js 依赖：

```powershell
npm --prefix scripts ci --ignore-scripts
npm --prefix scripts run package:platform
# 或 ./scripts/package-platform.ps1
npm --prefix scripts run test:package
```

构建单一 Linux 架构镜像 → 临时容器验证 API /healthz 和 Web /login → docker image save → 完整 ZIP。发布不推送仓库、不要求登录。首次构建仍需下载基础镜像和依赖；客户部署只需上传包并由运营平台 docker load。

输出 dist/releases/<版本>-<UUID>.zip，版本直接复用 /settings/about 的 CHANGELOG 解析函数。ZIP 包含 manifest.json + 完整 image.tar，清单记录镜像 ID、唯一标签、架构、归档大小和 SHA-256，格式为 v3 / offline-image。原源码包和仓库引用清单不再支持。

默认 linux/amd64，通过 --platform 或 YAYA_PLATFORM_IMAGE_PLATFORM 指定 linux/arm64；目标 Docker 架构必须匹配。通过 --output 自定义输出目录，默认 dist/releases 已被 Git 忽略。Docker CLI 可用 DOCKER_CLI 指定，Windows 自动检测用户目录安装的 Docker Desktop。

```powershell
npm --prefix scripts run package:platform -- --output E:/artifacts/yaya --platform linux/amd64
```

使用当前工作树及 deploy/Dockerfile.single 构建；正式发布前审核源码、确认 .dockerignore 排除环境文件、私钥和数据库，记录发布提交。客户密码在运营平台配置，不应构建到镜像中。导出 ZIP 不包含客户数据卷。健康检查或导出失败不生成可发布 ZIP，临时容器和导出文件自动清理。

ZIP 使用 ZIP64、流式计算和压缩。运营端 ZIP 上传上限 8 GiB，镜像归档展开上限 16 GiB；发布机器需为 tar+ZIP 准备空间。客户运营服务临时盘需容纳展开 tar，Docker 数据盘需容纳导入镜像，网络代理需放宽上传体积与超时。当前无断点续传和增量包。

客户流程：运营平台上传新 ZIP → 新建实例选择客户与版本 → 填写域名、容器名、端口、环境变量 → 创建并部署。部署重新验证摘要，docker load 后核对 ID/架构，以 --pull never 创建容器并检查健康状态。无需镜像仓库配置。短信、模型等业务外部服务仍可能需要网络。

验证记录：脚本单测与 Rust ZIP 契约已通过；本机已有 hello-world 镜像真实完成 save/ZIP/API 上传下载/load。完整低代码平台构建尝试在 DockerHub 基础镜像下载阶段超时，尚未生成正式平台 ZIP 或完成客户平台启动验收。


离线镜像环境变量：打包完成构建及自检后，从该镜像的 `docker image inspect` / `Config.Env` 记录 `KEY=value` 数组到 `manifest.json` 的 `image.environment`。这份快照与版本包一起保存，供运营平台选择版本包后动态生成环境变量输入行；不读取源码 `.env`，也不记录临时自检容器的随机密钥。已有旧包需重新打包上传才携带快照。
