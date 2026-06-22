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

<!-- SSOT: Chinese is the source of truth. The English section below is reverse-synced from it.
     If you edit EN, please also update ZH, or vice versa. Last sync: 2026-06-22. -->
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](#tech-stack)
[![Version](https://img.shields.io/badge/version-1.1.0-blue)](#)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](#)
[![No Backend](https://img.shields.io/badge/backend-none-9cf)](#privacy)

[**English**](#english) · [**中文**](#中文)

</div>

---

<a name="english"></a>

## 🇬🇧 English

### Why TabCtrl?

Most tab managers force you to choose: kill tabs you might need, or drown in a hundred-tab strip.
**TabCtrl keeps them all open, but makes them visible and reachable from the new tab page itself.**

- See every open tab grouped by site, not as a flat list
- Stash tabs you want to come back to (with scroll position saved)
- Reopen anything you closed in the last 1–30 days
- 100% local — no account, no server, no telemetry

### Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [Privacy](#privacy)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Tech Stack](#tech-stack)

### Features

#### 1. Open Tabs — *Right now*

Every new tab shows a live dashboard of every open tab, **grouped by domain**.

| Action | How |
|---|---|
| Switch to a tab | Click the tab title |
| Close a single tab | Click the **×** on the tab card |
| Close an entire site | Click **"Close N tabs"** on the site card |
| Deduplicate duplicates | One click collapses all tabs pointing to the same URL |
| Stash a tab | Click the bookmark icon (▲) to save for later |
| Add to Chrome Bookmarks | Click the star icon (★) to save with folder picker |
| Undo close | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>

**Grouping modes (configurable in Settings):**

- **By main domain** — subdomains of the same site merge into one card
- **By full hostname** — each subdomain gets its own card
- **With path subgroups** — GitHub repos split into `owner/repo` rows, YouTube channels into `@channel` rows

#### 2. Tab Stash — *Save for later*

Save tabs you want to come back to. They retain their **title, favicon, and exact scroll position**,
so reopening feels like you never left.

- Custom categories (e.g. *Reading*, *Projects*, *Shopping*)
- Drag-and-drop cards between categories
- Search across stashed tabs
- Stashing the same page multiple times increments a counter; click to see its stash history
- Auto-cleanup: tabs older than the configured retention period are pruned automatically

#### 3. Close History

TabCtrl-driven closes are recorded automatically. Native Chrome closes (Ctrl+W, clicking × on the tab strip)
are **never** recorded — only closes initiated from within TabCtrl (chip ×, Close N tabs, dedup) generate entries.

- Default 7-day retention (configurable 1–30 days)
- Grouped by *Today / Yesterday / This week / Earlier*
- Sort by domain or time
- Reopen individually or in batch
- Bulk-clean entries older than N days
- Toggle on/off in Settings

#### 4. Undo Close

Closed something by accident from within TabCtrl? Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> to reopen it instantly.
Native Chrome undo (Ctrl+Shift+T) also works for tabs closed outside TabCtrl.

#### 5. Settings

Open ⚙️ in the top-right corner.

| Option | Description |
|---|---|
| Language | 中文 / English / Follow browser |
| Tab grouping | Main domain / Full hostname / Custom rules |
| Subgroup by path | GitHub repos, YouTube channels, etc. shown as separate rows |
| Custom grouping rules | Map any domain → custom group name |
| Record close history | Toggle recording of TabCtrl-driven closes |
| History retention | 1–30 days |
| Items per page | 3–20 |

#### 6. Chrome Bookmarks Integration

Bookmark any open tab directly from the chip. A native Chrome bookmark folder picker lets you choose
the destination folder, rename the bookmark, or manage existing bookmarks.

### Installation

TabCtrl isn't on the Chrome Web Store yet. To install it manually:

1. Go to the [TabCtrl GitHub page](https://github.com/ai-chase/TabCtrl) and click **Code → Download ZIP**
2. Unzip the file to a permanent location (e.g. your Documents folder)
3. Open Chrome and visit `chrome://extensions`
4. Turn on **Developer mode** (top-right toggle)
5. Click **Load unpacked** and select the `extension/` folder from the unzipped directory

New tabs will now open TabCtrl.

#### Update

Download a fresh ZIP (or `git pull` if you cloned the repo), then revisit `chrome://extensions`
and click **Reload** on the TabCtrl card.

### Usage

Once installed, every new tab opens the TabCtrl dashboard. The toolbar icon also shows a
**color-coded badge** of your current open tab count:

- 🟢 Green — 1–10 tabs
- 🟡 Amber — 11–20 tabs
- 🔴 Red — 21+ tabs

### Privacy

**TabCtrl is 100% local.** Nothing is ever uploaded.

- Open tab data — read via the Chrome Tabs API, never sent anywhere
- Stashed tabs — stored in `chrome.storage.local`, never sent anywhere
- Close history — stored in `chrome.storage.local`, never sent anywhere
- No account, no network calls, no analytics, no telemetry

See [`manifest.json`](extension/manifest.json) for the full permission list. Host permissions cover `<all_urls>`
only because the Tabs API requires it to read tab titles and favicons — the data stays in your browser.

### Keyboard Shortcuts

| Shortcut (Win / Linux) | Shortcut (macOS) | Action |
|---|---|---|
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | <kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | Reopen last TabCtrl-closed tab |

> **Note:** All shortcuts can be remapped at `chrome://extensions/shortcuts`.

### Tech Stack

- **Manifest V3** service worker architecture
- Vanilla JavaScript — no framework, no build step
- `chrome.storage.local` / `chrome.storage.session` for persistence
- `chrome.tabs` / `chrome.bookmarks` / `chrome.sessions` / `chrome.commands` APIs
- Built-in i18n (中文 / English)

---

<a name="中文"></a>

## 🇨🇳 中文

### 为什么需要 TabCtrl？

大多数标签页管理器让你二选一：杀掉可能需要的标签，或者淹没在一百个标签里。
**TabCtrl 让你保留所有标签，但让它们在「新标签页」里清晰可见、一触即达。**

- 看到每一个打开的标签页，按网站分组，不是平铺列表
- 暂存稍后想看的标签页（连滚动位置都记住）
- 1–30 天内关闭过的标签页都能找回
- 100% 本地，零账号、零服务器、零遥测

### 目录

- [功能介绍](#功能介绍)
- [安装](#安装)
- [使用](#使用)
- [配置项](#配置项)
- [隐私](#隐私)
- [快捷键](#快捷键)
- [技术栈](#技术栈)

### 功能介绍

#### 1. 打开的标签页 — Right now

新标签页直接变成**所有打开标签的实时仪表盘**，按域名分组。

| 操作 | 方法 |
|---|---|
| 跳转到标签页 | 点击标签名称 |
| 关闭单个标签 | 点击标签卡右侧的 **×** |
| 关闭整个网站 | 点击网站卡片上的「**Close N tabs**」 |
| 去重 | 一键折叠指向同一 URL 的重复标签 |
| 收藏到 Tab Stash | 点击书签图标 (▲) 暂存 |
| 添加到 Chrome 书签 | 点击星标图标 (★) 并选择文件夹 |
| 撤销关闭 | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>

**分组方式（可在设置里调整）：**

- **按主域名归组** — 同一个站点的子域名合并到一张卡
- **按完整主机名归组** — 每个子域名一张卡
- **按路径再细分** — GitHub 仓库拆为 `owner/repo` 行，YouTube 频道拆为 `@频道名` 行

#### 2. Tab Stash — 暂存稍后看

把标签页暂存到这里，需要时再打开。保留**标题、图标、和精确的滚动位置**，
重新打开像从没离开过。

- 自定义分类（如「阅读」「项目」「购物」）
- 拖拽卡片在不同分类间移动
- 跨分类搜索
- 同一页面多次收藏显示收藏次数，点击可查看历史
- 自动清理：超过配置保留天数的暂存标签会自动删除

#### 3. 关闭历史 — History

只记录 TabCtrl 内部触发的关闭（chip ×、Close N tabs、去重）。Chrome 原生关闭（Ctrl+W、点击浏览器 tab ×）
**不会记录**。

- 默认保留 7 天（设置里1–30 天可调）
- 按时间分组：今天 / 昨天 / 本周 / 更早
- 按域名或时间排序
- 单条重开，或批量重开
- 一键清理 N 天前的记录
- 可在设置里关闭记录功能

#### 4. 撤销关闭 — Undo

从 TabCtrl 内误关标签页？按 <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> 立即恢复。
Chrome 的 <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd> 依然有效，用于恢复 TabCtrl 之外的关闭。

#### 5. 设置 — Settings

打开右上角的 ⚙️。

| 选项 | 说明 |
|---|---|
| 语言 | 中文 / English / 跟随浏览器 |
| 标签页分组方式 | 主域名 / 完整主机名 / 自定义规则 |
| 按路径细分 | GitHub 仓库、YouTube 频道等显示为独立行 |
| 自定义分组规则 | 自定义域名 → 分组名称的映射 |
| 记录关闭历史 | 开关 TabCtrl 驱动的关闭记录 |
| 历史保留天数 | 1~30 天 |
| 每页显示条数 | 3~20 |

#### 6. Chrome 书签集成

在 chip 上直接对打开的标签页添加 Chrome 书签。弹出原生文件夹选择器，
支持重命名、移动和删除已有书签。

### 安装

TabCtrl 目前还没有上架到 Chrome 应用商店。手动安装方式：

1. 打开 [TabCtrl 的 GitHub 页面](https://github.com/ai-chase/TabCtrl)，点击 **Code → Download ZIP** 下载压缩包
2. 解压到一个固定位置（例如「文档」文件夹）
3. 打开 Chrome，访问 `chrome://extensions`
4. 打开右上角的「**开发者模式**」
5. 点击「**加载已解压的扩展程序**」，选择解压目录里的 `extension/` 文件夹

新建标签页就会自动打开 TabCtrl。

#### 更新

下载最新的 ZIP（或 `git pull`），再到 `chrome://extensions` 点击 TabCtrl 卡片上的「**重新加载**」即可。

### 使用

安装后，每一个新标签页都会打开 TabCtrl 主页。工具栏图标还会显示**当前打开标签页数量的彩色徽章**：

- 🟢 绿色 — 1–10 个
- 🟡 琥珀色 — 11–20 个
- 🔴 红色 — 21+ 个

### 隐私

**TabCtrl 完全本地化，数据绝不上传。**

- 打开的标签页 — 通过 Chrome Tabs API 读取，不上传
- 收藏的标签页 — 存在 `chrome.storage.local`，不上传
- 关闭历史 — 存在 `chrome.storage.local`，不上传
- 无需账号、无网络请求、无埋点分析

详细权限列表见 [`manifest.json`](extension/manifest.json)。`host_permissions` 声明 `<all_urls>`
是因为 Tabs API 读取标题和图标需要这个权限，数据始终留在你的浏览器里。

### 快捷键

| 快捷键 (Win / Linux) | 快捷键 (macOS) | 作用 |
|---|---|---|
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | <kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | 重新打开 TabCtrl 关闭的标签页 |

> **注意：** 所有快捷键可在 `chrome://extensions/shortcuts` 重新映射。

### 技术栈

- **Manifest V3** Service Worker 架构
- 原生 JavaScript — 无框架，无构建步骤
- `chrome.storage.local` / `chrome.storage.session` 持久化
- `chrome.tabs` / `chrome.bookmarks` / `chrome.sessions` / `chrome.commands` API
- 内置 i18n（中文 / English）

