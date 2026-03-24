# js-reverse-mcp 反检测工作记录

[English](anti-detection-work.en.md) | 中文

## 背景

js-reverse-mcp 是一个基于 Node.js 的 MCP Server，使用 Patchright (Node.js) 控制 Chrome 浏览器，为 AI 编码助手提供 DevTools 调试能力。

在测试中发现，访问知乎专栏 `https://zhuanlan.zhihu.com/p/1930714592423703026` 时被拦截，返回 `{"error":{"code":40362,"message":"您当前请求存在异常，暂时限制本次访问"}}`。

而另一个 Python 项目 Scrapling 使用 Patchright (Python) + 相似的启动参数配置，可以正常打开同一页面。

## 根因定位

### 验证方法：控制变量法

编写了独立测试脚本 `test_raw_patchright.mjs`，使用与 MCP 完全相同的 Patchright Node.js + STEALTH_ARGS，但不加载 MCP 框架层。结果：**独立脚本可以正常打开知乎和 Google**。

这证明：

- **不是** Patchright Node.js vs Python 的差异
- **不是** 浏览器指纹问题（两者指纹完全一致）
- **问题 100% 出在 MCP 框架层**

### 根因 1：导航期间的 CDP 泄露（知乎拦截）

MCP 框架在导航工具调用时，会在 `page.goto()` 前后执行多个涉及 CDP 的操作：

1. **`detectOpenDevToolsWindows()`** — 遍历所有页面，对 devtools:// 页面创建 CDP session 并调用 `Target.getTargetInfo`
2. **`createPagesSnapshot()`** — 内部调用 `detectOpenDevToolsWindows()`
3. **`waitForEventsAfterAction()`**（已修复） — 创建额外 CDP session 监听 `Page.frameStartedNavigating`

这些 CDP 活动在页面导航过程中被知乎的 JS 质询脚本检测到。

### 根因 2：持久化 user-data-dir 被污染（知乎拦截）

之前多次被拦截的记录积累了风控标记（Cookie/Cache/LocalStorage 中的设备 ID 和信誉数据）。清除 `~/.cache/chrome-devtools-mcp/chrome-profile` 后配合 CDP 修复解决。

### 根因 3：JS init script 反而导致检测（Google reCAPTCHA）

编写了 `src/stealth-init.ts` 试图通过 JS 注入修复以下泄露：

- `Error.stack` 含 `UtilityScript` → 覆盖 `Error.prepareStackTrace`
- `chrome.runtime` / `chrome.app` 缺失 → 伪造对象
- `screen.availHeight` 等于 `screen.height` → `Object.defineProperty` 覆盖
- `Notification.permission` 异常 → 覆盖

**结果：这些 JS patch 弄巧成拙，被 Google 的反爬系统检测到了。**

反爬系统的检测手段包括：

- 检查 `Object.getOwnPropertyDescriptor` 返回的是 getter 还是 data property（真实 Chrome 的 screen 属性是 data property，不是 getter）
- 检查函数的 `.toString()` 是否包含 `[native code]`（伪造的函数无法通过）
- 检查 `Error.prepareStackTrace` 是否被覆盖

**关键验证**：

1. 独立脚本（无 init script）→ Google 搜索正常 ✅
2. MCP + init script → Google 触发 "unusual traffic" ❌
3. MCP 删除 init script → Google 搜索正常 ✅
4. 上述测试均使用 `launchPersistentContext`，排除了启动方式的影响

**结论：Scrapling 也不使用 init script，完全依赖 Patchright C++ patch + 启动参数。JS 层面的反检测 patch 不可靠。**

## 已完成的修复

### 1. 基础反检测对齐

与 Scrapling 对齐的基础配置：

| 层级                | 说明                                              | 状态 |
| ------------------- | ------------------------------------------------- | ---- |
| Patchright 引擎     | 使用 patchright v1.51.1 / patchright-core v1.58.2 | ✅   |
| 启动参数            | 60+ STEALTH_ARGS，与 Scrapling 一致               | ✅   |
| HARMFUL_ARGS 移除   | --enable-automation 等 5 个参数                   | ✅   |
| 上下文伪装          | dark 主题、isMobile=false、hasTouch=false         | ✅   |
| navigator.webdriver | Patchright C++ patch 生效，值为 false             | ✅   |
| bot 检测站测试      | sannysoft.com 全部 passed                         | ✅   |

