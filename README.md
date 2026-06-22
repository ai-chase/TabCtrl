<div align="center">

<img src="extension/icons/icon128.png" alt="TabCtrl logo" width="96" height="96">

# TabCtrl

**When tab overload becomes the norm, TabCtrl brings you back to clarity.**

> 当标签页过载成为日常，TabCtrl 帮你回到清晰。

A Chrome / Edge / Brave new-tab replacement that shows every open tab,
grouped by domain, with one-click stash, close history, and undo.

替换 Chrome / Edge / Brave 新标签页，按域名分组所有打开的标签页，
支持一键暂存、关闭历史与撤销关闭。

<br>

<!-- BADGES — replace Chrome Web Store badge once published -->
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](#tech-stack)
[![Version](https://img.shields.io/badge/version-1.0.0-blue)](#)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](#contributing)
[![No Backend](https://img.shields.io/badge/backend-none-9cf)](#privacy)

[**English**](#english) · [**中文**](#中文)

</div>

---

<a name="english"></a>

## 🇬🇧 English

### Why TabCtrl?

Most tab managers force you to choose: kill tabs you might need,
or drown in a hundred-tab strip. **TabCtrl keeps them all open, but
makes them visible and reachable from the new tab page itself.**

- See every open tab grouped by site, not as a flat list
- Stash tabs you want to come back to (with scroll position saved)
- Reopen anything you closed in the last 1–30 days
- 100% local. No account, no server, no telemetry

### Table of Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [Privacy](#privacy)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Tech Stack](#tech-stack)
- [Contributing](#contributing)
- [License](#license)

### Features

#### 1. Open Tabs — "Right now"

The new tab page becomes a live dashboard of every open tab,
**grouped by domain**.

| Action | How |
|---|---|
| Switch to a tab | Click the tab title |
| Close a single tab | Click the **×** on the tab card |
| Close an entire site | Click **"Close N tabs"** on the site card |
| Deduplicate duplicates | One click collapses all tabs pointing to the same URL |
| Stash a tab | Click the bookmark icon to save for later |
| Add to Chrome Bookmarks | Click the star icon |

**Grouping modes (configurable in Settings):**
- **By main domain** — `mail.google.com` and `docs.google.com` group under `google.com`
- **By full hostname** — subdomains stay separate
- **With path subgroups** — GitHub renders as `owner/repo`, YouTube as `@channel`

#### 2. Tab Stash

Save tabs you want to come back to. They keep their title, favicon, and—
importantly—**the exact scroll position you left them at**, so reopening
feels like you never left.

- Custom categories (e.g. *Reading*, *Projects*, *Shopping*)
- Drag-and-drop cards between categories
- Search across stashed tabs
- Stashing the same page multiple times increments a counter;
  click to see the history of that page

#### 3. Close History

Every tab close is recorded automatically.

- Default 7-day retention (configurable 1–30 days)
- Grouped by *Today / Yesterday / This week / Earlier*
- Sort by domain or time
- Reopen individually or in batch
- Bulk-clean entries older than N days

#### 4. Undo Close

Closed something by accident? Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>
(<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd> on macOS) to reopen it instantly.

#### 5. Settings

Open ⚙️ in the top-right corner.

| Option | Description |
|---|---|
| Language | 中文 / English / Follow browser |
| Tab grouping | Main domain / Full hostname / Custom rules |
| Subgroup by path | GitHub repos, YouTube channels, etc. shown as separate rows |
| Custom rules | Map any domain → custom group name |
| History retention | 1–30 days |
| Items per page | 3–20 |

### Screenshots

<div align="center">

| Home | Tab Stash |
|---|---|
| *screenshot coming soon* | *screenshot coming soon* |

</div>

> 📸 Drop your screenshots into [`docs/screenshots/`](docs/screenshots/)
> and they'll be picked up by the README above.

### Installation

#### From source (current method)

1. Open Chrome and visit `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder in this repository

That's it. New tabs now open TabCtrl.

#### From Chrome Web Store

*Coming soon — not yet published.*

#### Update

Visit `chrome://extensions`, find the TabCtrl card, click **Reload**.

### Usage

Once installed, every new tab opens the TabCtrl dashboard. The toolbar
icon also shows a **color-coded badge** of your current open tab count:

- 🟢 Green — 1–10 tabs
- 🟡 Amber — 11–20 tabs
- 🔴 Red — 21+ tabs

### Privacy

**TabCtrl is 100% local.** Nothing is ever uploaded.

- Open tab data — read via Chrome Tabs API, never sent anywhere
- Stashed tabs — stored in `chrome.storage.local`, never sent anywhere
- Close history — stored in `chrome.storage.local`, never sent anywhere
- No account, no network calls, no analytics

See [`manifest.json`](extension/manifest.json) for the exact permission
list. Host permissions cover `<all_urls>` only because `tabs.query`
needs them to read tab titles and favicons — the data stays in your
browser.

### Keyboard Shortcuts

| Shortcut (Win / Linux) | Shortcut (macOS) | Action |
|---|---|---|
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd> | <kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd> | Reopen last closed tab |

### Tech Stack

- **Manifest V3** service worker architecture
- Vanilla JavaScript — no framework, no build step
- `chrome.storage.local` for persistence
- `chrome.tabs` / `chrome.bookmarks` / `chrome.sessions` APIs
- i18n built in (中文 / English)

### Contributing

Pull requests are welcome. For major changes, please open an issue first
to discuss what you'd like to change.

```bash
git clone https://github.com/ai-chase/TabCtrl.git
cd TabCtrl
# Load the extension/ folder as an unpacked extension in Chrome
```

### License

[MIT](LICENSE) © 2026 Chase

### About the Author

<div align="center">

<!-- AUTHOR PHOTO: drop your portrait into docs/author.png (square, 256×256+ recommended) -->
<img src="docs/author.png" alt="Chase" width="128" height="128" style="border-radius: 50%;">

**Chase** — a senior engineer building calm tools for information overload.
Follow along on the journey from solo side project to a small product.

[github.com/ai-chase](https://github.com/ai-chase) ·
[Mastodon](https://mastodon.social/@chase) ·
[email](mailto:hi@example.com)

</div>

---

<a name="中文"></a>

## 🇨🇳 中文

### 为什么需要 TabCtrl？

大多数标签页管理器让你二选一：杀掉可能需要的标签，或者淹没在
一百个标签里。**TabCtrl 让你保留所有标签，但让它们在「新标签页」
里清晰可见、一触即达。**

- 看到每一个打开的标签页，按网站分组，不是平铺列表
- 暂存稍后想看的标签页（连滚动位置都记住）
- 1–30 天内关闭过的标签页都能找回
- 100% 本地，零账号、零服务器、零遥测

### 目录

- [功能介绍](#功能介绍)
- [截图](#截图)
- [安装](#安装)
- [使用](#使用)
- [配置项](#配置项)
- [隐私](#隐私)
- [快捷键](#快捷键)
- [技术栈](#技术栈)
- [贡献](#贡献)
- [许可证](#许可证)

### 功能介绍

#### 1. 打开的标签页 — Right now

新标签页直接变成**所有打开标签的实时仪表盘**，按域名分组。

| 操作 | 方法 |
|---|---|
| 跳转到标签页 | 点击标签名称 |
| 关闭单个标签 | 点击标签卡右侧的 **×** |
| 关闭整个网站 | 点击网站卡片上的「**Close N tabs**」 |
| 去重 | 一键折叠指向同一 URL 的重复标签 |
| 收藏到 Tab Stash | 点击书签图标暂存 |
| 添加到 Chrome 书签 | 点击星标图标 |

**分组方式（可在设置里调整）：**

- **按主域名归组** — `mail.google.com` 和 `docs.google.com` 都归到 `google.com`
- **按完整主机名归组** — 子域名分开显示
- **按路径再细分** — GitHub 显示为 `owner/repo`，YouTube 显示为 `@频道名`

#### 2. Tab Stash — 收藏的标签页

把标签页暂存到这里，需要时再打开。保留原页面标题、图标，更重要的是—
**连滚动位置都精确保存**，重新打开像从没离开过。

- 自定义分类（如「阅读」「项目」「购物」）
- 拖拽卡片在不同分类间移动
- 跨分类搜索
- 同一页面多次收藏显示收藏次数，点击可查看历史

#### 3. 关闭历史 — History

每次关闭标签页都会自动记录。

- 默认保留 7 天（设置里 1–30 天可调）
- 按时间分组：今天 / 昨天 / 本周 / 更早
- 按域名或时间排序
- 单条重开，或批量重开
- 一键清理 N 天前的记录

#### 4. 撤销关闭 — Undo

误关标签页？按 <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>
（Mac 为 <kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>）立即恢复。

#### 5. 设置 — Settings

打开右上角的 ⚙️。

| 选项 | 说明 |
|---|---|
| 语言 | 中文 / English / 跟随浏览器 |
| 标签页分组方式 | 主域名 / 完整主机名 / 自定义规则 |
| 按路径细分 | GitHub 仓库、YouTube 频道等显示为独立行 |
| 自定义规则 | 自定义域名 → 分组名称的映射 |
| 历史保留天数 | 1~30 天 |
| 每页显示条数 | 3~20 |

### 截图

<div align="center">

| 主页 | 收藏的标签页 |
|---|---|
| *截图待补充* | *截图待补充* |

</div>

> 📸 把截图丢进 [`docs/screenshots/`](docs/screenshots/) 目录，
> README 就会自动引用。

### 安装

#### 从源码安装（当前方式）

1. 打开 Chrome，访问 `chrome://extensions`
2. 右上角开启「**开发者模式**」
3. 点击「**加载已解压的扩展程序**」
4. 选择本项目中的 `extension/` 文件夹

安装完成后，新建标签页就会自动打开 TabCtrl。

#### 从 Chrome 应用商店安装

*即将上架 — 暂未发布。*

#### 更新

打开 `chrome://extensions`，点击 TabCtrl 卡片底部的「**重新加载**」即可。

### 使用

安装后，每一个新标签页都会打开 TabCtrl 主页。工具栏图标还会显示
**当前打开标签页数量的彩色徽章**：

- 🟢 绿色 — 1–10 个
- 🟡 琥珀色 — 11–20 个
- 🔴 红色 — 21+ 个

### 隐私

**TabCtrl 完全本地化，数据绝不上传。**

- 打开的标签页 — 通过 Chrome Tabs API 读取，不上传
- 收藏的标签页 — 存在 `chrome.storage.local`，不上传
- 关闭历史 — 存在 `chrome.storage.local`，不上传
- 无需账号、无网络请求、无埋点分析

详细权限列表见 [`manifest.json`](extension/manifest.json)。`host_permissions`
声明 `<all_urls>` 是因为 `tabs.query` 读取标题和图标需要这个权限，
数据始终留在你的浏览器里。

### 快捷键

| 快捷键 (Win / Linux) | 快捷键 (macOS) | 作用 |
|---|---|---|
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd> | <kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd> | 重新打开上次关闭的标签页 |

### 技术栈

- **Manifest V3** Service Worker 架构
- 原生 JavaScript — 无框架，无构建步骤
- `chrome.storage.local` 持久化
- `chrome.tabs` / `chrome.bookmarks` / `chrome.sessions` API
- 内置 i18n（中文 / English）

### 贡献

欢迎 Pull Request。重大改动前请先开 Issue 讨论。

```bash
git clone https://github.com/ai-chase/TabCtrl.git
cd TabCtrl
# 在 Chrome 中以「加载已解压的扩展程序」方式加载 extension/ 文件夹
```

### 许可证

[MIT](LICENSE) © 2026 Chase

### 关于作者

<div align="center">

<!-- 作者照片：请把你的头像放到 docs/author.png（正方形，建议 256×256 以上） -->
<img src="docs/author.png" alt="Chase" width="128" height="128" style="border-radius: 50%;">

**Chase** — 资深工程师，致力于为信息过载打造「冷静」的工具。
欢迎关注这个从个人副业走向小产品的旅程。

[github.com/ai-chase](https://github.com/ai-chase) ·
[Mastodon](https://mastodon.social/@chase) ·
[email](mailto:hi@example.com)

</div>

---

<div align="center">

**⭐ 如果这个项目对你有帮助，欢迎 Star！**

</div>
