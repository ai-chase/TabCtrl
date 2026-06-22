/**
 * background.js — Service Worker for TabCtrl
 *
 * Three jobs:
 *   1. Toolbar badge showing the current open tab count (color-coded).
 *   2. Record every closed tab to a rolling history buffer so the user
 *      can find and reopen anything they accidentally closed.
 *   3. Handle the "undo-close" keyboard shortcut.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const HISTORY_KEY       = 'history';             // chrome.storage.local key
const HISTORY_MAX_ITEMS = 500;                  // hard cap on stored entries
const HISTORY_MAX_AGE_DAYS = 7;                 // soft cap — anything older gets pruned on write

// URLs we never record (chrome internals, extension pages, blank tabs).
function isRecordableUrl(url) {
  if (!url) return false;
  return (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('file://')
  );
}


// ─── Badge updater ────────────────────────────────────────────────────────────

/**
 * updateBadge()
 *
 * Counts open real-web tabs and updates the extension's toolbar badge.
 * Color coded: green (1-10), amber (11-20), red (21+).
 */
async function updateBadge() {
  try {
    const tabs = await chrome.tabs.query({});

    const count = tabs.filter(t => {
      const url = t.url || '';
      return (
        !url.startsWith('chrome://') &&
        !url.startsWith('chrome-extension://') &&
        !url.startsWith('about:') &&
        !url.startsWith('edge://') &&
        !url.startsWith('brave://')
      );
    }).length;

    // (2026-06-22) set background color FIRST, then text — some Chrome versions
    // wipe badge text when setBadgeBackgroundColor follows setBadgeText. Order
    // matters here. See: https://issues.chromium.org/issues/40802528 (related).
    let color = '#3d7a4a';           // green default
    if (count > 10)      color = '#b8892e';   // amber 11–20
    if (count > 20)      color = '#b35a5a';   // red 21+

    try {
      await chrome.action.setBadgeBackgroundColor({ color });
    } catch (bgErr) {
      console.warn('[TabCtrl] setBadgeBackgroundColor failed:', bgErr);
    }

    // Always set text LAST so it survives any color failure.
    try {
      await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    } catch (textErr) {
      console.warn('[TabCtrl] setBadgeText failed:', textErr);
    }
  } catch (err) {
    console.error('[TabCtrl] updateBadge outer failure:', err);
    // Best-effort: clear badge on total failure
    try { await chrome.action.setBadgeText({ text: '' }); } catch (_) {}
  }
}


// ─── History recorder ─────────────────────────────────────────────────────────

/**
 * In-memory cache of every open tab's last-known url/title/favicon.
 * Updated on tabs.onCreated and tabs.onUpdated, consumed by tabs.onRemoved.
 * This is necessary because by the time onRemoved fires, the Tab object
 * is gone — there's no way to recover url/title otherwise.
 */
const tabSnapshots = new Map();   // tabId -> { url, title, favIconUrl }

// Tab IDs that should NOT generate a history entry when closed.
// Populated by the 'skip-history' runtime message sent from app.js right
// before it closes a tab as part of a stash action. Stored as
// `tabId -> timestamp` so we can GC stale entries after 60s (in case
// onRemoved never fires for whatever reason).
//
// CRITICAL: this lives in chrome.storage.session (NOT a module-level Map)
// because Chrome MV3 service workers can be torn down and restarted at any
// time — a restart wipes module-level Maps. The previous Map-based design
// had a race where the SW could restart between the skip-history message
// and the tabs.onRemoved event, losing the skip and accidentally recording
// stash-driven closes into history. storage.session survives SW restarts
// (it stays in memory for the lifetime of the browser session) but is wiped
// on browser restart — which is the desired TTL for "next close" semantics.
const SKIP_HISTORY_KEY = 'skipHistoryTabIds';

async function addSkipHistory(tabId) {
  const stored = await chrome.storage.session.get(SKIP_HISTORY_KEY);
  const map = (stored && stored[SKIP_HISTORY_KEY]) || {};
  map[tabId] = Date.now();
  await chrome.storage.session.set({ [SKIP_HISTORY_KEY]: map });
}

async function consumeSkipHistory(tabId) {
  const stored = await chrome.storage.session.get(SKIP_HISTORY_KEY);
  const map = (stored && stored[SKIP_HISTORY_KEY]) || {};
  if (Object.prototype.hasOwnProperty.call(map, tabId)) {
    delete map[tabId];
    await chrome.storage.session.set({ [SKIP_HISTORY_KEY]: map });
    return true;
  }
  return false;
}

async function gcSkipHistory() {
  const stored = await chrome.storage.session.get(SKIP_HISTORY_KEY);
  const map = (stored && stored[SKIP_HISTORY_KEY]) || {};
  const now = Date.now();
  let changed = false;
  for (const id of Object.keys(map)) {
    if (now - map[id] > 60000) {
      delete map[id];
      changed = true;
    }
  }
  if (changed) await chrome.storage.session.set({ [SKIP_HISTORY_KEY]: map });
}

/**
 * captureTabSnapshot(tab) — store the latest known state of a tab.
 * Safe to call repeatedly; last write wins.
 */
