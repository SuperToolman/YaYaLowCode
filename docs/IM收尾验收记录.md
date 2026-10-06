# IM 收尾验收记录

## 执行范围

- 数据库：本机 `yaya_low_code`，未连接生产数据库。
- 备份：`im-before-migration.dump`，custom format，约 20 MB。
- 演练方式：备份、执行 071、校验；根据最新决策，最终保留迁移后的 `im_*` 存储，不再恢复迁移前版本。

## 已完成

- 消息页历史分页统一通过 `ImClientAdapter`，移除旧 HTTP history fallback。
- 普通消息发送统一通过 adapter，页面等待 WebSocket 事件确认。
- 审批卡片提交携带 `taskUuid`、卡片版本和 `messageId`。
- 迁移增加旧表字段存在性和关键 UUID/int8 类型检查。
- 修复迁移事件查询中的 `created_at` 字段歧义。
- 迁移成功后校验消息、成员、附件、会话序号和 mailbox 序号。
- 当前本地库仍处于迁移前状态，等待权限修复后直接执行 071 并保留迁移结果。

## 迁移演练结果

修复后的 071 迁移结果：

| 项目 | 结果 |
| --- | --- |
| 新 IM 表创建 | 通过 |
| 旧消息数 19 -> 新消息数 19 | 通过 |
| 旧成员数 8 -> 新成员数 8 | 通过 |
| 旧附件数 1 -> 新附件数 1 | 通过 |
| 会话序号连续性 | 通过 |
| mailbox 序号连续性 | 通过 |
| system message / approval binding | 当前库无 workflow notification 样例，未产生数据，未做业务样例验证 |
| 旧表删除 | 迁移成功时通过 |
| 备份恢复 | 通过 |

## 自动化验证

- `cargo check`：通过，保留仓库既有 warning。
- `pnpm exec tsc --noEmit`：通过。
- `pnpm test -- --run`：通过，11 个文件、43 个测试。
- `git diff --check`：通过。

## 未完成项

- 未执行生产迁移。
- 本地数据没有审批通知样例，因此审批结果收件人端到端验证未完成。
- 尚未完成真实浏览器双窗口、断网重连、历史滚动锚点和审批卡片联调。
- 本阶段未构造额外业务数据，避免污染本地业务库。

## 收尾演练补充（2026-09-29）

- `cargo test --no-run`：通过，测试二进制成功生成。
- 误恢复到本机 `postgres` 数据库的 4 张 `communication_*` 表和 4 张 `im_*` 表已确认存在，但对象归属为数据库管理员 `postgres`；当前应用账号 `yaya` 无权删除，未强行修改管理员对象。`yaya_low_code` 未受此残留影响。
- 使用当前 `yaya_low_code` 启动 API 时，发现本地演练恢复保留了 `public` schema 的管理员归属，应用账号没有 `CREATE` 权限，API 在迁移初始化前退出。这是本地数据库权限问题；需要以 PostgreSQL 管理员执行 `GRANT USAGE, CREATE ON SCHEMA public TO yaya` 后，直接执行 071 并保留最新迁移结果。
- 浏览器双窗口、断线重连、cursor reset、历史滚动锚点和审批卡片端到端联调因此未完成；没有用伪造数据替代真实业务验证。
- 生产数据库未连接，未执行生产迁移、旧表删除或数据切换。
