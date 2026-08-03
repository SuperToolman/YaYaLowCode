# 通讯模块开发与部署说明

## 能力范围

通讯模块以签名许可证作为启用边界。未激活时不会在启动阶段创建通讯数据表，通讯 API 返回禁止访问，前端只显示未激活状态；激活后立即创建表并开放单聊、群聊、历史消息、已读、撤回、重新编辑、表情、附件、聊天内邮件和 WebSocket 实时事件。

## 激活许可证

API 服务读取 `COMMUNICATION_LICENSE_PUBLIC_KEY_PEM` 中的 RSA 公钥，并使用 RS256 校验 JWT。许可证载荷必须包含：

```json
{
  "license_id": "customer-license-id",
  "modules": ["communication"],
  "exp": 1893456000
}
```

管理员以 `settings.agent` 权限调用 `POST /api/settings/communication`，请求体为 `{ "license": "<signed-jwt>" }`。激活结果写入 `YAYA_COMMUNICATION_MODULE_SETTINGS_PATH`（默认 `.yaya-communication-module.json`），包括许可证编号和有效期。`GET /api/settings/communication` 可读取当前状态。许可证过期后模块守卫会立即拒绝请求，但不会删除业务数据。

## 权限与入口

- 设置入口：`/settings/communication`，需要 `settings.agent`。
- 消息入口：`/messages`，需要 `communication.access`。
- 系统管理员的 `*` 权限自动包含以上权限。
- 普通角色需在“设置 -> 权限”中显式勾选“访问通讯”。

## 接口

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/communication/users` | 可发起会话的用户目录 |
| `GET` | `/api/communication/conversations` | 会话与未读数 |
| `POST` | `/api/communication/conversations/direct` | 创建或复用单聊 |
| `POST` | `/api/communication/conversations/groups` | 创建群聊 |
| `PUT` | `/api/communication/conversations/{id}` | 群主修改名称、添加或移除现有系统用户 |
| `POST` | `/api/communication/conversations/{id}/owner` | 群主转让给现有成员 |
| `POST` | `/api/communication/conversations/{id}/leave` | 普通成员主动退出群聊 |
| `DELETE` | `/api/communication/conversations/{id}/dissolve` | 群主解散群聊 |
| `GET/POST` | `/api/communication/conversations/{id}/messages` | 历史消息/发送消息 |
| `POST` | `/api/communication/conversations/{id}/messages/{messageId}/recall` | 两分钟内撤回本人消息 |
| `POST` | `/api/communication/conversations/{id}/messages/{messageId}/reedit` | 重新编辑本人已撤回消息 |
| `POST` | `/api/communication/conversations/{id}/read` | 更新已读序号 |
| `GET` | `/api/communication/ws` | 实时事件连接 |

所有 REST DTO 都通过 `utoipa::ToSchema` 进入 OpenAPI，并由 HeyAPI 生成 `web/app/lib/api-client`。修改接口后运行：

```powershell
pnpm codegen:api
```

## 文件与实时连接

附件先上传到 `/api/files/upload`，再将返回的 `fileId` 随消息发送。下载只允许上传者或附件所在会话的成员。默认单文件上限为 20 MB，存储目录由 `YAYA_UPLOAD_DIR` 控制。

浏览器连接 `/api/communication/ws` 时使用子协议 `['yaya-chat', accessToken]`，避免把令牌放进 URL。跨主机部署时设置前端构建变量 `NEXT_PUBLIC_BACKEND_WS_URL=wss://api.example.com/api/communication/ws`。单实例使用进程内广播；多 API 实例部署必须将事件总线替换为 Redis Pub/Sub、NATS 或 Kafka，否则事件只能到达同一实例上的连接。

## 性能与扩展建议

- 消息使用会话内递增序号游标分页，禁止 offset 深分页；当前单次最多 100 条。
- `clientMessageId` 用于客户端重试幂等，生产端应保留唯一约束。
- 附件内容与数据库元数据分离。大规模部署建议切换 S3/OSS，并使用短期签名下载 URL。
- WebSocket 网关、消息持久化和离线通知应逐步拆分；事件携带会话 ID，由服务端做成员过滤。
- 大群和高并发场景应缓存成员关系，避免每个实时事件查询数据库。
- 实际外发邮件应采用 Outbox + 异步工作进程；当前“邮件”是聊天记录中的结构化消息，不调用 SMTP。

## 卸载边界

当前版本不提供删除模块代码或自动清表。许可证失效只关闭入口和 API，保留数据便于续期恢复。若未来增加卸载功能，应将“停用”“导出归档”“永久清理”设计为三个独立且可审计的管理员操作。