相关文件：

- `src/stealth-args.ts` — 启动参数定义（HARMFUL_ARGS / DEFAULT_ARGS / STEALTH_ARGS）
- `src/browser.ts` — 浏览器启动/连接逻辑

### 2. Google Referer 伪装

**文件：** `src/tools/pages.ts`

Scrapling 每次 `page.goto()` 都带 `referer: 'https://www.google.com/'`，模拟从 Google 搜索点击进入。

修改内容：

- `new_page` 工具：`page.goto(url, { referer: 'https://www.google.com/' })`
- `navigate_page` 工具（type=url）：同上

### 3. viewport 使用真实尺寸

**文件：** `src/browser.ts`, `src/stealth-args.ts`

- `viewport: null` 禁用 Playwright 的 viewport 模拟，让 OS 原生管理窗口大小
- 添加 `--window-size=1920,1080` 启动参数
- `deviceScaleFactor` / `screen` 仅在用户显式指定 `--viewport` 时设置
- 暴露真实 Mac 分辨率（1512x982、colorDepth 30、DPR 2）

### 4. CDP 域延迟初始化（关键修复）

**文件：** `src/McpContext.ts`, `src/main.ts`

Patchright 的防检测核心之一是**静默 CDP**。但 MCP Server 原来在启动时立即启用了多个 CDP 域：

| Collector          | CDP 域                           | 原来的初始化时机   |
| ------------------ | -------------------------------- | ------------------ |
| DebuggerContext    | `Debugger.enable`                | McpContext.#init() |
| NetworkCollector   | `Network.requestWillBeSent` 监听 | init() → addPage() |
| ConsoleCollector   | `Audits.enable`                  | init() → addPage() |
| WebSocketCollector | Network.webSocket\* 监听         | init() → addPage() |

**修复：**

- `McpContext.#init()` 不再立即初始化 collectors
- 新增 `ensureCollectorsInitialized()` 方法，延迟到首次非导航工具调用时执行
- `main.ts` 中：`ToolCategory.NAVIGATION` 类别工具不触发 collectors 初始化
- `reinitDebugger()` / `reinitDebuggerForFrame()` 在 collectors 未初始化时跳过
- `newPage()` 在 collectors 未初始化时不注册收集器

### 5. 导航工具完全静默化（关键修复）

**文件：** `src/tools/pages.ts`, `src/main.ts`, `src/McpContext.ts`

发现即使延迟了 collectors，导航工具调用链中仍有 CDP 泄露：

| 泄露点                        | 位置                 | CDP 行为                                                     |
| ----------------------------- | -------------------- | ------------------------------------------------------------ |
| `waitForEventsAfterAction()`  | pages.ts handler     | 创建 CDP session + 监听 `Page.frameStartedNavigating`        |
| `detectOpenDevToolsWindows()` | main.ts 每次工具调用 | 对 devtools:// 页面创建 CDP session + `Target.getTargetInfo` |
| `createPagesSnapshot()`       | McpResponse.handle() | 内部调用 `detectOpenDevToolsWindows()`                       |

**修复：**

- `new_page` / `navigate_page` 不再使用 `waitForEventsAfterAction()`，直接 `page.goto()`
- `main.ts` 中导航工具跳过 `detectOpenDevToolsWindows()`
- `createPagesSnapshot()` 在 collectors 未初始化时跳过 `detectOpenDevToolsWindows()`

**修复后导航工具的 CDP 时间线：**

```
1. getContext() — McpContext.#init() 只做 createPagesSnapshot()（无 CDP session）
2. 跳过 detectOpenDevToolsWindows() ✅
3. 跳过 ensureCollectorsInitialized() ✅
4. context.newPage() — 纯 Playwright API
5. page.goto() — 纯导航，无额外 CDP
6. response.handle() → createPagesSnapshot()（不调用 detectOpenDevToolsWindows） ✅
```

**核心原则：先导航到目标页、通过风控 → 然后再激活 CDP 域进行逆向调试。**

### 6. 删除 JS init script（关键修复）

**删除文件：** `src/stealth-init.ts`

