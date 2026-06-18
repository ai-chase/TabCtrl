# TabCtrl

**当标签页过载成为日常，TabCtrl 帮你回到清晰。**

*Tabs pile up. TabCtrl helps you see the floor.*

[English](#english) · [中文](#中文)

---

## English {#english}

### What is TabCtrl?

TabCtrl is a Chrome extension that replaces your **new tab page** with a live dashboard — showing all your open tabs grouped by domain, surfacing duplicates, and letting you stash tabs away without closing them.

It's not a tab manager that hides your tabs. It's a **visibility layer** that sits on top of your existing workflow: see everything, decide what to keep, stash the rest.

### Features

#### 🗂 Domain Grouping
Tabs are automatically grouped by main domain (`google.com` instead of `mail.google.com`, `docs.google.com`, `calendar.google.com`). One card, one domain, no tab bar scrolling.

#### 🏠 Smart Landing Page Detection
Landing pages (Gmail inbox, Twitter/X home, GitHub dashboard, YouTube front page) get their own group so you can close "all those Twitter tabs" without touching the ones you're actually reading.

#### 🔁 Duplicate Tab Detection
Tabs with the same content are surfaced with a **duplicate badge**. Detection uses URL fingerprinting (SHA-256, first 16 hex chars) with aggressive tracking-param normalization (`utm_*`, `fbclid`, `ref`, etc. are stripped before comparison).

#### 📌 Tab Stash
Save tabs for later — they stay in Chrome storage, survive browser restarts, and can be organized into categories. Reopen them when you need them. Stashed tabs keep their **scroll position** when reopened (via `chrome.scripting.executeScript`).

#### ⏪ Tab History & Undo
Every closed tab is recorded to a rolling history (default 7 days, configurable up to 30). Click any entry to reopen it. Keyboard shortcut `Ctrl+Shift+T` reopens the last closed tab.

#### 🏷️ URL Sub-Grouping
Inside each domain card, tabs are further grouped by URL path:
- GitHub repos (`owner/repo`)
- YouTube channels (`@channel`)
- Subreddits (`r/subreddit`)
- X/Twitter profiles (`@username`)
- Stack Overflow questions

#### 🔖 Bookmark Dialog
Built-in modal for saving bookmarks (Ctrl+D flow). Shows your full bookmark folder tree, lets you pick a folder, and marks tabs as bookmarked with a visual indicator.

#### 🌐 Bilingual
Full Chinese + English support. Auto-detects your browser language, or set it manually in Settings.

#### ✨ Hand-Drawn Aesthetic
Warm paper background, wobbly borders, handwritten fonts (Kalam + Patrick Hand). Built to feel human, not clinical.

### How It Works

1. **Open a new tab** → TabCtrl dashboard shows all your open tabs
2. **Grouped by domain** → see how many tabs per site at a glance
3. **Spot duplicates** → duplicate badge on repeat content
4. **Stash tabs** → click ⏰ to save for later; they're removed from your tab bar but kept in storage
5. **Reopen later** → tabs restore with their original scroll position
6. **Closed accidentally?** → history section at the bottom, click to reopen

### Permissions

| Permission | Why |
|---|---|
| `tabs` | Read URL/title of open tabs for grouping |
| `activeTab` | Access current tab for screenshot/script injection |
| `storage` | Persist stashed tabs, settings, and history |
| `sessions` | `chrome.sessions.restore()` for undo-close |
| `scripting` | Capture and restore scroll positions |
| `bookmarks` | Read/write bookmark tree for the bookmark dialog |

No network access. No analytics. No cloud. Everything stays on your machine.

### Settings

- **Grouping mode**: Merge subdomains (default) · Separate subdomains · Custom rules
- **Sub-grouping**: Toggle on/off, add your own URL → label rules
- **History retention**: 1–30 days
- **Language**: Auto · English · 中文

---

## 中文 {#中文}

### TabCtrl 是什么？

TabCtrl 是一个 Chrome 扩展，将你的 **新标签页** 替换为一个实时仪表盘——展示所有已打开的标签页、按域名分组、标记重复标签、暂存标签以备后用。

它不是那种"把标签藏起来"的标签管理器。它是一个 **可见性增强工具**：看清所有标签，决定留什么，把其他的暂存起来。

### 核心功能

#### 🗂 域名聚合
标签页按主域名自动分组（`google.com` 代替 `mail.google.com`、`docs.google.com`、`calendar.google.com`）。一张卡片、一个域名，不用再滚标签栏。

#### 🏠 落地页智能识别
落地页（Gmail 收件箱、Twitter/X 首页、GitHub 仪表盘、YouTube 首页）独立成组，方便你关闭"所有 Twitter 标签"而不影响正在看的标签。

#### 🔁 重复标签检测
相同内容的标签页会显示 **重复徽章**。检测基于 URL 指纹（SHA-256，取前 16 位十六进制）配合追踪参数归一化（`utm_*`、`fbclid`、`ref` 等在比对前会被剥离）。

#### 📌 标签暂存
把标签存起来留待后用——保存在 Chrome 存储中，浏览器重启后依然在，可以分类整理。需要时重新打开。暂存的标签重新打开时会恢复**原始滚动位置**（通过 `chrome.scripting.executeScript` 实现）。

#### ⏪ 标签历史 & 撤销
每个关闭的标签都会被记录到滚动历史（默认 7 天，可配置到 30 天）。点击任意记录即可重新打开。快捷键 `Ctrl+Shift+T` 重新打开上一个关闭的标签。

#### 🏷️ URL 子级分组
在每个域名卡片内部，标签页会按 URL 路径进一步分组：
- GitHub 仓库（`owner/repo`）
- YouTube 频道（`@channel`）
- Subreddit（`r/subreddit`）
- X/Twitter 用户（`@username`）
- Stack Overflow 问题

#### 🔖 书签对话框
内置书签保存弹窗（模拟 Chrome Ctrl+D 流程）。展示完整书签文件夹树，选择目标文件夹，已书签标签页会显示视觉标记。

#### 🌐 双语支持
完整中英文界面。自动检测浏览器语言，也可在设置中手动切换。

#### ✨ 手绘风格设计
温暖的纸张背景、波浪边框、手写字体（Kalam + Patrick Hand）。让它感觉亲切，而不是冷冰冰。

### 工作原理

1. **打开新标签页** → TabCtrl 仪表盘显示所有已打开标签
2. **按域名分组** → 一眼看清每个站点开了多少标签
3. **发现重复** → 重复内容标签显示重复徽章
4. **暂存标签** → 点击 ⏰ 保存稍后查看；标签从标签栏移除但保存在存储中
5. **稍后打开** → 标签恢复原始滚动位置
6. **误关了？** → 底部历史区域，点击即可恢复

### 权限说明

| 权限 | 用途 |
|---|---|
| `tabs` | 读取已打开标签的 URL 和标题，用于分组 |
| `activeTab` | 当前标签页的脚本注入权限 |
| `storage` | 保存暂存标签、设置和历史记录 |
| `sessions` | `chrome.sessions.restore()` 实现撤销关闭 |
| `scripting` | 捕获和恢复滚动位置 |
| `bookmarks` | 读写书签树，实现书签对话框 |

无网络请求。无统计。无云端。全部数据保存在本地。

### 设置项

- **分组模式**：合并子域名（默认）· 分离子域名 · 自定义规则
- **子级分组**：开关控制，可添加自定义 URL → 标签名规则
- **历史保留**：1–30 天
- **界面语言**：跟随系统 · English · 中文

---

## Install / 安装

1. Clone this repo
2. Go to `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** → select the `extension` folder

## License

MIT
