# RichTextEditor

表单和邮件共用此受控 Tiptap 组件。扩展定义位于 `rich-text-extensions.ts`，工具栏位于 `RichTextToolbar.tsx`，新增编辑能力应在公共层维护。聊天输入框属于独立的结构化消息输入场景。

`value` 接收结构化文档、字符串或 `null`，`inputFormat` 支持 `json`（默认）、`html`、`text`。纯文本会按字面插入，不会被解释为 HTML。`null` 或空字符串清空内容，外部回填不会触发 `onChange`。`json` 输入应传文档对象；字符串形式的 JSON 不会自动解析。

`outputFormat` 控制 `onChange` 类型：`json`（默认）输出文档，`html` 或 `text` 输出字符串，`all` 输出 `{ json, html, text }`。不要把纯文本输出回填为富文本输入，否则会丢失格式。

```tsx
// 表单保持已有 JSON 存储协议。
<RichTextEditor ariaLabel="内容" value={document} onChange={setDocument} />

// 邮件同时取得 HTML 和纯文本；清空 body.html 即清空编辑器。
<RichTextEditor
  ariaLabel="正文"
  value={body.html}
  inputFormat="html"
  outputFormat="all"
  onChange={({ html, text }) => setBody({ html, text })}
/>
```

`disabled`、`readOnly` 控制编辑权限；`showToolbar` 控制工具栏可见性，`preview` 在不可编辑时展示禁用工具栏。`placeholder`、`className`、`contentClassName` 分别控制提示、容器和编辑区布局。修改 placeholder 会重建编辑器，应使用稳定的提示内容。

公共能力包括标题、字体/字号、文字/背景颜色、高亮、常见文字格式、列表/任务列表、对齐、引用、代码、分割线、链接、图片 URL、表格、表情、撤销重做。图片和链接插入面板只接受 HTTP/HTTPS 地址。图片支持缩放，表格支持列宽调整、增删行列、合并/拆分单元格及表头切换。本组件不负责文件上传，也不对任意邮件客户端的样式兼容作转换。

输出 HTML 是正文片段。外部邮件 HTML 的清理、CID 图片处理与 iframe 隔离继续由邮件阅读器负责；不要用编辑器替代邮件阅读器。
