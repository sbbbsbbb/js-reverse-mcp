# JS Reverse MCP

JavaScript 逆向工程 MCP 服务器，让你的 AI 编码助手（如 Claude、Cursor、Copilot）能够调试和分析网页中的 JavaScript 代码。

基于 [Patchright](https://github.com/nicecaesar/patchright) 反检测引擎，内置多层反爬绕过能力，可在知乎、Google 等有风控检测的站点正常工作。

## 功能特点

- **反检测浏览器**: 基于 Patchright（Playwright 反检测分支），60+ 隐身启动参数，绕过主流反爬系统
- **脚本分析**: 列出所有加载的 JS 脚本，搜索代码，获取源码
- **断点调试**: 设置/移除断点，支持条件断点，支持在压缩代码中精确定位
- **函数追踪**: Hook 任意函数（包括模块内部函数），监控调用和返回值
- **执行控制**: 暂停/恢复执行，单步调试（step over/into/out）
- **运行时检查**: 在断点处求值表达式，检查作用域变量
- **网络分析**: 查看请求发起的调用栈，设置 XHR 断点，WebSocket 消息分析
- **事件监控**: 监控 DOM 事件，检查存储数据

## 系统要求

- [Node.js](https://nodejs.org/) v20.19 或更新版本
- [Chrome](https://www.google.com/chrome/) 稳定版
- Git

## 本地安装

```bash
# 克隆仓库
git clone https://github.com/nicecaesar/js-reverse-mcp.git
cd js-reverse-mcp

# 安装依赖
npm install

# 构建项目
npm run build
```

## MCP 客户端配置

在你的 MCP 客户端配置文件中添加：

```json
{
  "mcpServers": {
    "js-reverse": {
      "command": "node",
      "args": ["/你的路径/js-reverse-mcp/build/src/index.js"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add js-reverse node /你的路径/js-reverse-mcp/build/src/index.js
```

### Cursor

进入 `Cursor Settings` -> `MCP` -> `New MCP Server`，使用上面的配置。

### VS Code Copilot

```bash
code --add-mcp '{"name":"js-reverse","command":"node","args":["/你的路径/js-reverse-mcp/build/src/index.js"]}'
```

## 反检测机制

js-reverse-mcp 内置了多层反检测措施，确保在有风控检测的站点上正常工作：

### 反检测架构

| 层级 | 说明 |
|------|------|
| Patchright 引擎 | C++ 层反检测 patch，移除 `navigator.webdriver`、避免 `Runtime.enable` 等泄露 |
| 60+ 隐身启动参数 | 移除自动化特征、绕过无头检测、GPU/网络/行为特征伪装 |
| 有害参数移除 | 排除 `--enable-automation` 等 5 个 Playwright 默认参数 |
| CDP 静默导航 | 导航工具执行时不激活任何 CDP 域，避免被反爬脚本检测到调试协议活动 |
| Google Referer 伪装 | 所有导航自动带 `referer: https://www.google.com/` |
| 持久化登录态 | 默认使用持久化 user-data-dir，登录状态跨会话保留 |

### 反检测站点的请求捕获

为了通过反爬检测，导航工具（`new_page`、`navigate_page`）在执行时不会激活 CDP 收集器（Network/Console/WebSocket/Debugger）。这意味着页面初始加载期间的请求不会被捕获。

**推荐工作流：先导航，再刷新**

1. 使用 `new_page` 导航到目标页（静默模式，通过风控）
2. 调用任意非导航工具（如 `list_network_requests`）触发 CDP 收集器初始化
3. 使用 `navigate_page(type="reload")` 刷新页面
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

## 工具列表

### 脚本分析

| 工具                | 描述                                                 |
| ------------------- | ---------------------------------------------------- |
| `list_scripts`      | 列出页面中所有加载的 JavaScript 脚本                 |
| `get_script_source` | 获取脚本源码，支持行范围或字符偏移（适用于压缩文件） |
| `find_in_script`    | 在脚本中查找文本，返回精确的行号和列号               |
| `search_in_sources` | 在所有脚本中搜索字符串或正则表达式                   |

### 断点管理

| 工具                     | 描述                                           |
| ------------------------ | ---------------------------------------------- |
| `set_breakpoint`         | 在指定 URL 和行号设置断点                      |
| `set_breakpoint_on_text` | 通过搜索代码文本自动设置断点（适用于压缩代码） |
| `remove_breakpoint`      | 移除断点                                       |
| `list_breakpoints`       | 列出所有活动断点                               |

### 调试控制

| 工具                    | 描述                             |
| ----------------------- | -------------------------------- |
| `get_paused_info`       | 获取暂停状态、调用栈和作用域变量 |
| `resume`                | 恢复执行                         |
| `pause`                 | 暂停执行                         |
| `step_over`             | 单步跳过                         |
| `step_into`             | 单步进入                         |
| `step_out`              | 单步跳出                         |
| `evaluate_on_callframe` | 在暂停的调用帧上下文中求值表达式 |

### 函数 Hook

| 工具              | 描述                                                   |
| ----------------- | ------------------------------------------------------ |
| `hook_function`   | Hook 全局函数或对象方法，记录调用和返回值              |
| `unhook_function` | 移除函数 Hook                                          |
| `list_hooks`      | 列出所有活动的 Hook                                    |
| `trace_function`  | 追踪任意函数调用（包括模块内部函数），使用条件断点实现 |

### 网络调试

| 工具                            | 描述                             |
| ------------------------------- | -------------------------------- |
| `list_network_requests`         | 列出网络请求                     |
| `get_network_request`           | 获取请求详情和响应内容           |
| `get_request_initiator`         | 获取网络请求的 JavaScript 调用栈 |
| `break_on_xhr`                  | 设置 XHR/Fetch 断点              |
| `remove_xhr_breakpoint`         | 移除 XHR 断点                    |
| `list_websocket_connections`    | 列出 WebSocket 连接              |
| `get_websocket_messages`        | 获取 WebSocket 消息              |
| `analyze_websocket_messages`    | 分析 WebSocket 消息模式          |

### 检查工具

| 工具                    | 描述                                       |
| ----------------------- | ------------------------------------------ |
| `evaluate_script`       | 在页面中执行 JavaScript                    |
| `inspect_object`        | 深度检查 JavaScript 对象结构               |
| `get_storage`           | 获取 cookies、localStorage、sessionStorage |
| `monitor_events`        | 监控元素或 window 上的 DOM 事件            |
| `stop_monitor`          | 停止事件监控                               |
| `list_console_messages` | 获取控制台消息                             |
| `get_console_message`   | 获取控制台消息详情                         |

### 页面管理

| 工具              | 描述                       |
| ----------------- | -------------------------- |
| `list_pages`      | 列出浏览器中打开的页面     |
| `select_page`     | 选择一个页面作为调试上下文 |
| `new_page`        | 创建新页面并导航到 URL     |
| `navigate_page`   | 导航、后退、前进或刷新页面 |
| `list_frames`     | 列出页面中的所有 frame     |
| `select_frame`    | 选择 frame 作为执行上下文  |
| `take_screenshot`  | 截取页面截图              |

## 使用示例

### JS 逆向基本流程

1. **打开目标页面**

```
打开 https://example.com 并列出所有加载的 JS 脚本
```

2. **查找目标函数**

```
在所有脚本中搜索包含 "encrypt" 的代码
```

3. **设置断点**

```
在加密函数入口处设置断点
```

4. **触发并分析**

```
在页面上触发操作，断点命中后检查参数、调用栈和作用域变量
```

### Hook 加密函数

```
Hook fetch 函数，记录所有 API 调用的参数和返回值
```

### 追踪模块内部函数

```
使用 trace_function 追踪 webpack 打包的内部函数 "encryptData"，
无需设置断点即可查看每次调用的参数
```

### WebSocket 协议分析

```
列出 WebSocket 连接，分析消息模式，查看特定类型的消息内容
```

## 配置选项

| 选项                   | 描述                                   | 默认值  |
| ---------------------- | -------------------------------------- | ------- |
| `--browserUrl, -u`     | 连接到运行中的 Chrome 实例             | -       |
| `--wsEndpoint, -w`     | WebSocket 端点连接                     | -       |
| `--headless`           | 无头模式运行                           | false   |
| `--executablePath, -e` | 自定义 Chrome 路径                     | -       |
| `--isolated`           | 使用临时用户数据目录（每次全新）       | false   |
| `--channel`            | Chrome 通道: stable, canary, beta, dev | stable  |
| `--viewport`           | 初始视口大小，如 `1280x720`            | 真实尺寸 |
| `--hideCanvas`         | 启用 Canvas 指纹加噪                  | false   |
| `--blockWebrtc`        | 阻止 WebRTC 泄露真实 IP               | false   |
| `--disableWebgl`       | 禁用 WebGL 防止 GPU 指纹              | false   |
| `--noStealth`          | 禁用隐身启动参数（调试用）             | false   |
| `--initScript`         | 自定义 JS 注入脚本路径                 | -       |
| `--proxyServer`        | 代理服务器配置                         | -       |
| `--logFile`            | 调试日志文件路径                       | -       |

### 示例配置

**基础使用（推荐）：**

```json
{
  "mcpServers": {
    "js-reverse": {
      "command": "node",
      "args": [
        "/你的路径/js-reverse-mcp/build/src/index.js",
        "--headless=false"
      ]
    }
  }
}
```

**增强反检测（Canvas 加噪 + WebRTC 阻止）：**

```json
{
  "mcpServers": {
    "js-reverse": {
      "command": "node",
      "args": [
        "/你的路径/js-reverse-mcp/build/src/index.js",
        "--headless=false",
        "--hideCanvas",
        "--blockWebrtc"
      ]
    }
  }
}
```

**临时隔离模式（不保留登录态，每次全新 profile）：**

```json
{
  "mcpServers": {
    "js-reverse": {
      "command": "node",
      "args": [
        "/你的路径/js-reverse-mcp/build/src/index.js",
        "--headless=false",
        "--isolated"
      ]
    }
  }
}
```

### 连接到已运行的 Chrome

1. 启动 Chrome（需要关闭所有 Chrome 窗口后重新启动）：

**macOS**

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug
```

**Windows**

```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%TEMP%\chrome-debug"
```

2. 配置 MCP 连接：

```json
{
  "mcpServers": {
    "js-reverse": {
      "command": "node",
      "args": [
        "/你的路径/js-reverse-mcp/build/src/index.js",
        "--browser-url=http://127.0.0.1:9222"
      ]
    }
  }
}
```

## 故障排除

### 被反爬系统拦截

如果访问某些站点被拦截（如知乎返回 40362 错误）：

1. **清除污染的 profile**：删除 `~/.cache/chrome-devtools-mcp/chrome-profile` 目录
2. **使用隔离模式**：添加 `--isolated` 参数启动
3. **启用 Canvas 加噪**：添加 `--hideCanvas` 参数

### 页面加载时的请求丢失

参见上方「反检测站点的请求捕获」部分，使用「先导航，再刷新」的工作流。

## 安全提示

此工具会将浏览器内容暴露给 MCP 客户端，允许检查、调试和修改浏览器中的任何数据。请勿在包含敏感信息的页面上使用。

## 许可证

Apache-2.0