JS 层面的反检测 patch 被 Google 反爬系统检测到，导致触发 "unusual traffic" 拦截。

具体删除的 patch：

- `Error.prepareStackTrace` 覆盖（过滤 UtilityScript）
- 伪造 `chrome.runtime` / `chrome.app` 对象
- `Object.defineProperty` 覆盖 `screen.availHeight` / `screen.availTop`
- `Object.defineProperty` 覆盖 `window.outerHeight` / `window.outerWidth`
- `Notification.permission` 覆盖
- `navigator.connection` 属性覆盖

同时删除了 `--initScript` CLI 参数。

**教训：不要在 JS 层面做反检测 patch，让 Patchright C++ patch + 启动参数处理一切。**

### 7. Notification 权限修复

**文件：** `src/browser.ts`

添加 `'notifications'` 到 permissions 数组，使 `Notification.permission` 从 `"denied"` 变为 `"granted"`。

## 当前状态

**知乎 ✅ 已通过** — 页面正常加载，无 40362 错误。

**Google ✅ 已通过** — 首页正常加载，手动搜索正常返回结果，无 reCAPTCHA。

## 已知残留泄露点

这些泄露在 Scrapling（Python Patchright）中也同样存在，不影响通过主流反爬检测：

| 检测项                           | 当前值 | 期望值       | 说明                                            |
| -------------------------------- | ------ | ------------ | ----------------------------------------------- |
| `Error.stack` 含 `UtilityScript` | 存在   | 不应出现     | Patchright 执行上下文泄露，仅在 evaluate 时可见 |
| `chrome.runtime`                 | 缺失   | 应有完整对象 | Patchright C++ 层未完全模拟                     |
| `chrome.app`                     | 缺失   | 应有完整对象 | 同上                                            |

**注意：不要尝试用 JS init script 修复这些泄露，会适得其反。**

## 使用注意事项

### 反检测站点的请求捕获

为了通过反爬检测，导航工具（`new_page`、`navigate_page`）在执行时不会激活 CDP 收集器（Network/Console/WebSocket/Debugger）。这意味着页面初始加载期间的请求、console 消息、WebSocket 连接和 JS 脚本列表不会被捕获。

**推荐工作流：先导航，再刷新**

1. 使用 `new_page` 或 `navigate_page` 导航到目标页（此时通过风控，但不捕获请求）
2. 调用任意非导航工具（如 `evaluate_script`、`list_network_requests`）触发 CDP 收集器初始化
3. 使用 `navigate_page` 的 `reload` 功能刷新页面
4. 此时所有请求、console 消息、脚本等都会被完整捕获

```
# Step 1: 导航到目标页（静默模式，通过风控）
new_page(url="https://example.com")

# Step 2: 任意非导航工具调用，触发 collectors 初始化
list_network_requests()  # 返回为空，但 collectors 已启动

# Step 3: 刷新页面，完整捕获所有请求
navigate_page(type="reload")

# Step 4: 现在可以看到完整的请求列表
list_network_requests()  # 返回所有请求
```

## 文件变更清单

| 文件                      | 修改类型   | 说明                                                                               |
| ------------------------- | ---------- | ---------------------------------------------------------------------------------- |
| `src/tools/pages.ts`      | 修改       | 添加 Google Referer；移除 waitForEventsAfterAction                                 |
| `src/browser.ts`          | 修改       | viewport: null + 条件性 DPR；添加 notifications 权限                               |
| `src/stealth-args.ts`     | 修改       | 添加 --window-size=1920,1080                                                       |
| `src/McpContext.ts`       | 修改       | 延迟 CDP collectors 初始化；createPagesSnapshot 条件跳过 detectOpenDevToolsWindows |
| `src/main.ts`             | 修改       | 导航工具完全跳过 CDP 相关操作；删除 init script 相关逻辑                           |
| `src/stealth-init.ts`     | **已删除** | JS init script 导致 Google 检测，已移除                                            |
| `src/cli.ts`              | 修改       | 移除 --initScript CLI 参数                                                         |
| `test_raw_patchright.mjs` | 新增       | 独立测试脚本，验证原始 Patchright 可过知乎                                         |
| `test_zhihu_search.mjs`   | 新增       | Google 搜索测试脚本，验证无 init script 可过 Google                                |
