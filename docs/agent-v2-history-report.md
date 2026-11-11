# 会话历史、滚动与状态修复

日期：2026-11-02。

## 行为

- 切换会话后默认读取最近 20 轮完整对话，按时间正序展示，并定位内容底部。每轮包含用户消息和已持久化的员工回复，不从中间切断一轮。
- 更早消息不随首次读取返回。向上滚动后点击“查看更早的消息”，按独占 `before` 游标读取上一页；前插内容保持当前阅读位置。加载失败可以重试，切换会话后忽略旧请求结果。
- 位于底部时跟随新回复；用户上滚阅读后停止自动拉到底部。禁用浏览器默认滚动锚定，避免与手动前插补偿叠加。
- 每条消息带所属 run 的持久状态。已完成、失败、取消为不可逆终态，旧的 started/delta 事件不能把它改回“正在回复”。历史轮次不借用整个会话最新任务的状态。
- 消息页、该页任务事件及 `event_cursor` 在一条 PostgreSQL 查询的同一快照中返回。页面恢复后 SSE 从该游标续读，原生重连继续使用 Last-Event-ID；不从零重放全部历史。已终结任务不重放流式正文，使用已保存消息。
- 发送或终态事件刷新最近页时合并已加载历史，不丢弃用户手动读出的旧页；加载旧页不改变实时订阅游标。

## 合同与权限

`GET /api/agent/v2/sessions/{session_id}/messages?before=<queue_seq>`：固定每页最多 20 轮，`items` 正序；返回 `next_before`（无旧页时 null）、`event_cursor`、`events`，消息增加 `run_status`。继续沿用当前部署、用户、员工、许可证及会话归属校验。OpenAPI、生成 SDK 与前端同步。无新增迁移，不修改历史业务消息。

## 验证

- `scripts/check-agent-v2.ps1 -UseLocalDevelopmentDatabase -Offline -DesignOnly` 通过。随机 PostgreSQL schema 验证 25 轮分页、用户/员工回复配对、终态、流式正文过滤、事件接续游标、分页期间追加新任务不重复/漏掉旧页、跨用户拒绝。原有设计与确认回归继续通过。
- AgentV2 / 页面 / BFF 8 个测试文件、40 个用例通过；新增终态重放、显式读取旧页、SSE 起点、初次底部定位、前插位置保持及上滚停止跟随测试。日志 `agent-v2/target/history-web-tests.log`、`history-database.log`。
- 定向 ESLint、HTTP 边界及 Rust workspace 格式检查通过。全站样式边界检查被既有 messages CSS Module 命名和 globals.css button-group 选择器阻断，本批未新增 CSS Module。
- 全站 TypeScript 检查仍被既有 `MyTable.test.tsx:66` 的 children 类型不匹配阻断，本批文件未报告类型错误。
- 未完成真实登录浏览器验收；当前浏览器标签是连接失败错误页，访问该标签被浏览器 URL 策略拒绝。未绕过策略操作浏览器，也未重启当前运行的 API。后端合同需重启开发服务后生效，开发中前后端应一起更新。

## 回退

回退 API 与前端代码即可，不需要数据回滚，不删除消息或文件，不创建旧内容备份。
