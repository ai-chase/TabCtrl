/**
 * background.js — Service Worker for TabCtrl
 *
 * Jobs:
 *   1. Toolbar badge showing the current open tab count (color-coded).
 *   2. Record close events that app.js explicitly sends via runtime message.
 *      Native Chrome closes (clicking ×, Ctrl+W) are NEVER recorded —
 *      only TabCtrl-driven closes (chip ×, Close N tabs, dedup) generate
 *      history entries. Stash-driven closes don't send a record message.
 *   3. Handle the "undo-close" keyboard shortcut.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const HISTORY_KEY       = 'history';
const HISTORY_MAX_ITEMS = 500;
const SETTINGS_KEY      = 'table-control-settings';


// ─── Badge updater ────────────────────────────────────────────────────────────

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

    let color = '#3d7a4a';
    if (count > 10)      color = '#b8892e';
    if (count > 20)      color = '#b35a5a';

    try { await chrome.action.setBadgeBackgroundColor({ color }); }
    catch (bgErr) { console.warn('[TabCtrl] setBadgeBackgroundColor failed:', bgErr); }

    try { await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' }); }
    catch (textErr) { console.warn('[TabCtrl] setBadgeText failed:', textErr); }
  } catch (err) {
    console.error('[TabCtrl] updateBadge outer failure:', err);
    try { await chrome.action.setBadgeText({ text: '' }); } catch (_) {}
  }
}


// ─── History recorder ─────────────────────────────────────────────────────────

async function appendEntry(entry) {
  try {
    const stored = await chrome.storage.local.get([HISTORY_KEY, SETTINGS_KEY]);
    const list = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
    list.unshift(entry);

    const settings = stored[SETTINGS_KEY] || {};
    let days = settings.historyRetentionDays;
    if (typeof days !== 'number' || !Number.isFinite(days)) days = 7;
    days = Math.max(1, Math.min(30, days));

    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const pruned = list
      .filter(e => e && e.closedAt && e.closedAt >= cutoffMs)
      .slice(0, HISTORY_MAX_ITEMS);

    await chrome.storage.local.set({ [HISTORY_KEY]: pruned });
  } catch (err) {
    console.error('[TabCtrl] appendEntry failed:', err);
  }
}


// ─── Event listeners ──────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => updateBadge());
chrome.runtime.onStartup.addListener(() => updateBadge());
chrome.tabs.onCreated.addListener(() => updateBadge());
chrome.tabs.onUpdated.addListener(() => updateBadge());
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (removeInfo && removeInfo.isWindowClosing) return;
  updateBadge();
});


// ─── Runtime messages (from app.js) ────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;

  // ---- Helper: check if recording is enabled ----
  async function shouldRecord() {
    try {
      const stored = await chrome.storage.local.get(SETTINGS_KEY);
      const settings = stored[SETTINGS_KEY] || {};
      return settings.recordHistory !== false;
    } catch { return true; }
  }

  // ---- record-close: single tab close (chip ×) ----
  if (msg.type === 'record-close') {
    const tab = msg.tab;
    if (!tab || !tab.url) return;
    (async () => {
      if (!(await shouldRecord())) return;
      await appendEntry({
        id:          'hi_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        url:         tab.url,
        title:       tab.title || tab.url,
        favIconUrl:  tab.favIconUrl || '',
        closedAt:    Date.now(),
        closeMethod: msg.closeMethod || 'tab-ctrl',
      });
      if (sendResponse) sendResponse({ ok: true });
    })();
    return true;
  }

  // ---- record-close-batch: bulk close (Close N, subgroup, dedup) ----
  if (msg.type === 'record-close-batch') {
    const tabs = msg.tabs;
    if (!Array.isArray(tabs) || tabs.length === 0) return;
    (async () => {
      if (await shouldRecord()) {
        for (const tab of tabs) {
          if (!tab || !tab.url) continue;
          await appendEntry({
            id:          'hi_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            url:         tab.url,
            title:       tab.title || tab.url,
            favIconUrl:  tab.favIconUrl || '',
            closedAt:    Date.now(),
            closeMethod: msg.closeMethod || 'tab-ctrl',
          });
        }
      }
      if (sendResponse) sendResponse({ ok: true });
    })();
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

(async () => {
  console.log('[TabCtrl] service worker starting (initial run)');
  try {
    const tabs = await chrome.tabs.query({});
    console.log('[TabCtrl] tabs open: ' + tabs.length);
  } catch (err) {
    console.error('[TabCtrl] initial tabs.query failed:', err);
  }
  await updateBadge();
  console.log('[TabCtrl] initial updateBadge() done');
})();