function captureTabSnapshot(tab) {
  if (!tab || tab.id == null) return;
  tabSnapshots.set(tab.id, {
    url:        tab.url        || '',
    title:      tab.title      || tab.url || '',
    favIconUrl: tab.favIconUrl || '',
  });
}

/**
 * appendHistory(entry) — add one record, then prune to caps.
 * Atomic via storage.local.get/set; safe if called concurrently (last writer wins).
 */
async function appendHistory(entry) {
  try {
    // Read history AND settings in one storage call (faster than two gets).
    const stored = await chrome.storage.local.get([HISTORY_KEY, 'table-control-settings']);
    const list = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
    list.unshift(entry);   // newest first

    // Retention: user setting takes precedence; falls back to the legacy
    // HISTORY_MAX_AGE_DAYS constant. Clamp to [1, 30] to stay sane.
    const settings = stored['table-control-settings'] || {};
    let days = settings.historyRetentionDays;
    if (typeof days !== 'number' || !Number.isFinite(days)) days = HISTORY_MAX_AGE_DAYS;
    days = Math.max(1, Math.min(30, days));

    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const pruned = list
      .filter(e => e && e.closedAt && e.closedAt >= cutoffMs)
      .slice(0, HISTORY_MAX_ITEMS);

    await chrome.storage.local.set({ [HISTORY_KEY]: pruned });
  } catch (err) {
    console.error('[TabCtrl] appendHistory failed:', err);
  }
}


// ─── Event listeners ──────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  updateBadge();
});

/**
 * tabs.onCreated — start tracking this tab's identity.
 */
chrome.tabs.onCreated.addListener((tab) => {
  updateBadge();
  captureTabSnapshot(tab);
});

/**
 * tabs.onUpdated — refresh the snapshot whenever url/title/favicon change.
 * A user navigating within the same tabId is still the "same tab" for history.
 */
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  updateBadge();
  if (tab) captureTabSnapshot(tab);
});

/**
 * tabs.onRemoved — write to history (unless window is closing or the
 * tab was just stashed via app.js).
 *
 * Skip conditions:
 *   - removeInfo.isWindowClosing === true → user closed the whole window
 *     (skip to avoid flooding history with bulk-closes the user can't
 *     action individually)
 *   - tabId in _skipHistoryTabIds → app.js signalled this tab is being
 *     closed as part of a stash action (not a real user close). The
 *     Set is populated by the 'skip-history' runtime message and
 *     cleared once the matching onRemoved fires (or after 60s as a
 *     safety net).
 */
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  updateBadge();
  // Drop any stale skip markers after 60s — if the tab never closes,
  // the marker is forgotten so future closes of the same id (unlikely)
  // would still record.
  await gcSkipHistory();
  if (removeInfo && removeInfo.isWindowClosing) {
    tabSnapshots.delete(tabId);
    return;
  }
  if (await consumeSkipHistory(tabId)) {
    tabSnapshots.delete(tabId);
    return; // intentional skip — tab was stashed, not closed
  }
  const snap = tabSnapshots.get(tabId);
  tabSnapshots.delete(tabId);
  if (!snap || !isRecordableUrl(snap.url)) return;

  appendHistory({
    id:          'hi_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    url:         snap.url,
    title:       snap.title,
    favIconUrl:  snap.favIconUrl,
    closedAt:    Date.now(),
    windowId:    removeInfo && removeInfo.windowId != null ? removeInfo.windowId : null,
    closeMethod: 'tab-ctrl',   // future: distinguish chrome-close vs tab-ctrl-close
  });
});


// ─── Runtime messages (from app.js) ────────────────────────────────────────

/**
 * handleMessage(msg, sender, sendResponse)
 *
 *   { type: 'skip-history', tabId }
 *     Mark this tabId so that the next tabs.onRemoved event for it does
 *     NOT produce a history entry. Used by the stash action: app.js
 *     sends this message right before chrome.tabs.remove(tabId), so the
 *     onRemoved handler treats the close as a stash-driven close rather
 *     than a user-driven close.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'skip-history' && Number.isFinite(msg.tabId)) {
    addSkipHistory(msg.tabId).then(() => {
      if (sendResponse) sendResponse({ ok: true });
    });
    return true;
  }
});


// ─── Keyboard shortcut (chrome.commands) ────────────────────────────────────

chrome.commands.onCommand.addListener((command) => {
  if (command === 'undo-close') {
    if (chrome.sessions && chrome.sessions.restore) {
      chrome.sessions.restore();
    }
  }
});


// ─── Initial run ─────────────────────────────────────────────────────────────

// Seed snapshots for already-open tabs at startup so we don't lose their
// identity if they get closed before any onUpdated fires.
(async () => {
  // (2026-06-22) diagnostic log so we can confirm the service worker actually
  // started and updateBadge ran. Visible in chrome://extensions → service worker
  // console. Safe to leave in; logs are cheap and useful when debugging badge issues.
  console.log('[TabCtrl] service worker starting (initial run)');
  try {
    const tabs = await chrome.tabs.query({});
    console.log(`[TabCtrl] initial snapshot: ${tabs.length} tab(s) open`);
    for (const t of tabs) captureTabSnapshot(t);
  } catch (err) {
    console.error('[TabCtrl] initial tabs.query failed:', err);
  }
  await updateBadge();
  console.log('[TabCtrl] initial updateBadge() done');
})();