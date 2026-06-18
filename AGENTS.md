# TabCtrl — Developer Guide

## Project Structure

```
TabCtrl/
├── extension/               ← Chrome extension (load unpacked from here)
│   ├── manifest.json         ← Extension config (version, permissions, entry points)
│   ├── index.html           ← Dashboard HTML (new tab page)
│   ├── app.js               ← Main dashboard logic (~4200 lines)
│   ├── background.js        ← Service worker (badge, history, undo shortcut)
│   ├── settings.js          ← Settings storage + domain/subgroup logic
│   ├── settings-ui.js       ← Settings panel UI
│   ├── i18n.js              ← EN + ZH string tables
│   ├── style.css            ← Hand-drawn design system (~3700 lines)
│   └── *.css                ← Component-specific stylesheets
├── tmp/                     ← Audit scripts, temporary files
└── README.md / AGENTS.md    ← Project docs
```

## Development Setup

1. `git clone` the repo
2. `chrome://extensions` → Developer mode → Load unpacked → select `extension/`
3. Changes to JS/CSS auto-refresh on reload; HTML changes require extension re-load

## Core Architecture

### Data Flow

```
background.js (service worker)
  ↓ chrome.storage.local / chrome.storage.session
  ↓
app.js (dashboard, loaded as new tab page)
  ↓ chrome.tabs.query() for live open tab list
  ↓ chrome.storage.local for stash/history
  ↓
settings.js (settings logic, runs in app.js context)
settings-ui.js (settings panel, DOM event handlers)
```

### Key Modules

| File | Responsibility |
|---|---|
| `background.js` | Toolbar badge count, closed-tab history, `Ctrl+Shift+T` undo |
| `app.js` | Tab grouping, rendering, user actions, stash, history UI |
| `settings.js` | Settings CRUD, `getGroupKeyForUrl()`, `getMainDomain()`, `getSubgroupKey()` |
| `settings-ui.js` | Settings panel DOM, radio/checkbox handlers, sub-grouping rule editor |
| `i18n.js` | EN + ZH key-value pairs, `t(key, params)`, `applyToDOM()` |

### Storage Keys

| Key | Where | Shape |
|---|---|---|
| `table-control-settings` | `chrome.storage.local` | `{ aggregationMode, customRules, subGroupingEnabled, subGroupingRules, language, historyRetentionDays, historyPageSize, stashCategories }` |
| `stash` | `chrome.storage.local` | `Array<{ id, url, title, favIconUrl, categoryId, snapshot, savedAt }>` |
| `history` | `chrome.storage.local` | `Array<{ id, url, title, favIconUrl, closedAt, windowId, closeMethod }>` |
| `skipHistoryTabIds` | `chrome.storage.session` | `{ [tabId]: timestamp }` — transient, cleared on tab close |

## Coding Conventions

### i18n

- All user-facing strings → `i18n.js`
- Call `t('key')` or `t('key', param)` in JS; use `data-i18n="key"` in HTML
- Never hardcode visible strings in JS or HTML

### URL Fingerprinting

- `urlFingerprint(rawUrl)` → 16-char hex SHA-256 prefix
- `normalizeUrl(rawUrl)` → strips `#fragment`, drops tracking params (`utm_*`, `fbclid`, etc.), sorts query params, lowercases host
- Duplicate detection uses fingerprint equality; fallback for restricted pages

### Tab Grouping

- `getGroupKeyForUrl(url, settings)` → `{ key, label }` — key is the aggregation bucket, label overrides display
- `getMainDomain(hostname)` → handles multi-part TLDs (`co.uk`, `com.cn`)
- `getSubgroupKey(url, settings)` → inside-domain grouping (GitHub repos, YouTube channels, etc.)

### Scroll Snapshots

- Captured via `chrome.scripting.executeScript` at stash time
- Restored on reopen with exponential backoff (immediate + 200ms + 500ms + 1s + 2s)
- Falls back to `{ window: {x:0, y:0}, containers: [] }` on restricted pages
- Legacy `{scrollX, scrollY}` shape is migrated automatically

### Service Worker

- Uses `chrome.storage.session` for transient state (not module-level Maps — SW can be torn down)
- `appendHistory()` atomically reads + writes to avoid race conditions
- `tabs.onRemoved` skip logic: `skipHistoryTabIds` map populated before stash-driven closes

## Testing Checklist

Before any commit / PR:

- [ ] `node --check` on all `.js` files (syntax)
- [ ] Open extension in Chrome → new tab → dashboard loads
- [ ] Open 5+ tabs across 3 domains → verify grouping
- [ ] Stash a tab → verify it disappears from open list, appears in stash
- [ ] Reopen stashed tab → verify URL + scroll position
- [ ] Close a tab → verify it appears in history
- [ ] Click history entry → verify reopen works
- [ ] Settings → toggle language → verify bilingual switch
- [ ] Duplicate tabs test: open same URL twice → verify duplicate badge
- [ ] `Ctrl+Shift+T` → verify undo-close works
- [ ] `Ctrl+D` on a tab → verify bookmark dialog opens
- [ ] Console: no red errors (warnings OK)

## Git Workflow

```
main           ← stable, public-facing
develop        ← default working branch
```

- Commit message format: `type: short description`
  - `fix:` bug fix
  - `feat:` new feature
  - `chore:` cleanup, refactor, dependency update
  - `docs:` documentation only
- All changes tested locally before commit
- No force-push to `main`

## Common Tasks

### Add a new i18n key

1. Add to both `en:` and `zh:` sections in `i18n.js` (keep them in sync)
2. Use `t('key')` in JS or `data-i18n="key"` in HTML

### Add a new setting

1. Add default in `DEFAULT_SETTINGS` in `settings.js`
2. Handle migration in `mergeWithDefaults()`
3. Add UI in `settings-ui.js` `render()` / `handleChange()`
4. Add i18n keys for any labels

### Add a new user action

1. Add `data-action="action-name"` to the HTML button
2. Handle in `app.js` `handleAction()` switch
3. For new storage keys, add them to the relevant module

### Add sub-grouping rule

1. Add to `DEFAULT_SUB_GROUPING_RULES` in `settings.js`
2. Add i18n key for display name if needed
3. Document in README feature list

## Performance Notes

- `urlFingerprint()` uses `crypto.subtle.digest` (async, cached per URL)
- `_fingerprintCache` is a module-level Map, cleared between render passes
- `buildFingerprintMap()` runs all fingerprints in parallel via `Promise.all`
- Scroll snapshot injection uses exponential backoff to handle lazy-loaded pages
- Settings UI pre-renders on init for instant panel open

## Design System (style.css)

- CSS custom properties for all colors, fonts, radii, shadows
- Wobbly border-radius: asymmetric values, not symmetric
- Hard offset shadows (no blur): `4px 4px 0 0 #2d2d2d`
- Fonts: `Kalam` (headings) + `Patrick Hand` (body)
- Paper texture: `radial-gradient` dot pattern via `background-image`
