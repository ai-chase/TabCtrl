/* ================================================================
   TabCtrl — Dashboard App (Pure Extension Edition)

   This file is the brain of the dashboard. Now that the dashboard
   IS the extension page (not inside an iframe), it can call
   chrome.tabs and chrome.storage directly — no postMessage bridge needed.

   What this file does:
   1. Reads open browser tabs directly via chrome.tabs.query()
   2. Groups tabs by domain with a landing pages category
   3. Renders domain cards, banners, and stats
   4. Handles all user actions (close tabs, save for later, focus tab)
   5. Stores "Saved for Later" tabs in chrome.storage.local (no server)
   ================================================================ */

'use strict';

// i18n shortcut (i18n.js is loaded synchronously before this file)
const t = window.i18n ? window.i18n.t : (key) => key;

/* ----------------------------------------------------------------
   URL FINGERPRINT (SHA-256 prefix)

   Two URLs are considered "duplicates" when their fingerprints
   match. We normalise before hashing:

     1. Drop #fragment (in-page anchor — not identity)
     2. Drop common tracking / cache-busting params:
          utm_*, fbclid, gclid, ref, _  (and a few more)
     3. Sort remaining query params so order doesn't matter
     4. Lowercase host (host is case-insensitive)

   We use SHA-256 (the WebCrypto default — MD5 isn't supported
   in SubtleCrypto) and keep the first 16 hex chars. Collision
   rate is ~1 in 2^64 in practice, which is what MD5 gives you
   for a 128-bit space anyway, and we don't need cryptographic
   strength — just a stable bucket id.

   STRATEGY: aggressive (tracking params dropped). Settings
   override coming later if needed.
   ---------------------------------------------------------------- */
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'fbclid', 'gclid', 'msclkid', 'mc_cid', 'mc_eid', 'dclid', 'yclid',
  'ref', 'ref_src', 'ref_url', 'source', '_', 't', 'timestamp',
]);

function normalizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    // Walk the search params, drop tracking ones, sort the rest
    const kept = [];
    for (const [k, v] of u.searchParams) {
      if (TRACKING_PARAMS.has(k.toLowerCase())) continue;
      kept.push([k, v]);
    }
    kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    u.search = '';
    for (const [k, v] of kept) u.searchParams.append(k, v);
    return u.toString();
  } catch {
    // Malformed URL — fall back to the raw string. Better to
    // treat it as its own bucket than to crash the dashboard.
    return String(rawUrl || '');
  }
}

// Async because SubtleCrypto.digest is async. Cache the results
// per URL so we don't re-hash the same URL inside one render pass.
const _fingerprintCache = new Map();
async function urlFingerprint(rawUrl) {
  if (!rawUrl) return '';
  if (_fingerprintCache.has(rawUrl)) return _fingerprintCache.get(rawUrl);
  const normalized = normalizeUrl(rawUrl);
  try {
    const buf = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(normalized)
    );
    const hex = Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16);
    _fingerprintCache.set(rawUrl, hex);
    return hex;
  } catch {
    // Older contexts without SubtleCrypto — fall back to a simple
    // string hash so duplicate detection still works (just slower).
    let h = 0;
    for (let i = 0; i < normalized.length; i++) {
      h = ((h << 5) - h) + normalized.charCodeAt(i);
      h |= 0;
    }
    const fallback = (h >>> 0).toString(16).padStart(8, '0').repeat(2).slice(0, 16);
    _fingerprintCache.set(rawUrl, fallback);
    return fallback;
  }
}

// Sync helper for code paths that need the count synchronously.
// Returns a Map<url, fingerprint>. One async pass per render.
async function buildFingerprintMap(urls) {
  const map = new Map();
  await Promise.all(urls.map(async u => {
    map.set(u, await urlFingerprint(u));
  }));
  return map;
}


/* ----------------------------------------------------------------
   SNAPSHOTS — capture scroll position

   We persist the scroll position (window.scrollY / scrollX) of the
   tab at stash time. On reopen, the new tab is scrolled to that
   position.

   Thumbnail: not implemented. chrome.tabs.captureVisibleTab captures
   the visible tab of a window — which is the ACTIVE tab (the dashboard
   when the user clicks a bookmark icon), NOT the tab being stashed.
   So a thumbnail would always show the wrong content for stashed
   background tabs. We could switch focus to the stashed tab first,
   but that's terrible UX. The favicon + title already provide
   enough visual identity for a chip.

   All operations are best-effort and silent on failure — a Stash
   item without a snapshot is still valid.
   ---------------------------------------------------------------- */

async function captureTabSnapshot(tab) {
  const snap = {
    capturedAt: Date.now(),
    // Top-level document scroll (covers simple long pages like blogs, MDN, news).
    window: { x: 0, y: 0 },
    // Scrolled containers (covers Notion, Google Docs, any site where
    // a nested <div> is the actual scroll surface).
    containers: [],
  };
  if (!tab || tab.id == null) return snap;

  // Read scroll position via executeScript. Requires the
  // `scripting` permission (added in commit e1d3fe7). Will fail
  // on chrome://, about:, file://, the Chrome Web Store, or any
  // other restricted page — those are silently treated as
  // "scroll=0" snapshots.
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: captureScrollSnapshot,
    });
    if (Array.isArray(results) && results[0] && results[0].result) {
      const r = results[0].result;
      if (r.window) snap.window = { x: r.window.x || 0, y: r.window.y || 0 };
      if (Array.isArray(r.containers)) snap.containers = r.containers;
    }
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    // 'permission to access this host' -> manifest is missing host_permissions.
    // Tell the user once instead of silently failing forever.
    if (/permission to access this host/i.test(msg) && !window._hostPermWarned) {
      window._hostPermWarned = true;
      showToast(t('toast.snapshot_permission_missing') || 'Snapshot needs site access — reload TabCtrl at chrome://extensions');
    }
    // scripting not allowed on this URL — keep default scroll=0
  }

  return snap;
}

/**
 * captureScrollSnapshot() — runs inside the target tab via executeScript.
 *
 * Collects:
 *   1. document scroll (window.scrollX/Y, falls back to
 *      document.scrollingElement for quirks-mode pages)
 *   2. Every scrollable element that has been scrolled away from
 *      its origin (scrollTop > 0 or scrollLeft > 0). Each gets a
 *      stable CSS selector so we can find the same element again
 *      on restore.
 *
 * Inlined as a top-level function so it serialises cleanly across
 * the executeScript boundary (no closures over module state).
 */
function captureScrollSnapshot() {
  function isScrollable(el) {
    if (!el || el === document.documentElement || el === document.body) return false;
    const cs = getComputedStyle(el);
    const overflowY = cs.overflowY === 'auto' || cs.overflowY === 'scroll' || cs.overflow === 'auto' || cs.overflow === 'scroll';
    const overflowX = cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflow === 'auto' || cs.overflow === 'scroll';
    return overflowY || overflowX;
  }

  function selectorFor(el) {
    if (!el || el === document.body || el === document.documentElement) return null;
    const path = [];
    let cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      let seg = cur.tagName.toLowerCase();
      if (cur.id) { seg += '#' + cur.id; path.unshift(seg); break; }
      const parent = cur.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
        if (sibs.length > 1) seg += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
      }
      path.unshift(seg);
      cur = parent;
    }
    return path.length ? path.join(' > ') : null;
  }

  // Walk every element via tree walker; cheap enough for normal pages.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  const containers = [];
  let node;
  while ((node = walker.nextNode())) {
    if (!isScrollable(node)) continue;
    const top   = node.scrollTop  || 0;
    const left  = node.scrollLeft || 0;
    if (top === 0 && left === 0) continue;
    const selector = selectorFor(node);
    if (!selector) continue;
    containers.push({ selector, top, left });
  }

  return {
    window: {
      x: window.scrollX || (document.scrollingElement && document.scrollingElement.scrollLeft) || 0,
      y: window.scrollY || (document.scrollingElement && document.scrollingElement.scrollTop) || 0,
    },
    containers,
  };
}

// Scroll a freshly-opened tab to the captured position. Tries repeatedly
// for up to 2.5s, because lazy-loaded pages may need a moment to settle.
//
// `snap` is either the legacy {scrollX, scrollY} shape (window-only) or
// the new {window: {x,y}, containers: [{selector, top, left}]} shape.
async function restoreScrollForTab(tabId, snapOrX, y) {
  if (tabId == null) return;
  // Accept either (tabId, snap) or (tabId, x, y) for backwards-compat.
  let snap;
  if (typeof snapOrX === 'object' && snapOrX !== null) {
    snap = snapOrX;
  } else if (typeof snapOrX === 'number' || typeof y === 'number') {
    snap = { window: { x: snapOrX || 0, y: y || 0 }, containers: [] };
  } else {
    return;
  }

  // Normalise legacy {scrollX, scrollY} at the top level into the
  // new {window: {x, y}, containers: []} shape.
  if (!snap.window && (snap.scrollX != null || snap.scrollY != null)) {
    snap = { window: { x: snap.scrollX || 0, y: snap.scrollY || 0 }, containers: [] };
  }

  const winX = (snap.window && snap.window.x) || 0;
  const winY = (snap.window && snap.window.y) || 0;
  const containers = Array.isArray(snap.containers) ? snap.containers : [];

  // Nothing to restore — bail early.
  if (!winX && !winY && containers.length === 0) {
    return;
  }

  const tryRestore = async (attempt) => {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: restoreScrollSnapshot,
        args: [winX, winY, containers],
      });
    } catch (err) {
      // Swallow — script injection can fail on restricted pages (chrome://,
      // file://, the Chrome Web Store). Snapshots just won't restore there.
    }
  };

  // First attempt immediately, then back off (covers lazy content).
  await tryRestore(1);
  for (const ms of [200, 500, 1000, 2000]) {
    await new Promise(r => setTimeout(r, ms));
    await tryRestore(ms);
  }
}

/**
 * restoreScrollSnapshot(winX, winY, containers) — runs inside the target
 * tab via executeScript. Restores window scroll and each captured
 * container's scrollTop/scrollLeft. Identifies containers by the CSS
 * selector recorded at capture time.
 *
 * Inlined as a top-level function so it serialises cleanly across the
 * executeScript boundary.
 */
function restoreScrollSnapshot(winX, winY, containers) {
  let logged = '';
  // 1) Window / document scroll
  if (winX || winY) {
    const curX = window.scrollX || (document.scrollingElement && document.scrollingElement.scrollLeft) || 0;
    const curY = window.scrollY || (document.scrollingElement && document.scrollingElement.scrollTop) || 0;
    if (Math.abs(curY - winY) > 5 || Math.abs(curX - winX) > 5) {
      window.scrollTo(winX, winY);
      logged += `window: (${curX},${curY}) -> (${winX},${winY}); `;
    } else {
      logged += `window: already at (${curX},${curY}); `;
    }
  }

  // 2) Each captured container
  if (!Array.isArray(containers)) {
    return;
  }
  for (const c of containers) {
    if (!c || !c.selector) continue;
    try {
      const el = document.querySelector(c.selector);
      if (!el) {
        logged += `container "${c.selector}" NOT FOUND; `;
        continue;
      }
      const wantTop  = c.top  || 0;
      const wantLeft = c.left || 0;
      const curTop   = el.scrollTop  || 0;
      const curLeft  = el.scrollLeft || 0;
      if (Math.abs(curTop - wantTop) > 5 || Math.abs(curLeft - wantLeft) > 5) {
        el.scrollTop  = wantTop;
        el.scrollLeft = wantLeft;
        logged += `"${c.selector}" (${curTop},${curLeft}) -> (${wantTop},${wantLeft}); `;
      } else {
        logged += `"${c.selector}" already at (${curTop},${curLeft}); `;
      }
    } catch (err) {
      // Skip selectors that no longer exist or are not scrollable.
    }
  }
}


/* ----------------------------------------------------------------
   CHROME TABS — Direct API Access

   Since this page IS the extension's new tab page, it has full
   access to chrome.tabs and chrome.storage. No middleman needed.
   ---------------------------------------------------------------- */

// All open tabs — populated by fetchOpenTabs()
let openTabs = [];

// Closed tab stack for undo — each entry: { url, title, favIconUrl, windowId, active }
// chrome.sessions.restore() does NOT work for tabs closed via chrome.tabs.remove(),
// so we track them ourselves and restore via chrome.tabs.create().
const _closedTabStack = [];

// Cache of bookmarked URLs — used to flip chip ⭐ from outlined to filled.
// Refreshed on init and after each bookmark action.
let _bookmarkedUrlsCache = new Set();

/**
 * refreshBookmarkedUrlsCache()
 *
 * Walks the entire bookmark tree once and stores every URL in a Set.
 * Cheap for normal users (a few hundred bookmarks); gracefully no-ops
 * if the bookmarks API isn't available.
 */
async function refreshBookmarkedUrlsCache() {
  try {
    if (!chrome.bookmarks || !chrome.bookmarks.getTree) return;
    const tree = await chrome.bookmarks.getTree();
    const urls = new Set();
    (function walk(node) {
      if (node.url) urls.add(node.url);
      if (node.children) for (const c of node.children) walk(c);
    })(tree[0] || { children: tree });
    _bookmarkedUrlsCache = urls;
  } catch (err) {
    console.warn('[TabCtrl] refreshBookmarkedUrlsCache failed:', err);
  }
}

/**
 * buildBookmarkTreeHTML(tree) — turn the recursive bookmark tree into HTML
 * for a collapsible folder picker. Top-level folders are returned as
 * <div class='bookmark-tree-node'> with nested children; each row carries
 * data-folder-id so we can read the selection back out.
 *
 * If 'currentFolderId' is given, the path from the root to that folder is
 * auto-expanded so the user can see where the bookmark currently lives.
 */
function buildBookmarkTreeHTML(tree, currentFolderId) {
  // Pre-walk to compute which folder IDs are ancestors of the current one
  const ancestors = new Set();
  if (currentFolderId) {
    function markAncestors(node, path) {
      if (!node.children) return;
      for (const c of node.children) {
        if (c.id === currentFolderId) {
          for (const a of path) ancestors.add(a.id);
          return;
        }
        if (c.children) markAncestors(c, path.concat(c));
      }
    }
    for (const root of tree) {
      if (root.id === currentFolderId) {
        ancestors.add(root.id);
        break;
      }
      markAncestors(root, [root]);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function renderNode(node, isRoot) {
    if (!node.children) return ''; // skip bookmark items (leaves)
    const indent = isRoot ? '' : '  ';
    const hasChildren = node.children.some((c) => c.children);
    const isExpanded = ancestors.has(node.id);
    const isSelected = node.id === currentFolderId;
    const caretClass = hasChildren ? '' : 'leaf';
    const expandedClass = isExpanded ? ' expanded' : '';
    const selectedClass = isSelected ? ' selected' : '';
    const currentTag = isSelected ? '<span class="bookmark-tree-current">(current)</span>' : '';

    let html = indent + '<div class="bookmark-tree-node' + expandedClass + '" data-folder-id="' + escapeHtml(node.id) + '">';
    html += '<div class="bookmark-tree-row' + selectedClass + '" data-action="bookmark-tree-select" data-folder-id="' + escapeHtml(node.id) + '">';
    html += '<span class="bookmark-tree-caret ' + caretClass + '" data-action="bookmark-tree-toggle">▶</span>';
    html += '<span class="bookmark-tree-icon">📁</span>';
    html += '<span class="bookmark-tree-name">' + escapeHtml(node.title || 'Untitled') + '</span>';
    html += currentTag;
    html += '</div>';
    if (hasChildren) {
      html += '<div class="bookmark-tree-children">';
      for (const child of node.children) {
        html += renderNode(child, false);
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  let out = '';
  // Skip the synthetic wrapper node (id '0') and render its top-level children
  for (const root of tree) {
    if (root.id === '0' && root.children) {
      for (const c of root.children) out += renderNode(c, true);
    } else {
      out += renderNode(root, true);
    }
  }
  return out;
}

/**
 * getSelectedBookmarkFolder(treeEl) — read the currently-selected folder
 * ID out of the rendered tree (stored in data-selected-id). Returns '' if
 * nothing is selected.
 */
function getSelectedBookmarkFolder(treeEl) {
  return (treeEl && treeEl.dataset && treeEl.dataset.selectedId) || '';
}

/**
 * setSelectedBookmarkFolder(treeEl, folderId) — mark a folder row as
 * selected and persist its id in the tree element's data attribute.
 */
function setSelectedBookmarkFolder(treeEl, folderId) {
  if (!treeEl) return;
  treeEl.dataset.selectedId = folderId || '';
  // Update visual selection without re-rendering (preserves expansion state)
  treeEl.querySelectorAll('.bookmark-tree-row').forEach((row) => {
    if (row.dataset.folderId === folderId) {
      row.classList.add('selected');
    } else {
      row.classList.remove('selected');
    }
  });
}

/**
 * closeSingleTabAndTrack(tabId)
 *
 * Closes a tab and records it to _closedTabStack so the undo button
 * can restore it via chrome.tabs.create() instead of chrome.sessions.restore().
 */
async function closeSingleTabAndTrack(tabId) {
  const allTabs = await chrome.tabs.query({});
  const tab = allTabs.find(t => t.id === tabId);
  if (!tab || !tab.url) return null;
  const entry = {
    url:        tab.url,
    title:      tab.title      || tab.url,
    favIconUrl: tab.favIconUrl || '',
    windowId:   tab.windowId,
    active:     tab.active,
  };
  _closedTabStack.push(entry);
  await chrome.tabs.remove(tabId);
  return entry;
}

/**
 * undoClose()
 *
 * Restores the most recently closed tab(s) by re-creating them via
 * chrome.tabs.create(). Returns the number of tabs restored.
 */
async function undoClose() {
  const tabsToRestore = _closedTabStack.splice(0); // pop all
  for (const entry of tabsToRestore.reverse()) { // restore in original order
    try {
      const newTab = await chrome.tabs.create({
        url:     entry.url,
        windowId: entry.windowId,
        active:  entry.active,
      });
      // If it was the active tab, focus the window
      if (entry.active && entry.windowId) {
        try { await chrome.windows.update(entry.windowId, { focused: true }); } catch {}
      }
    } catch (err) {
      console.warn('[TabCtrl] undoClose failed for', entry.url, err);
    }
  }
  return tabsToRestore.length;
}

/**
 * fetchOpenTabs()
 *
 * Reads all currently open browser tabs directly from Chrome.
 * Sets the extensionId flag so we can identify TabCtrl's own pages.
 */
async function fetchOpenTabs() {
  try {
    const extensionId = chrome.runtime.id;
    // The new URL for this page is now index.html (not newtab.html)
    const newtabUrl = `chrome-extension://${extensionId}/index.html`;

    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => ({
      id:         t.id,
      url:        t.url,
      title:      t.title,
      windowId:   t.windowId,
      active:     t.active,
      favIconUrl: t.favIconUrl,  // Chrome already fetched this; use it directly instead of hitting an external service
      // Flag TabCtrl's own pages so we can detect duplicate new tabs
      isTableControl: t.url === newtabUrl || t.url === 'chrome://newtab/',
    }));
  } catch {
    // chrome.tabs API unavailable (shouldn't happen in an extension page)
    openTabs = [];
  }
}

/**
 * closeTabsByUrls(urls)
 *
 * Closes all open tabs whose hostname matches any of the given URLs.
 * After closing, re-fetches the tab list to keep our state accurate.
 *
 * Special case: file:// URLs are matched exactly (they have no hostname).
 */
async function closeTabsByUrls(urls) {
  if (!urls || urls.length === 0) return [];

  // Separate file:// URLs (exact match) from regular URLs (hostname match)
  const targetHostnames = [];
  const exactUrls = new Set();

  for (const u of urls) {
    if (u.startsWith('file://')) {
      exactUrls.add(u);
    } else {
      try { targetHostnames.push(new URL(u).hostname); }
      catch { /* skip unparseable */ }
    }
  }

  const allTabs = await chrome.tabs.query({});
  const matched = allTabs.filter(tab => {
    const tabUrl = tab.url || '';
    if (tabUrl.startsWith('file://') && exactUrls.has(tabUrl)) return true;
    try {
      const tabHostname = new URL(tabUrl).hostname;
      return tabHostname && targetHostnames.includes(tabHostname);
    } catch { return false; }
  });
  const toClose = matched.map(tab => tab.id);

  if (toClose.length > 0) {
    // Track for undo before closing
    for (const tab of matched) {
      if (tab.url) {
        _closedTabStack.push({
          url:        tab.url,
          title:      tab.title      || tab.url,
          favIconUrl: tab.favIconUrl || '',
          windowId:   tab.windowId,
          active:     tab.active,
        });
      }
    }
    // Record insights (skip chrome:// / about: / extension pages)
    recordCloseEvents(matched.filter(t => isInsightable(t.url)));
    await chrome.tabs.remove(toClose);
  }
  await fetchOpenTabs();
  return matched;
}

/**
 * closeTabsExact(urls)
 *
 * Closes tabs by exact URL match (not hostname). Used for landing pages
 * so closing "Gmail inbox" doesn't also close individual email threads.
 */
async function closeTabsExact(urls) {
  if (!urls || urls.length === 0) return [];
  const urlSet = new Set(urls);
  const allTabs = await chrome.tabs.query({});
  const matched = allTabs.filter(t => urlSet.has(t.url));
  const toClose = matched.map(t => t.id);
  if (toClose.length > 0) {
    // Track for undo before closing
    for (const tab of matched) {
      if (tab.url) {
        _closedTabStack.push({
          url:        tab.url,
          title:      tab.title      || tab.url,
          favIconUrl: tab.favIconUrl || '',
          windowId:   tab.windowId,
          active:     tab.active,
        });
      }
    }
    recordCloseEvents(matched.filter(t => isInsightable(t.url)));
    await chrome.tabs.remove(toClose);
  }
  await fetchOpenTabs();
  return matched;
}

/**
 * focusTab(url)
 *
 * Switches Chrome to the tab with the given URL (exact match first,
 * then hostname fallback). Also brings the window to the front.
 */
async function focusTab(url) {
  if (!url) return;
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();

  // Try exact URL match first
  let matches = allTabs.filter(t => t.url === url);

  // Fall back to hostname match
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter(t => {
        try { return new URL(t.url).hostname === targetHost; }
        catch { return false; }
      });
    } catch {}
  }

  if (matches.length === 0) return;

  // Prefer a match in a different window so it actually switches windows
  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
}

/**
 * closeDuplicateTabs(fingerprints, keepOne)
 *
 * Closes duplicate tabs for the given list of fingerprints.
 * (A fingerprint is a SHA-256 prefix of the normalised URL — see
 * urlFingerprint().) Using fingerprints instead of raw URLs means
 * we collapse URLs that are equivalent under our normalisation
 * (tracking params stripped, host lowercased, etc.).
 * keepOne=true → keep one copy of each, close the rest.
 * keepOne=false → close all copies.
 */
async function closeDuplicateTabs(fingerprints, keepOne = true) {
  const allTabs = await chrome.tabs.query({});
  const toCloseTabs = [];
  const toClose = [];

  for (const fp of fingerprints) {
    const matching = [];
    for (const tab of allTabs) {
      if ((await urlFingerprint(tab.url)) === fp) matching.push(tab);
    }
    if (keepOne) {
      const keep = matching.find(t => t.active) || matching[0];
      for (const tab of matching) {
        if (tab.id !== keep.id) {
          toClose.push(tab.id);
          toCloseTabs.push(tab);
        }
      }
    } else {
      for (const tab of matching) {
        toClose.push(tab.id);
        toCloseTabs.push(tab);
      }
    }
  }

  if (toClose.length > 0) {
    // Track for undo before closing
    for (const tab of toCloseTabs) {
      if (tab.url) {
        _closedTabStack.push({
          url:        tab.url,
          title:      tab.title      || tab.url,
          favIconUrl: tab.favIconUrl || '',
          windowId:   tab.windowId,
          active:     tab.active,
        });
      }
    }
    recordCloseEvents(toCloseTabs.filter(t => isInsightable(t.url)));
    await chrome.tabs.remove(toClose);
  }
  await fetchOpenTabs();
}

/**
 * closeTableControlDupes()
 *
 * Closes all duplicate TabCtrl new-tab pages except the current one.
 */
async function closeTableControlDupes() {
  const extensionId = chrome.runtime.id;
  const newtabUrl = `chrome-extension://${extensionId}/index.html`;

  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  const tableControlTabs = allTabs.filter(t =>
    t.url === newtabUrl || t.url === 'chrome://newtab/'
  );

  if (tableControlTabs.length <= 1) return;

  // Keep the active TabCtrl tab in the CURRENT window — that's the one the
  // user is looking at right now. Falls back to any active one, then the first.
  const keep =
    tableControlTabs.find(t => t.active && t.windowId === currentWindow.id) ||
    tableControlTabs.find(t => t.active) ||
    tableControlTabs[0];
  const toClose = tableControlTabs.filter(t => t.id !== keep.id).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — chrome.storage.local

   Replaces the old server-side SQLite + REST API with Chrome's
   built-in key-value storage. Data persists across browser sessions
   and doesn't require a running server.

   Data shape stored under the "deferred" key:
   [
     {
       id: "1712345678901",          // timestamp-based unique ID
       url: "https://example.com",
       title: "Example Page",
       savedAt: "2026-04-04T10:00:00.000Z",  // ISO date string
       completed: false,             // true = checked off (archived)
       dismissed: false              // true = dismissed without reading
     },
     ...
   ]
   ---------------------------------------------------------------- */

/**
 * saveTabForLater(tab)
 *
 * Saves a single tab to the "Saved for Later" list in chrome.storage.local.
 * @param {{ url: string, title: string }} tab
 */
async function saveTabForLater(tab) {
  // Legacy entry point used by other call sites; delegates to addToStash.
  // Old "deferred" key is no longer written — see migrateDeferredToStash().
  return addToStash(tab);
}

/**
 * getSavedTabs()
 *
 * Returns all saved tabs from chrome.storage.local.
 * Filters out dismissed items (those are gone for good).
 * Splits into active (not completed) and archived (completed).
 */
async function getSavedTabs() {
  // Legacy entry point. Reads from the new stash key for any caller that
  // still uses the old shape. Most call sites should use getStash().
  const stash = await getStash();
  return {
    active:   stash,
    archived: [],   // completed/archived no longer a thing in the new model
  };
}

/**
 * getStash() — read all parked tabs from chrome.storage.local.stash.
 * Filters out dismissed items. Items carry categoryId for grouping.
 */
async function getStash() {
  const { stash = [] } = await chrome.storage.local.get('stash');
  return Array.isArray(stash) ? stash.filter(it => it && !it.dismissed) : [];
}

/**
 * getStashCategories() — read user-managed category list from settings.
 * Falls back to the built-in Unsorted category if settings are missing.
 */
async function getStashCategories() {
  try {
    const settings = await settingsAPI.getSettings();
    const list = settings.stashCategories || [];
    return list.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  } catch {
    return [{ id: 'cat_unsorted', name: 'Unsorted', order: 0 }];
  }
}

/**
 * addToStash(tab) — park a tab in the stash (replaces saveTabForLater).
 * Returns the new stash item id.
 */
/**
 * migrateStashDuplicates() — one-shot pass: collapse pre-merge stash
 * entries with the same fingerprint into a single item with count + a
 * savedAtHistory array. Idempotent via the _stashDupMigrated flag.
 */
async function migrateStashDuplicates() {
  const FLAG = '_stashDupMigrated';
  const stored = await chrome.storage.local.get(['stash', FLAG]);
  if (stored[FLAG]) return;
  const list = Array.isArray(stored.stash) ? stored.stash : [];
  if (list.length === 0) {
    await chrome.storage.local.set({ [FLAG]: Date.now() });
    return;
  }
  // Group by fingerprint (fall back to raw URL for very old items
  // that predate the fingerprint migration).
  const byFp = new Map();
  for (const it of list) {
    const fp = it.fingerprint || it.url;
    if (!fp) continue;
    if (!byFp.has(fp)) byFp.set(fp, []);
    byFp.get(fp).push(it);
  }
  const merged = [];
  for (const [, group] of byFp) {
    if (group.length === 1) {
      const it = group[0];
      if (!it.count) it.count = 1;
      if (!Array.isArray(it.savedAtHistory) || it.savedAtHistory.length === 0) {
        it.savedAtHistory = [it.savedAt || Date.now()];
      }
      merged.push(it);
      continue;
    }
    // Multi-item: keep the most recent item as the primary and
    // merge the rest into it. Take the latest snapshot we have.
    group.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    const primary = group[0];
    const history = group.map(it => it.savedAt || Date.now()).sort((a, b) => b - a);
    primary.count          = group.length;
    primary.savedAtHistory = history;
    primary.savedAt        = history[0];
    const withSnap = group.find(it => it.snapshot);
    if (withSnap) primary.snapshot = withSnap.snapshot;
    merged.push(primary);
  }
  await chrome.storage.local.set({ stash: merged, [FLAG]: Date.now() });
}

async function addToStash(tab) {
  if (!tab || !tab.url) return null;
  const list = await getStash();
  const fingerprint = await urlFingerprint(tab.url);
  const now = Date.now();

  // Merge into an existing item with the same fingerprint, if any.
  // 7 identical stashes should become ONE stash item with count=7,
  // not 7 separate rows. (Open tabs section keeps them separate on
  // purpose — see the design note in commit e1d3fe7.)
  const existing = list.find(it => (it.fingerprint || it.url) === fingerprint);
  if (existing) {
    existing.count = (existing.count || 1) + 1;
    existing.savedAt = now;
    if (!Array.isArray(existing.savedAtHistory)) existing.savedAtHistory = [existing.savedAt || now];
    existing.savedAtHistory.push(now);
    // Refresh the visible fields with the most recent stash
    if (tab.title) existing.title = tab.title || existing.title;
    if (tab.favIconUrl) existing.favIconUrl = tab.favIconUrl;
    // Best-effort: refresh the snapshot too. We don't await the
    // snapshot capture here if the user is re-stashing quickly — we
    // capture in the background and let the most recent snapshot win.
    captureTabSnapshot(tab).then(snap => {
      if (snap) {
        // Re-read the item from storage in case the user dismissed
        // it between the parallel calls.
        getStash().then(current => {
          const it = current.find(x => x.id === existing.id);
          if (it) {
            it.snapshot = snap;
            chrome.storage.local.set({ stash: current });
          }
        });
      }
    }).catch(() => {});
    await chrome.storage.local.set({ stash: list });
    return existing.id;
  }

  // New item
  const id = 'st_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const snap = await captureTabSnapshot(tab);
  const item = {
    id,
    url:         tab.url,
    title:       tab.title || tab.url || '',
    favIconUrl:  tab.favIconUrl || '',
    savedAt:     now,
    categoryId:  'cat_unsorted',
    note:        '',
    fingerprint,
    snapshot: snap || null,
    count:           1,
    savedAtHistory:  [now],
  };
  list.unshift(item);
  await chrome.storage.local.set({ stash: list });
  return id;
}

/**
 * removeFromStash(id) — drop one item.
 */
async function removeFromStash(id) {
  const list = await getStash();
  const next = list.filter(it => it.id !== id);
  if (next.length !== list.length) {
    await chrome.storage.local.set({ stash: next });
  }
}

/**
 * updateStashItem(id, patch) — partial update of one item (e.g. moveCategory).
 */
async function updateStashItem(id, patch) {
  const list = await getStash();
  let changed = false;
  const next = list.map(it => {
    if (it.id !== id) return it;
    changed = true;
    return { ...it, ...patch };
  });
  if (changed) await chrome.storage.local.set({ stash: next });
  return changed;
}

/**
 * moveStashToCategory(itemId, categoryId) — convenience wrapper.
 */
async function moveStashToCategory(itemId, categoryId) {
  return updateStashItem(itemId, { categoryId });
}

/**
 * saveStashCategories(categories) — replace user category list.
 */
async function saveStashCategories(categories) {
  const settings = await settingsAPI.getSettings();
  settings.stashCategories = categories.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  await settingsAPI.saveSettings(settings);
}

/**
 * migrateDeferredToStash() — one-shot migration from the old "deferred"
 * (completed/dismissed) shape into the new "stash" (categoryId) shape.
 *
 * Called once at boot. Removes the old `deferred` key after migration
 * (but leaves the data in `archiveRetentionDays`/settings for users
 * who want to roll back).
 *
 * Safe to call repeatedly: if `stash` already exists we assume migration
 * has happened and skip.
 */
async function migrateDeferredToStash() {
  const stored = await chrome.storage.local.get(['stash', 'deferred', '_stashMigrated']);
  if (stored._stashMigrated) return;            // already done
  if (!Array.isArray(stored.deferred) || stored.deferred.length === 0) {
    await chrome.storage.local.set({ _stashMigrated: Date.now() });
    return;
  }
  const stash = (Array.isArray(stored.stash) ? stored.stash : []).slice();
  const seen = new Set(stash.map(it => it.id));
  for (const old of stored.deferred) {
    if (!old || old.dismissed || !old.url) continue;
    const id = old.id || ('st_' + (old.savedAt || Date.now()).toString(36) + Math.random().toString(36).slice(2, 6));
    if (seen.has(id)) continue;
    stash.unshift({
      id,
      url:        old.url,
      title:      old.title || old.url || '',
      favIconUrl: old.favIconUrl || '',
      savedAt:    old.savedAt    || Date.now(),
      categoryId: 'cat_unsorted',
      note:       old.note || '',
    });
    seen.add(id);
  }
  await chrome.storage.local.set({ stash, _stashMigrated: Date.now() });
}

/**
 * getHistory() — read the rolling history buffer populated by background.js
 * when tabs close. Returns the full array (already pruned by background.js).
 */
async function getHistory() {
  const { history = [] } = await chrome.storage.local.get('history');
  return Array.isArray(history) ? history : [];
}

// (Removed in commit 4: checkOffSavedTab + dismissSavedTab. Replaced
//  by updateStashItem + removeFromStash — the new Tab Stash model
//  doesn't have a "completed" flag.)


/* ----------------------------------------------------------------
   UI HELPERS
   ---------------------------------------------------------------- */

/**
 * shootConfetti(x, y)
 *
 * Shoots a burst of colorful confetti particles from the given screen
 * coordinates (typically the center of a card being closed).
 * Pure CSS + JS, no libraries.
 */
function shootConfetti(x, y) {
  const colors = [
    '#c8713a', // amber
    '#e8a070', // amber light
    '#5a7a62', // sage
    '#8aaa92', // sage light
    '#5a6b7a', // slate
    '#8a9baa', // slate light
    '#d4b896', // warm paper
    '#b35a5a', // rose
  ];

  const particleCount = 17;

  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');

    const isCircle = Math.random() > 0.5;
    const size = 5 + Math.random() * 6; // 5–11px
    const color = colors[Math.floor(Math.random() * colors.length)];

    el.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${isCircle ? '50%' : '2px'};
      pointer-events: none;
      z-index: 9999;
      transform: translate(-50%, -50%);
      opacity: 1;
    `;
    document.body.appendChild(el);

    // Physics: random angle and speed for the outward burst
    const angle   = Math.random() * Math.PI * 2;
    const speed   = 60 + Math.random() * 120;
    const vx      = Math.cos(angle) * speed;
    const vy      = Math.sin(angle) * speed - 80; // bias upward
    const gravity = 200;

    const startTime = performance.now();
    const duration  = 700 + Math.random() * 200; // 700–900ms

    function frame(now) {
      const elapsed  = (now - startTime) / 1000;
      const progress = elapsed / (duration / 1000);

      if (progress >= 1) { el.remove(); return; }

      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      const rotate  = elapsed * 200 * (isCircle ? 0 : 1);

      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
      el.style.opacity = opacity;

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }
}

/**
 * animateCardOut(card)
 *
 * Smoothly removes a mission card: fade + scale down, then confetti.
 * After the animation, checks if the grid is now empty.
 */
function animateCardOut(card) {
  if (!card) return;

  const rect = card.getBoundingClientRect();
  shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);

  card.classList.add('closing');
  setTimeout(() => {
    card.remove();
    checkAndShowEmptyState();
  }, 300);
}

/**
 * showToast(message)
 *
 * Brief pop-up notification at the bottom of the screen.
 */
function showToast(message, options = {}) {
  const toast = document.getElementById('toast');
  const text = document.getElementById('toastText');

  if (toast._hideTimeout) clearTimeout(toast._hideTimeout);

  // Build content (always rebuild from scratch — avoids stale state bugs)
  text.innerHTML = '';
  const msgSpan = document.createElement('span');
  msgSpan.textContent = message;
  text.appendChild(msgSpan);

  if (options.undoCallback) {
    const undoBtn = document.createElement('button');
    undoBtn.className = 'toast-undo-btn';
    undoBtn.textContent = options.undoLabel || t('toast.undo');
    // Use closure — capture callback directly, no shared toast state
    const cb = options.undoCallback;
    undoBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      toast.classList.remove('visible');
      if (toast._hideTimeout) clearTimeout(toast._hideTimeout);
      try {
        await cb();
      } catch (err) {
        console.error('[TabCtrl] Undo failed:', err);
        showToast(t('toast.undo_failed') || 'Undo failed');
      }
    });
    text.appendChild(undoBtn);
  }

  toast.classList.add('visible');
  toast._hideTimeout = setTimeout(() => {
    toast.classList.remove('visible');
  }, options.duration || 6000);
}

/**
 * checkAndShowEmptyState()
 *
 * Shows a cheerful "Inbox zero" message when all domain cards are gone.
 */
function checkAndShowEmptyState() {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;

  const remaining = missionsEl.querySelectorAll('.mission-card:not(.closing)').length;
  if (remaining > 0) return;

  missionsEl.innerHTML = `
    <div class="missions-empty-state">
      <div class="empty-checkmark">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>
      <div class="empty-title">${t('empty.title')}</div>
      <div class="empty-subtitle">${t('empty.subtitle')}</div>
    </div>
  `;

  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) countEl.textContent = t('empty.domains_zero');
}

/**
 * timeAgo(dateStr)
 *
 * Converts an ISO date string into a human-friendly relative time.
 * "2026-04-04T10:00:00Z" → "2 hrs ago" or "yesterday"
 */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr);
  const now  = new Date();
  const diffMins  = Math.floor((now - then) / 60000);
  const diffHours = Math.floor((now - then) / 3600000);
  const diffDays  = Math.floor((now - then) / 86400000);

  if (diffMins < 1)   return t('time.just_now');
  if (diffMins < 60)  return t('time.min_ago', diffMins);
  if (diffHours < 24) return t(diffHours !== 1 ? 'time.hr_ago_plural' : 'time.hr_ago', diffHours);
  if (diffDays === 1) return t('time.yesterday');
  return t('time.days_ago', diffDays);
}




/* ----------------------------------------------------------------
   DOMAIN & TITLE CLEANUP HELPERS
   ---------------------------------------------------------------- */

// Map of known hostnames → friendly display names.
const FRIENDLY_DOMAINS = {
  'github.com':           'GitHub',
  'www.github.com':       'GitHub',
  'gist.github.com':      'GitHub Gist',
  'youtube.com':          'YouTube',
  'www.youtube.com':      'YouTube',
  'music.youtube.com':    'YouTube Music',
  'x.com':                'X',
  'www.x.com':            'X',
  'twitter.com':          'X',
  'www.twitter.com':      'X',
  'reddit.com':           'Reddit',
  'www.reddit.com':       'Reddit',
  'old.reddit.com':       'Reddit',
  'substack.com':         'Substack',
  'www.substack.com':     'Substack',
  'medium.com':           'Medium',
  'www.medium.com':       'Medium',
  'linkedin.com':         'LinkedIn',
  'www.linkedin.com':     'LinkedIn',
  'stackoverflow.com':    'Stack Overflow',
  'www.stackoverflow.com':'Stack Overflow',
  'news.ycombinator.com': 'Hacker News',
  'google.com':           'Google',
  'www.google.com':       'Google',
  'mail.google.com':      'Gmail',
  'docs.google.com':      'Google Docs',
  'drive.google.com':     'Google Drive',
  'calendar.google.com':  'Google Calendar',
  'meet.google.com':      'Google Meet',
  'gemini.google.com':    'Gemini',
  'chatgpt.com':          'ChatGPT',
  'www.chatgpt.com':      'ChatGPT',
  'chat.openai.com':      'ChatGPT',
  'claude.ai':            'Claude',
  'www.claude.ai':        'Claude',
  'code.claude.com':      'Claude Code',
  'notion.so':            'Notion',
  'www.notion.so':        'Notion',
  'figma.com':            'Figma',
  'www.figma.com':        'Figma',
  'slack.com':            'Slack',
  'app.slack.com':        'Slack',
  'discord.com':          'Discord',
  'www.discord.com':      'Discord',
  'wikipedia.org':        'Wikipedia',
  'en.wikipedia.org':     'Wikipedia',
  'amazon.com':           'Amazon',
  'www.amazon.com':       'Amazon',
  'netflix.com':          'Netflix',
  'www.netflix.com':      'Netflix',
  'spotify.com':          'Spotify',
  'open.spotify.com':     'Spotify',
  'vercel.com':           'Vercel',
  'www.vercel.com':       'Vercel',
  'npmjs.com':            'npm',
  'www.npmjs.com':        'npm',
  'developer.mozilla.org':'MDN',
  'arxiv.org':            'arXiv',
  'www.arxiv.org':        'arXiv',
  'huggingface.co':       'Hugging Face',
  'www.huggingface.co':   'Hugging Face',
  'producthunt.com':      'Product Hunt',
  'www.producthunt.com':  'Product Hunt',
  'xiaohongshu.com':      'RedNote',
  'www.xiaohongshu.com':  'RedNote',
  'local-files':          'Local Files',
};

function friendlyDomain(hostname) {
  if (!hostname) return '';
  // Exact match in known brand table — return the friendly name.
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];

  // Fallback: strip multi-part public-suffix TLDs so the displayed
  // label is the brand name, not the full eTLD+1.
  //   ruijie.com.cn → "ruijie"
  //   bbc.co.uk     → "bbc"
  //   sina.com.cn   → "sina"
  //   foo.cn        → "foo.cn"  (unchanged — .cn is single-part)
  //   github.com    → "github.com" (unchanged — .com is single-part)
  // Uses window.MULTI_PART_TLDS exposed by settings.js.
  const tldSet = (typeof window !== 'undefined' && window.MULTI_PART_TLDS) || null;
  if (tldSet && typeof tldSet.has === 'function') {
    const lastDot = hostname.lastIndexOf('.');
    if (lastDot > 0) {
      const prevDot = hostname.lastIndexOf('.', lastDot - 1);
      if (prevDot > 0) {
        const tld = hostname.slice(prevDot + 1); // e.g. 'com.cn', 'co.uk'
        if (tldSet.has(tld)) {
          return hostname.slice(0, prevDot); // brand only
        }
      }
    }
  }

  return hostname;
}

function stripTitleNoise(title) {
  if (!title) return '';
  // Strip leading notification count: "(2) Title"
  title = title.replace(/^\(\d+\+?\)\s*/, '');
  // Strip inline counts like "Inbox (16,359)"
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
  // Strip email addresses (privacy + cleaner display)
  title = title.replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  // Clean X/Twitter format
  title = title.replace(/\s+on X:\s*/, ': ');
  title = title.replace(/\s*\/\s*X\s*$/, '');
  return title.trim();
}

function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';

  const friendly = friendlyDomain(hostname);
  const domain   = hostname.replace(/^www\./, '');
  const seps     = [' - ', ' | ', ' — ', ' · ', ' – '];

  for (const sep of seps) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix     = title.slice(idx + sep.length).trim();
    const suffixLow  = suffix.toLowerCase();
    if (
      suffixLow === domain.toLowerCase() ||
      suffixLow === friendly.toLowerCase() ||
      suffixLow === domain.replace(/\.\w+$/, '').toLowerCase() ||
      domain.toLowerCase().includes(suffixLow) ||
      friendly.toLowerCase().includes(suffixLow)
    ) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title, url) {
  if (!url) return title || '';
  let pathname = '', hostname = '';
  try { const u = new URL(url); pathname = u.pathname; hostname = u.hostname; }
  catch { return title || ''; }

  const titleIsUrl = !title || title === url || title.startsWith(hostname) || title.startsWith('http');

  if ((hostname === 'x.com' || hostname === 'twitter.com' || hostname === 'www.x.com') && pathname.includes('/status/')) {
    const username = pathname.split('/')[1];
    if (username) return titleIsUrl ? `Post by @${username}` : title;
  }

  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const [owner, repo, ...rest] = parts;
      if (rest[0] === 'issues' && rest[1]) return `${owner}/${repo} Issue #${rest[1]}`;
      if (rest[0] === 'pull'   && rest[1]) return `${owner}/${repo} PR #${rest[1]}`;
      if (rest[0] === 'blob' || rest[0] === 'tree') return `${owner}/${repo} — ${rest.slice(2).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }
  }

  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') {
    if (titleIsUrl) return 'YouTube Video';
  }

  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts  = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1]) {
      if (titleIsUrl) return `r/${parts[subIdx + 1]} post`;
    }
  }

  // Fallback: if we have no real title (undefined/empty) and the URL
  // didn't match any smart pattern (e.g. github.com landing '/'), use
  // the friendly domain as the chip label rather than dumping the raw URL.
  if (!title) return friendlyDomain(hostname) || url;
  return title;
}


/* ----------------------------------------------------------------
   GLOBAL ERROR HANDLER — hide broken favicons

   Manifest V3 CSP forbids inline event handlers like `onerror=`.
   We delegate img error events to one document-level listener
   (capture phase) and hide any favicon img that fails to load.

   Match by class so we never accidentally hide non-favicon images.
   ---------------------------------------------------------------- */
function setupGlobalErrorHandlers() {
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLImageElement)) return;
    if (
      t.classList.contains('chip-favicon') ||
      t.classList.contains('subgroup-favicon') ||
      t.classList.contains('deferred-favicon')
    ) {
      t.style.display = 'none';
    }
  }, true);  // capture: true — img errors don't bubble, so we must catch them on the way down
}

/**
 * Fallback for the optional LOCAL_LANDING_PAGE_PATTERNS config.
 *
 * `config.local.js` is gitignored and may not exist on a fresh install.
 * The previous <script> tag carried an inline `onerror` handler that
 * silently swallowed the load failure - but Manifest V3 CSP forbids
 * inline event handlers. We declare the fallback here instead.
 *
 * If config.local.js loads, it may reassign this window var to its
 * own array (same shape as LANDING_PAGE_PATTERNS entries).
 */
if (typeof window.LOCAL_LANDING_PAGE_PATTERNS === 'undefined') {
  window.LOCAL_LANDING_PAGE_PATTERNS = [];
}


/* ----------------------------------------------------------------
   FAVICON HELPER
   ---------------------------------------------------------------- */

/**
 * Build a favicon URL for a tab or saved item.
 *
 * Chrome already populates `tab.favIconUrl` when the user opens a tab —
 * we just reuse it. Falls back to chrome://favicon/<url> for cases
 * where the favicon hasn't been fetched yet (e.g. the very first
 * render after install), and to '' for non-http URLs.
 */

// ----------------------------------------------------------------
// BOOKMARK DIALOG
// ----------------------------------------------------------------
// Module-level state for the pending bookmark operation.
let _pendingBookmark = null; // { url, title, actionEl }

async function showBookmarkDialog(url, title, actionEl) {
  _pendingBookmark = { url, title, actionEl, mode: 'create' };
  const overlay     = document.getElementById('bookmarkOverlay');
  const modal       = document.getElementById('bookmarkModal');
  const nameInput   = document.getElementById('bookmarkNameInput');
  const treeEl = document.getElementById('bookmarkTree');
  const errorEl     = document.getElementById('bookmarkError');
  const footer      = document.getElementById('bookmarkModalFooter');
  const titleEl     = document.getElementById('bookmarkModalTitle');

  if (window.i18n && window.i18n.applyToDOM) window.i18n.applyToDOM();

  titleEl.textContent = t('bookmark.title');
  nameInput.value = title || url;
  nameInput.disabled = false;
  treeEl.innerHTML = '';
  treeEl.dataset.selectedId = '';
  errorEl.style.display = 'none';
  footer.innerHTML = `
    <button class="bookmark-modal-btn secondary" data-action="close-bookmark-modal" type="button">${t('bookmark.cancel')}</button>
    <button class="bookmark-modal-btn primary" data-action="save-bookmark" type="button">${t('bookmark.save')}</button>
  `;

  nameInput.focus();
  nameInput.select();

  treeEl.innerHTML = '<div class="bookmark-tree-empty">Loading folders&hellip;</div>';
  try {
    const tree = await chrome.bookmarks.getTree();
    treeEl.innerHTML = buildBookmarkTreeHTML(tree, null);
    const firstRow = treeEl.querySelector('.bookmark-tree-row');
    if (firstRow) setSelectedBookmarkFolder(treeEl, firstRow.dataset.folderId);
  } catch (err) {
    treeEl.innerHTML = '<div class="bookmark-tree-empty">Failed to load folders</div>';
    errorEl.textContent = 'Could not load folders: ' + ((err && err.message) ? err.message : String(err));
    errorEl.style.display = 'block';
  }

  overlay.style.display = 'block';
  modal.style.display = 'flex';
  modal.offsetHeight;
  overlay.classList.add('open');
  modal.classList.add('open');
}

/**
 * showBookmarkMenu(url, title, actionEl, clickEvent)
 *
 * Shown when clicking a star that is already bookmarked. Searches for the
 * existing bookmark ID(s) and offers Remove / Move options in the modal.
 */
async function showBookmarkMenu(url, title, actionEl, clickEvent) {
  const overlay      = document.getElementById('bookmarkOverlay');
  const modal        = document.getElementById('bookmarkModal');
  const nameInput    = document.getElementById('bookmarkNameInput');
  const treeEl = document.getElementById('bookmarkTree');
  const errorEl      = document.getElementById('bookmarkError');
  const footer       = document.getElementById('bookmarkModalFooter');
  const titleEl      = document.getElementById('bookmarkModalTitle');

  if (window.i18n && window.i18n.applyToDOM) window.i18n.applyToDOM();
  errorEl.style.display = 'none';

  let existingBookmarks = [];
  try {
    existingBookmarks = await chrome.bookmarks.search({ url });
  } catch (err) {
    existingBookmarks = [];
  }

  if (existingBookmarks.length === 0) {
    _bookmarkedUrlsCache.delete(url);
    showBookmarkDialog(url, title, actionEl);
    return;
  }

  const bm = existingBookmarks[0];
  _pendingBookmark = {
    url, title, actionEl,
    mode: 'manage',
    bookmarkId: bm.id,
    bookmarkTitle: bm.title,
  };

  let folderName = 'Unknown folder';
  try {
    const parent = await chrome.bookmarks.get(bm.parentId);
    folderName = (parent[0] && parent[0].title) || 'Bookmarks bar';
  } catch {}

  titleEl.textContent = t('bookmark.bookmarked_title') || 'Bookmark options';
  nameInput.value = bm.title || title || url;
  nameInput.disabled = true;

  treeEl.innerHTML = '<div class="bookmark-tree-empty">Loading folders&hellip;</div>';
  try {
    const tree = await chrome.bookmarks.getTree();
    treeEl.innerHTML = buildBookmarkTreeHTML(tree, bm.parentId);
    setSelectedBookmarkFolder(treeEl, bm.parentId);
    const selectedRow = treeEl.querySelector('.bookmark-tree-row.selected');
    if (selectedRow && selectedRow.scrollIntoView) selectedRow.scrollIntoView({ block: 'nearest' });
  } catch (err) {
    treeEl.innerHTML = '<div class="bookmark-tree-empty">Failed to load folders</div>';
    errorEl.textContent = 'Could not load folders: ' + ((err && err.message) ? err.message : String(err));
    errorEl.style.display = 'block';
  }

  footer.innerHTML = `
    <button class="bookmark-modal-btn danger" data-action="remove-bookmark" type="button">${t('bookmark.remove')}</button>
    <button class="bookmark-modal-btn primary" data-action="save-bookmark" type="button">${t('bookmark.move')}</button>
    <button class="bookmark-modal-btn secondary" data-action="close-bookmark-modal" type="button">${t('bookmark.go_to_bookmark')}</button>
  `;

  overlay.style.display = 'block';
  modal.style.display = 'flex';
  modal.offsetHeight;
  overlay.classList.add('open');
  modal.classList.add('open');
}

function hideBookmarkDialog() {
  const overlay = document.getElementById('bookmarkOverlay');
  const modal   = document.getElementById('bookmarkModal');
  overlay.classList.remove('open');
  modal.classList.remove('open');
  setTimeout(() => {
    overlay.style.display = 'none';
    modal.style.display = 'none';
  }, 220);
  _pendingBookmark = null;
}


/**
 * Accepts either:
 *   - a tab object with `.favIconUrl` and `.url`
 *   - a plain object with just `.url` (e.g. saved-for-later items)
 */
function getFaviconUrl(source) {
  if (!source) return '';
  if (source.favIconUrl) return source.favIconUrl;
  return '';
}


/* ----------------------------------------------------------------
   SVG ICON STRINGS
   ---------------------------------------------------------------- */
const ICONS = {
  tabs:    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
  close:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
  archive: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>`,
  focus:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>`,
};


/* ----------------------------------------------------------------
   IN-MEMORY STORE FOR OPEN-TAB GROUPS
   ---------------------------------------------------------------- */
let domainGroups = [];


/* ----------------------------------------------------------------
   HELPER: filter out browser-internal pages
   ---------------------------------------------------------------- */

/**
 * getRealTabs()
 *
 * Returns tabs that are real web pages — no chrome://, extension
 * pages, about:blank, etc.
 */
function getRealTabs() {
  return openTabs.filter(t => {
    const url = t.url || '';
    return (
      !url.startsWith('chrome://') &&
      !url.startsWith('chrome-extension://') &&
      !url.startsWith('about:') &&
      !url.startsWith('edge://') &&
      !url.startsWith('brave://')
    );
  });
}

/**
 * isInsightable(url)
 *
 * True if a tab with this URL should be counted in insights
 * (real web pages only — skip chrome internals, extension pages, etc.)
 */
function isInsightable(url) {
  if (!url) return false;
  return (
    !url.startsWith('chrome://') &&
    !url.startsWith('chrome-extension://') &&
    !url.startsWith('about:') &&
    !url.startsWith('edge://') &&
    !url.startsWith('brave://') &&
    !url.startsWith('file://')
  );
}

/* ============================================================
   INSIGHTS — track tab close events, surface stats + top domains
   ============================================================ */

const INSIGHTS_KEY = 'table-…nsights';
const INSIGHTS_MAX_EVENTS = 2000;

async function recordCloseEvents(closedTabs) {
  if (!closedTabs || closedTabs.length === 0) return;
  try {
    const stored = await chrome.storage.local.get(INSIGHTS_KEY);
    const insights = stored[INSIGHTS_KEY] || { closeEvents: [] };
    const events = insights.closeEvents || [];
    const now = Date.now();
    for (const t of closedTabs) {
      let domain = '';
      try { domain = new URL(t.url).hostname; } catch { continue; }
      events.push({ url: t.url, domain, closedAt: now });
    }
    // Trim to most recent N to keep storage bounded
    if (events.length > INSIGHTS_MAX_EVENTS) {
      events.splice(0, events.length - INSIGHTS_MAX_EVENTS);
    }
    await chrome.storage.local.set({ [INSIGHTS_KEY]: { closeEvents: events } });
  } catch (err) {
    console.warn('[TabCtrl] Failed to record close events:', err);
  }
}

async function getInsights() {
  try {
    const stored = await chrome.storage.local.get(INSIGHTS_KEY);
    return stored[INSIGHTS_KEY] || { closeEvents: [] };
  } catch {
    return { closeEvents: [] };
  }
}

async function clearInsights() {
  await chrome.storage.local.set({ [INSIGHTS_KEY]: { closeEvents: [] } });
}

/**
 * renderInsights()
 *
 * Reads stored close events and updates the insights banner DOM.
 * Renders today / this-week counts + top domains.
 */
async function renderInsights() {
  const banner = document.getElementById('insightsBanner');
  if (!banner) return;

  const insights = await getInsights();
  const events = insights.closeEvents || [];

  if (events.length === 0) {
    banner.style.display = 'none';
    return;
  }
  banner.style.display = 'block';

  const now = Date.now();
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(); startOfWeek.setDate(startOfWeek.getDate() - 7);
  const dayStart = startOfDay.getTime();
  const weekStart = startOfWeek.getTime();

  let closedToday = 0, closedWeek = 0, closedAll = events.length;
  const domainCounts = {};          // all-time
  const weekDomainCounts = {};       // this-week
  for (const e of events) {
    if (e.closedAt >= dayStart) closedToday++;
    if (e.closedAt >= weekStart) {
      closedWeek++;
      weekDomainCounts[e.domain] = (weekDomainCounts[e.domain] || 0) + 1;
    }
    domainCounts[e.domain] = (domainCounts[e.domain] || 0) + 1;
  }

  const topAll = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const topWeek = Object.entries(weekDomainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const todayEl = document.getElementById('insightToday');
  const weekEl = document.getElementById('insightWeek');
  const allEl = document.getElementById('insightAll');
  const topAllEl = document.getElementById('insightTopAll');
  if (todayEl) todayEl.textContent = closedToday;
  if (weekEl)  weekEl.textContent  = closedWeek;
  if (allEl)   allEl.textContent   = closedAll;

  if (topAllEl) {
    topAllEl.innerHTML = topAll.length === 0
      ? '<li class="insight-empty">No closes yet</li>'
      : topAll.map(([d, c], i) => {
          const rank = i + 1;
          const rankClass = rank === 1 ? 'insight-rank-1' : '';
          return `<li class="${rankClass}"><span class="insight-rank">#${rank}</span><span class="insight-domain">${escapeHtml(d)}</span><span class="insight-count">${c}</span></li>`;
        }).join('');
  }

  const topWeekEl = document.getElementById('insightTopWeek');
  if (topWeekEl) {
    topWeekEl.innerHTML = topWeek.length === 0
      ? '<li class="insight-empty">No closes this week</li>'
      : topWeek.map(([d, c], i) => {
          return `<li><span class="insight-rank">#${i + 1}</span><span class="insight-domain">${escapeHtml(d)}</span><span class="insight-count">${c}</span></li>`;
        }).join('');
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function escapeAttr(s) {
  // For HTML attribute values. Escapes & < > " ' to be safe inside
  // double-quoted attributes. Same set as escapeHtml — kept as a
  // separate function so future attribute-specific rules (e.g. newlines,
  // null bytes) can be tightened without touching general text.
  return escapeHtml(s);
}

/**
 * checkTableControlDupes()
 *
 * Counts how many TabCtrl pages are open. If more than 1,
 * shows a banner offering to close the extras.
 */
function checkTableControlDupes() {
  const tableControlTabs = openTabs.filter(t => t.isTableControl);
  const banner  = document.getElementById('tableControlDupeBanner');
  if (!banner) return;

  if (tableControlTabs.length > 1) {
    // Render full banner text using i18n (count placeholder filled in)
    const textEl = document.getElementById('tableControlDupeText');
    if (textEl) textEl.innerHTML = t('banner.table_control_dupes', tableControlTabs.length);
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}


/* ----------------------------------------------------------------
   OVERFLOW CHIPS ("+N more" expand button in domain cards)
   ---------------------------------------------------------------- */

/* ----------------------------------------------------------------
   PATH-BASED SUB-GROUPING — break down busy domains into clusters

   When a domain has many tabs (e.g. 20 GitHub tabs), grouping just by
   domain doesn't help you find anything. Sub-grouping splits tabs by
   URL path so each GitHub repo, each YouTube channel, etc. becomes its
   own row inside the domain card.
   ---------------------------------------------------------------- */

/**
 * getSubgroupKey(url, settings)
 *
 * Returns the path-based key used to group tabs within a domain.
 * Delegates to settingsAPI.getSubgroupKey() which evaluates the user's
 * subGroupingRules (regex + template) to decide the key.
 *
 *   github.com/Aaron-l33/cool-project/issues/123 + github.com rule → "Aaron-l33/cool-project"
 *   www.youtube.com/@mkbhd/videos               + youtube rule   → "@mkbhd"
 *   www.reddit.com/r/programming/comments/abc   + reddit rule    → "r/programming"
 *   example.com/foo/bar                          + fallback rule  → "foo"
 */
function getSubgroupKey(url, settings) {
  if (window.settingsAPI && window.settingsAPI.getSubgroupKey) {
    return window.settingsAPI.getSubgroupKey(url, settings);
  }
  // Fallback (settings.js not loaded): first path segment
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/+|\/+$/g, '');
    if (!path) return '/';
    const parts = path.split('/').filter(Boolean);
    return parts.length > 0 ? parts[0] : '/';
  } catch {
    return '/';
  }
}

/**
 * getSubgroupLabel(key)
 * Human-friendly display label. 1 segment → as-is; 2+ segments → last
 * (most specific); '/' → '(home)'.
 */
function getSubgroupLabel(key) {
  if (!key || key === '/') return '(home)';
  const parts = key.split('/');
  return parts[parts.length - 1];
}

/**
 * groupTabsBySubgroup(tabs, domain, settings)
 *
 * Returns array of { key, label, tabs } sorted by tab count desc, then
 * label asc for stable order. `settings` is forwarded to getSubgroupKey().
 */
function groupTabsBySubgroup(tabs, domain, settings) {
  const map = {};
  for (const tab of tabs) {
    const key = getSubgroupKey(tab.url, settings);
    if (!map[key]) map[key] = [];
    map[key].push(tab);
  }
  const subgroups = Object.entries(map).map(([key, groupTabs]) => ({
    key,
    label: getSubgroupLabel(key),
    tabs: groupTabs,
  }));
  subgroups.sort((a, b) => b.tabs.length - a.tabs.length || a.label.localeCompare(b.label));
  return subgroups;
}

/**
 * renderTabChip(tab, domain, urlCounts)
 *
 * Renders one tab as a clickable chip with favicon, title, save/close
 * buttons. Used inside expanded subgroup rows.
 */
function renderTabChip(tab, domain, fingerprintCounts, fingerprintByUrl) {
  let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), domain);
  // For localhost tabs, prepend port number so you can tell projects apart
  try {
    const parsed = new URL(tab.url);
    if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
  } catch {}
  const fp = fingerprintByUrl.get(tab.url) || tab.url;
  const count    = fingerprintCounts.get(fp) || 1;
  const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">x${count}</span>` : '';
  const chipClass = count > 1 ? ' chip-has-dupes' : '';
  const safeUrl   = (tab.url || '').replace(/"/g, '&quot;');
  const safeTitle = label.replace(/"/g, '&quot;');
  const faviconUrl = getFaviconUrl(tab);
  return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
    ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="">` : ''}
    <span class="chip-text" title="${safeTitle}">${label}</span>${dupeTag}
    <div class="chip-actions">
      <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="${t('action.save_for_later')}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
      </button>
      <button class="chip-action chip-bookmark${_bookmarkedUrlsCache.has(tab.url) ? ' bookmarked' : ''}" data-action="bookmark-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="${t('action.bookmark')}">
        <svg xmlns="http://www.w3.org/2000/svg" ${_bookmarkedUrlsCache.has(tab.url) ? 'fill="currentColor"' : 'fill="none"'} viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" /></svg>
      </button>
      <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="${t('action.close_tab')}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>
  </div>`;
}

/**
 * renderSubgroupRow(sg, domain, domainId)
 *
 * One subgroup: clickable header (chevron + favicon + label + count + close)
 * and a hidden container of tab chips that expands when the header is clicked.
 */
function renderSubgroupRow(sg, domain, domainId, fingerprintCounts, fingerprintByUrl) {
  const { key, label, tabs } = sg;
  const count = tabs.length;
  const safeKey = key.replace(/[^a-z0-9]/gi, '-') || 'root';
  const rowId = `sg-${domainId}-${safeKey}`;

  // Favicon from first tab in this subgroup
  const faviconUrl = getFaviconUrl(tabs[0]);

  // Dedupe by fingerprint before rendering chips. The (Nx) badge on each
  // chip already conveys how many copies of that URL exist (via
  // fingerprintCounts), so drawing N identical chips is visual noise. The
  // subgroup header still shows the actual tab count (`tabs.length`),
  // and the close-subgroup / dedup actions still operate on every tab.
  const seenFps = new Set();
  const uniqueTabs = [];
  for (const tab of tabs) {
    const fp = fingerprintByUrl.get(tab.url) || tab.url;
    if (seenFps.has(fp)) continue;
    seenFps.add(fp);
    uniqueTabs.push(tab);
  }
  const tabChips = uniqueTabs.map(tab => renderTabChip(tab, domain, fingerprintCounts, fingerprintByUrl)).join('');

  const countLabel = count !== 1 ? t('domain.tabs_open', count) : t('domain.tab_open');
  const hasDupes   = tabs.some(t => (fingerprintCounts.get(fingerprintByUrl.get(t.url) || '') || 0) > 1);

  return `
    <div class="subgroup-row" data-subgroup-id="${rowId}">
      <div class="subgroup-header clickable" data-action="toggle-subgroup" data-subgroup-id="${rowId}">
        <span class="subgroup-chevron">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
        </span>
        ${faviconUrl ? `<img class="subgroup-favicon" src="${faviconUrl}" alt="">` : ''}
        <span class="subgroup-label">${label}</span>
        <span class="subgroup-count">${countLabel}</span>
        ${hasDupes ? '<span class="subgroup-dupes">●</span>' : ''}
        <button class="subgroup-close" data-action="close-subgroup" data-subgroup-id="${rowId}" data-subgroup-key="${key}" title="${t('action.close_all', count)}">
          ${ICONS.close}
        </button>
      </div>
      <div class="subgroup-chips" id="${rowId}" style="display:none">
        ${tabChips}
      </div>
    </div>
  `;
}

function renderDomainCard(group, settings, fingerprintCounts, fingerprintByUrl) {
  const tabs      = group.tabs || [];
  const tabCount  = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId  = 'domain-' + group.domain.replace(/[^a-z0-9]/g, '-');
  const useSubgroups = settings ? settings.subGroupingEnabled === true : false;

  const rawLabel = isLanding ? t('domain.homepages') : (group.label || friendlyDomain(group.domain) || '');

  // Count duplicates by fingerprint (not by raw URL string).
  // The fingerprint map is precomputed in the caller.
  const fpCounts = new Map();
  for (const tab of tabs) {
    const fp = fingerprintByUrl.get(tab.url) || tab.url;
    fpCounts.set(fp, (fpCounts.get(fp) || 0) + 1);
  }
  const dupeFps   = [...fpCounts.entries()].filter(([, c]) => c > 1);
  const hasDupes   = dupeFps.length > 0;
  const totalExtras = dupeFps.reduce((s, [, c]) => s + c - 1, 0);

  const tabBadge = `<span class="open-tabs-badge">
    ${ICONS.tabs}
    ${tabCount !== 1 ? t('domain.tabs_open', tabCount) : t('domain.tab_open')}
  </span>`;

  const dupeBadge = hasDupes
    ? `<span class="open-tabs-badge" style="color:var(--accent-amber);background:rgba(200,113,58,0.08);">
        ${totalExtras !== 1 ? t('domain.duplicates_plural', totalExtras) : t('domain.duplicates', totalExtras)}
      </span>`
    : '';

  // Body: subgroups (collapsible rows) when there's more than one path cluster;
  // flat chip list for landing pages, single-cluster domains, and when sub-grouping is disabled.
  const subgroups = (isLanding || !useSubgroups) ? null : groupTabsBySubgroup(tabs, group.domain, settings);

  let bodyHtml;
  if (isLanding || !useSubgroups || !subgroups || subgroups.length <= 1) {
    // Dedupe by fingerprint (not raw URL): the (Nx) badge uses fingerprint
    // counts, so URLs that differ only in tracking params should collapse.
    const seen = new Set();
    const uniqueTabs = [];
    for (const tab of tabs) {
      const fp = fingerprintByUrl.get(tab.url) || tab.url;
      if (seen.has(fp)) continue;
      seen.add(fp);
      uniqueTabs.push(tab);
    }
    const flatChips = uniqueTabs.map(tab => renderTabChip(tab, group.domain, fingerprintCounts, fingerprintByUrl)).join('');
    bodyHtml = `<div class="mission-pages">${flatChips}</div>`;
  } else {
    const subgroupRows = subgroups.map(sg => renderSubgroupRow(sg, group.domain, stableId, fingerprintCounts, fingerprintByUrl)).join('');
    bodyHtml = `<div class="mission-subgroups">${subgroupRows}</div>`;
  }

  let actionsHtml = `
    <button class="action-btn close-tabs" data-action="close-domain-tabs" data-domain-id="${stableId}">
      ${ICONS.close}
      ${tabCount !== 1 ? t('action.close_all', tabCount) : t('action.close_all_one')}
    </button>`;

  if (hasDupes) {
    // Encode fingerprints (not URLs) — dedup-keep-one handler will
    // match by fingerprint so we collapse URLs that are equivalent
    // under our normalisation (utm-stripped, etc.).
    const dupeFpsEncoded = dupeFps.map(([fp]) => encodeURIComponent(fp)).join(',');
    actionsHtml += `
      <button class="action-btn" data-action="dedup-keep-one" data-dupe-fps="${dupeFpsEncoded}">
        ${totalExtras !== 1 ? t('action.close_duplicates_plural', totalExtras) : t('action.close_duplicates', totalExtras)}
      </button>`;
  }

  return `
    <div class="mission-card domain-card ${hasDupes ? 'has-amber-bar' : 'has-neutral-bar'}" data-domain-id="${stableId}">
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top">
          <span class="mission-name" title="${rawLabel.replace(/"/g, '&quot;')}">${rawLabel}</span>
          ${tabBadge}
          ${dupeBadge}
        </div>
        ${bodyHtml}
        <div class="actions">${actionsHtml}</div>
      </div>
      <div class="mission-meta">
        <div class="mission-page-count">${tabCount}</div>
        <div class="mission-page-label">tabs</div>
      </div>
    </div>`;
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — Render Checklist Column
   ---------------------------------------------------------------- */

// (Removed in commit 4: archiveSelectMode + selectedIds. The old
//  multi-select checkbox UI is gone; replaced by the new Tab Stash
//  drag-and-drop interactions.)
/* eslint-disable */

/**
 * groupByDate(items)
 *
 * Splits saved-tab items into 4 time buckets for display:
 * Today / Yesterday / This Week / Older. Buckets are returned in
 * display order, each as an array of items.
 */
function groupByDate(items) {
  const now = new Date();
  const startOfToday = new Date(now);     startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday); startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);     startOfWeek.setDate(startOfWeek.getDate() - 7);

  const groups = { today: [], yesterday: [], thisWeek: [], older: [] };
  for (const item of items) {
    if (!item.savedAt) { groups.older.push(item); continue; }
    const saved = new Date(item.savedAt);
    if (saved >= startOfToday)        groups.today.push(item);
    else if (saved >= startOfYesterday) groups.yesterday.push(item);
    else if (saved >= startOfWeek)      groups.thisWeek.push(item);
    else                                groups.older.push(item);
  }
  return groups;
}

/**
 * autoArchiveOld()
 *
 * Auto-dismiss completed items older than the retention setting.
 * Runs at the top of every renderDeferredColumn() so the change is
 * reflected on the next render. Idempotent — safe to call repeatedly.
 */
async function autoArchiveOld() {
  try {
    const settings = await settingsAPI.getSettings();
    const days = settings.archiveRetentionDays || 0;
    if (days <= 0) return;
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const stored = await chrome.storage.local.get('deferred');
    const list = stored.deferred || [];
    let changed = false;
    for (const item of list) {
      if (item.completed && item.savedAt && new Date(item.savedAt).getTime() < cutoffMs) {
        item.dismissed = true;
        changed = true;
      }
    }
    if (changed) await chrome.storage.local.set({ deferred: list });
  } catch (err) {
    console.warn('[TabCtrl] autoArchiveOld failed:', err);
  }
}

/* Removed in commit 4: exportSavedTabsToMarkdown, escapeMd,
   toggleSelectMode, toggleSelected, selectAll, deleteSelected,
   clearAllCompleted, updateSelectToolbar. Old multi-select checkbox
   UI is gone; Tab Stash uses per-chip reopen/remove instead. */

/**
 * renderDeferredColumn()
 *
 * Reads saved tabs from chrome.storage.local and renders the two
 * dedicated sections in the dashboard stack:
 *   - #savedSection: active saved tabs (with toolbar, group-by-date, bulk select)
 *   - #archiveSection: completed/archived tabs (with search)
 * Both sections are hidden when empty. Includes auto-cleanup of
 * completed items older than the retention setting.
 */
/* ----------------------------------------------------------------
   STASH UI — render parked tabs grouped by user-defined categories.

   - #stashSection: section container
   - #stashCategories: horizontal tab strip (All / Unsorted / user cats / + new)
   - #stashList: parked-tab chips, optionally filtered by active category
   - #stashEmpty: empty state when nothing is parked

   Drag and drop:
   - Each chip is draggable (HTML5 DnD).
   - Each category tab is a drop target.
   - On drop, the chip's categoryId is updated and the list re-renders.
   ---------------------------------------------------------------- */

/** Active category filter (null = show all). In-memory only. */
let activeStashCategoryId = null;

async function renderStashColumn() {
  const section      = document.getElementById('stashSection');
  const categoriesEl = document.getElementById('stashCategories');
  const listEl       = document.getElementById('stashList');
  const emptyEl      = document.getElementById('stashEmpty');
  const countEl      = document.getElementById('stashCount');
  const searchEl     = document.getElementById('stashSearch');
  if (!section || !listEl) return;

  const [items, categories, settings] = await Promise.all([
    getStash(),
    getStashCategories(),
    settingsAPI.getSettings(),
  ]);

  // Hide the section entirely when there's nothing to show. The
  // hero concept carousel picks up the visual real estate instead.
  // If we're switching from N items to 0, also reset the category
  // filter so the next stashed tab isn't hidden behind a stale filter.
  if (items.length === 0) {
    section.style.display = 'none';
    if (activeStashCategoryId != null) activeStashCategoryId = null;
    if (emptyEl) emptyEl.style.display = 'none';
    if (countEl) countEl.textContent = '';
    _lastStashCount = 0;
    updateHeroVisibility();
    return;
  }
  section.style.display = '';

  // Count badge (top right) — total items across all categories.
  if (countEl) {
    const key = items.length === 1 ? 'stash.count_one' : 'stash.count_plural';
    countEl.textContent = t(key, items.length);
  }

  // Category strip (filter pills at the top)
  if (categoriesEl) {
    categoriesEl.innerHTML = renderStashCategoryTabs(items, categories);
  }

  // Note: empty-state branch is handled at the top of renderStashColumn
  // (early return). The hero concept carousel takes over the visual
  // real estate when stash is empty.

  // Filter by the active category (null = show all)
  let filtered = activeStashCategoryId == null
    ? items
    : items.filter(it => it.categoryId === activeStashCategoryId);

  // Filter by search query (URL or title, case-insensitive substring match).
  // Empty query = no filtering.
  const query = searchEl ? searchEl.value.trim().toLowerCase() : '';
  if (query) {
    filtered = filtered.filter(it => {
      const url   = (it.url   || '').toLowerCase();
      const title = (it.title || '').toLowerCase();
      return url.includes(query) || title.includes(query);
    });
  }

  if (filtered.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) {
      // Distinguish "no items at all" from "filtered to nothing" so the
      // message is accurate.
      emptyEl.textContent = query
        ? t('stash.empty_search')
        : t('stash.empty');
      emptyEl.style.display = '';
    }
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  // Group by domain (same algorithm as the open tabs section) and
  // render as cards, so the visual rhythm matches the rest of the
  // dashboard. This is the user's request: "global one rule" — the
  // same domain-based aggregation should apply inside Stash.
  const groups = groupStashItemsByDomain(filtered, settings);
  listEl.innerHTML = groups.map(g => renderStashDomainCard(g, settings, categories)).join('');

  // Track total stash count for the hero visibility check.
  _lastStashCount = items.length;

  // Wire up drag/drop + category editing (delegated — see installStashDragAndDrop).
  installStashDragAndDrop(listEl, categoriesEl);
  installStashCategoryEditing();
}

/**
 * groupStashItemsByDomain(items, settings)
 *
 * Groups stash items by the same domain key the open tabs section
 * uses (settingsAPI.getGroupKeyForUrl → friendlyDomain → main-domain
 * fallback). Returns array of { key, label, items }, sorted by item
 * count desc.
 */
function groupStashItemsByDomain(items, settings) {
  const groups = new Map();
  for (const item of items) {
    let key = 'unknown', label = null;
    try {
      const r = settingsAPI.getGroupKeyForUrl(item.url, settings);
      key = r.key || 'unknown';
      label = r.label || null;
    } catch {
      // Malformed URL — keep the default key
    }
    if (!groups.has(key)) groups.set(key, { key, label, items: [] });
    groups.get(key).items.push(item);
  }
  return Array.from(groups.values())
    .sort((a, b) => b.items.length - a.items.length);
}

/**
 * renderStashDomainCard(group, settings, categories)
 *
 * One domain group inside the Stash section. Reuses the same
 * .mission-card / .domain-card / .mission-subgroups / .subgroup-row
 * CSS as the open tabs section so the two views feel consistent.
 * Inside the body, items render as Stash chips (renderStashItem),
 * NOT as tab chips — Stash chips have their own actions (reopen /
 * remove / drag-to-category) so we can't reuse renderTabChip.
 */
function renderStashDomainCard(group, settings, categories) {
  const items      = (group.items || []).slice().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  const itemCount  = items.length;
  const useSubgroups = settings ? settings.subGroupingEnabled === true : false;
  const stableId   = 'stash-domain-' + String(group.key).replace(/[^a-z0-9]/g, '-');

  // Display label: use the group label if the user defined one via
  // custom rules; otherwise friendlyDomain() on the key; otherwise
  // a humanised version of the key itself.
  const rawLabel = group.label
    || (group.key === 'local-files' ? t('domain.local_files')
       : group.key === 'unknown'    ? t('domain.unknown')
       : friendlyDomain(group.key) || group.key);

  const itemBadge = `<span class="open-tabs-badge">
    ${ICONS.tabs}
    ${itemCount !== 1 ? t('stash.item_count', itemCount) : t('stash.item_count_one')}
  </span>`;

  // Body: use the same subgroup logic as open tabs (path-based
  // clusters) so a domain with many items naturally splits into
  // collapsible rows.
  const subgroups = useSubgroups ? groupTabsBySubgroup(items, group.key, settings) : null;

  let bodyHtml;
  if (!subgroups || subgroups.length <= 1) {
    const chips = items.map(it => renderStashItem(it, categories)).join('');
    bodyHtml = `<div class="mission-pages">${chips}</div>`;
  } else {
    const subgroupRows = subgroups
      .map(sg => renderStashSubgroupRow(sg, group.key, stableId, categories))
      .join('');
    bodyHtml = `<div class="mission-subgroups">${subgroupRows}</div>`;
  }

  return `
    <div class="mission-card domain-card" data-domain-id="${stableId}">
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top">
          <span class="mission-name" title="${escapeAttr(rawLabel)}">${escapeHtml(rawLabel)}</span>
          ${itemBadge}
        </div>
        ${bodyHtml}
      </div>
      <div class="mission-meta">
        <div class="mission-page-count">${itemCount}</div>
        <div class="mission-page-label">${t('stash.items_label')}</div>
      </div>
    </div>`;
}

/**
 * renderStashSubgroupRow(sg, domain, domainId, categories)
 *
 * One subgroup inside a Stash domain card. Reuses the same DOM
 * structure as the open-tabs subgroup rows so the existing CSS
 * (chevron rotation, open/close animation) and the existing
 * `toggle-subgroup` click handler both work without changes.
 */
function renderStashSubgroupRow(sg, domain, domainId, categories) {
  const { key, label, tabs: items } = sg;
  const count   = items.length;
  const safeKey = String(key).replace(/[^a-z0-9]/gi, '-') || 'root';
  const rowId   = `sg-${domainId}-${safeKey}`;
  const faviconUrl = items[0] ? getFaviconUrl(items[0]) : '';

  const chips = items.map(it => renderStashItem(it, categories)).join('');
  const countLabel = count !== 1 ? t('stash.item_count', count) : t('stash.item_count_one');

  return `
    <div class="subgroup-row" data-subgroup-id="${rowId}">
      <div class="subgroup-header clickable" data-action="toggle-subgroup" data-subgroup-id="${rowId}">
        <span class="subgroup-chevron">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
        </span>
        ${faviconUrl ? `<img class="subgroup-favicon" src="${faviconUrl}" alt="">` : ''}
        <span class="subgroup-label">${escapeHtml(label)}</span>
        <span class="subgroup-count">${countLabel}</span>
      </div>
      <div class="subgroup-chips" id="${rowId}" style="display:none">
        ${chips}
      </div>
    </div>
  `;
}

function renderStashCategoryTabs(items, categories) {
  const allActive = activeStashCategoryId == null;
  const allChip = `<button class="stash-cat-tab ${allActive ? 'active' : ''}" data-action="stash-filter-all" type="button">
    <span class="stash-cat-name">${escapeHtml(t('stash.all'))}</span>
    <span class="stash-cat-count">${items.length}</span>
  </button>`;

  const catChips = categories.map(cat => {
    const count = items.filter(it => it.categoryId === cat.id).length;
    const active = activeStashCategoryId === cat.id;
    return `<button class="stash-cat-tab ${active ? 'active' : ''}" data-action="stash-filter-category" data-category-id="${cat.id}" data-category-name="${escapeAttr(cat.name)}" type="button">
      <span class="stash-cat-name">${escapeHtml(cat.name)}</span>
      <span class="stash-cat-count">${count}</span>
    </button>`;
  }).join('');

  // + New chip — click turns into inline input via stash-category-add handler
  const newChip = `<button class="stash-cat-tab stash-cat-new" data-action="stash-category-add" type="button">+ ${escapeHtml(t('stash.category_new'))}</button>`;

  return allChip + catChips + newChip;
}

function renderStashItem(item, categories, fingerprintCounts) {
  const faviconUrl = getFaviconUrl(item);
  const title = item.title || item.url || '';
  const safeTitle = title.replace(/"/g, '&quot;');
  const ago = timeAgo(item.savedAt);
  const cat = (categories || []).find(c => c.id === item.categoryId);
  const catName = cat ? cat.name : t('stash.uncategorized');

  // Stash is stored as 1 item per fingerprint with a count. The
  // fingerprintCounts map is no longer needed for the badge — we
  // read item.count directly. (Kept in the signature so the caller
  // doesn't have to change; we just ignore the param.)
  const dupeCount = item.count || 1;
  const dupeTag   = dupeCount > 1 ? ` <span class="chip-dupe-badge" data-i18n-title="stash.stashed_count" title="${escapeAttr(t('stash.stashed_count', dupeCount))}">x${dupeCount}</span>` : '';
  const chipClass = dupeCount > 1 ? ' chip-has-dupes' : '';

  // Snapshot indicator — shows whenever a snapshot was captured.
  // Reads the new shape ({window:{x,y}, containers:[...]}) and
  // also accepts the legacy {scrollX, scrollY} shape for old items.
  const snap = item.snapshot;
  const hasSnapshot = !!(snap && snap.capturedAt);
  let snapWinX = 0, snapWinY = 0, snapContainerCount = 0;
  if (hasSnapshot) {
    if (snap.window) {
      snapWinX = snap.window.x || 0;
      snapWinY = snap.window.y || 0;
    } else {
      // Legacy top-level shape
      snapWinX = snap.scrollX || 0;
      snapWinY = snap.scrollY || 0;
    }
    snapContainerCount = Array.isArray(snap.containers) ? snap.containers.length : 0;
  }
  const positionHint = hasSnapshot
    ? (snapWinY > 0 || snapWinX > 0 || snapContainerCount > 0
        ? (snapContainerCount > 0
            ? t('stash.position_hint_with_containers', snapWinX, snapWinY, snapContainerCount)
            : t('stash.position_hint_xy', snapWinX, snapWinY))
        : t('stash.position_hint_top'))
    : '';
  const positionBadge = hasSnapshot
    ? `<span class="stash-chip-position" title="${escapeAttr(positionHint)}">↧</span>`
    : '';

  // History list (only when there are multiple stash times and the
  // chip is in the expanded state)
  const history = Array.isArray(item.savedAtHistory) ? item.savedAtHistory : [item.savedAt || Date.now()];
  const historyHtml = dupeCount > 1
    ? `<ul class="stash-chip-history" data-stash-history>
        ${history.slice().sort((a, b) => b - a).map(ts => `<li>${escapeHtml(timeAgo(ts))}</li>`).join('')}
      </ul>`
    : '';

  return `<div class="stash-chip${chipClass}" draggable="true" data-stash-id="${item.id}" data-action="stash-drag-start" data-stash-expandable="${dupeCount > 1 ? '1' : '0'}">
    <div class="stash-chip-handle" data-i18n-title="stash.drag_hint" aria-label="Drag">⋮⋮</div>
    <div class="stash-chip-body">
      <div class="stash-chip-top">
        ${faviconUrl ? `<img class="stash-chip-favicon" src="${faviconUrl}" alt="">` : ''}
        <button class="stash-chip-title" draggable="false" type="button" data-action="stash-reopen" data-stash-id="${item.id}" data-stash-url="${item.url}" data-stash-snapshot="${hasSnapshot ? '1' : '0'}" title="${safeTitle}">${escapeHtml(title)}</button>${dupeTag}${positionBadge}
      </div>
      <div class="stash-chip-meta">
        <span class="stash-chip-category" data-stash-cat="${item.categoryId || 'cat_unsorted'}">${escapeHtml(catName)}</span>
        <span class="stash-chip-sep">·</span>
        <span class="stash-chip-time">${ago}</span>
      </div>
      ${historyHtml}
    </div>
    <div class="stash-chip-actions">
      <button class="stash-chip-action" data-action="stash-reopen" data-stash-id="${item.id}" data-stash-url="${item.url}" data-stash-snapshot="${hasSnapshot ? '1' : '0'}" type="button" data-i18n-title="stash.reopen" aria-label="Reopen">↻</button>
      <button class="stash-chip-action${_bookmarkedUrlsCache.has(item.url) ? ' bookmarked' : ''}" data-action="bookmark-tab" data-tab-url="${item.url}" data-tab-title="${escapeAttr(item.title || item.url)}" type="button" data-i18n-title="action.bookmark" aria-label="Bookmark">${_bookmarkedUrlsCache.has(item.url) ? '★' : '☆'}</button>
      <button class="stash-chip-action danger" data-action="stash-remove" data-stash-id="${item.id}" type="button" data-i18n-title="action.dismiss" aria-label="Remove">×</button>
    </div>
  </div>`;
}

/* ----------------------------------------------------------------
   STASH category inline edit / popover
   - Add:     click + New → inline input appears in the categories row
   - Rename:  double-click a chip OR right-click → "Rename"
   - Delete:  right-click a chip → "Delete" → small confirm card
   No more prompt()/confirm() in user-facing flows.
   ---------------------------------------------------------------- */

// Replace the + New chip with an inline <input> + ✓ / ✗
function openStashCategoryAdd() {
  const categoriesEl = document.getElementById('stashCategories');
  const newBtn = categoriesEl && categoriesEl.querySelector('.stash-cat-new');
  if (!newBtn) return;
  // If already in add mode, just focus the input
  const existing = document.getElementById('stashCategoryAddInput');
  if (existing) { existing.focus(); return; }

  const input = document.createElement('span');
  input.className = 'stash-cat-new-input';
  input.id = 'stashCategoryAddWrap';
  input.innerHTML = `
    <input id="stashCategoryAddInput" type="text" maxlength="40" placeholder="${escapeAttr(t('stash.category_placeholder'))}" autocomplete="off">
    <button class="stash-cat-confirm" data-action="stash-category-add-confirm" type="button" title="OK" aria-label="OK">✓</button>
    <button class="stash-cat-cancel"  data-action="stash-category-add-cancel"  type="button" title="Cancel" aria-label="Cancel">✗</button>
  `;
  newBtn.replaceWith(input);
  const inp = document.getElementById('stashCategoryAddInput');
  inp.focus();
}

function closeStashCategoryAdd() {
  const wrap = document.getElementById('stashCategoryAddWrap');
  if (!wrap) return;
  // Re-render the categories strip via the column re-render so the + New
  // button comes back. Caller is responsible for calling renderStashColumn
  // if data changed; otherwise just restoring the button is enough.
  const categoriesEl = document.getElementById('stashCategories');
  if (categoriesEl) {
    const btn = document.createElement('button');
    btn.className = 'stash-cat-tab stash-cat-new';
    btn.dataset.action = 'stash-category-add';
    btn.type = 'button';
    btn.textContent = '+ ' + t('stash.category_new');
    wrap.replaceWith(btn);
  }
}

// Replace a category chip with an inline <input> for renaming
function openStashCategoryRename(id) {
  // Close any other in-progress edits first
  closeStashCategoryRename();
  closeStashCategoryAdd();

  const chip = document.querySelector(`.stash-cat-tab[data-action="stash-filter-category"][data-category-id="${id}"]`);
  if (!chip) return;
  const oldName = chip.dataset.categoryName || chip.querySelector('.stash-cat-name')?.textContent || '';
  chip.classList.add('editing');
  chip.innerHTML = `
    <input id="stashCategoryRenameInput" type="text" maxlength="40" value="${escapeAttr(oldName)}" data-category-id="${escapeAttr(id)}" autocomplete="off">
    <button class="stash-cat-confirm" data-action="stash-category-rename-confirm" type="button" title="OK" aria-label="OK">✓</button>
    <button class="stash-cat-cancel"  data-action="stash-category-rename-cancel"  type="button" title="Cancel" aria-label="Cancel">✗</button>
  `;
  const input = document.getElementById('stashCategoryRenameInput');
  input.focus();
  input.select();
}

function closeStashCategoryRename() {
  const editing = document.querySelector('.stash-cat-tab.editing');
  if (!editing) return;
  // Caller is expected to call renderStashColumn afterwards (which will
  // re-render the categories strip with the old data) — but if the
  // rename was cancelled without a follow-up re-render, fall back to
  // restoring the chip with the name we still have on dataset.
  const id = editing.dataset.categoryId;
  const name = editing.dataset.categoryName || '';
  editing.classList.remove('editing');
  editing.innerHTML = `
    <span class="stash-cat-name">${escapeHtml(name)}</span>
    <span class="stash-cat-count">${editing.querySelector('.stash-cat-count')?.textContent || '0'}</span>
  `;
}

// Right-click popover: Rename / Delete for a category chip
let _stashCatMenuEl = null;

function showStashCategoryMenu(chipEl, x, y) {
  hideStashCategoryMenu();
  const id = chipEl.dataset.categoryId;
  const name = chipEl.dataset.categoryName || '';
  if (!id) return;
  const menu = document.createElement('div');
  menu.className = 'stash-cat-menu-pop';
  menu.id = 'stashCatMenuPop';
  menu.innerHTML = `
    <button data-action="stash-category-rename-start" data-category-id="${escapeAttr(id)}" type="button">${escapeHtml(t('stash.category_rename'))}</button>
    <button data-action="stash-category-delete-start" data-category-id="${escapeAttr(id)}" type="button" class="danger">${escapeHtml(t('stash.category_delete'))}</button>
  `;
  document.body.appendChild(menu);
  // Position; clamp to viewport
  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top  = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = Math.max(8, left) + 'px';
  menu.style.top  = Math.max(8, top) + 'px';
  _stashCatMenuEl = menu;
}

function hideStashCategoryMenu() {
  if (_stashCatMenuEl && _stashCatMenuEl.parentNode) {
    _stashCatMenuEl.parentNode.removeChild(_stashCatMenuEl);
  }
  _stashCatMenuEl = null;
}

// Delete confirm card (small inline card, not a native confirm)
let _stashDeleteCardEl = null;

function showStashCategoryDeleteConfirm(cat) {
  hideStashCategoryDeleteConfirm();
  const card = document.createElement('div');
  card.className = 'stash-cat-delete-card';
  card.id = 'stashCatDeleteCard';
  card.innerHTML = `
    <div class="stash-cat-delete-msg">${escapeHtml(t('stash.category_delete_confirm', cat.name))}</div>
    <div class="stash-cat-delete-actions">
      <button class="stash-cat-cancel"  data-action="stash-category-delete-cancel" type="button">${escapeHtml(t('action.cancel') || 'Cancel')}</button>
      <button class="stash-cat-confirm danger" data-action="stash-category-delete-confirm" data-category-id="${escapeAttr(cat.id)}" type="button">${escapeHtml(t('stash.category_delete'))}</button>
    </div>
  `;
  // Append inside the stash section, near the categories strip
  const section = document.getElementById('stashSection');
  if (!section) return;
  const cats = document.getElementById('stashCategories');
  if (cats && cats.parentNode) {
    cats.parentNode.insertBefore(card, cats.nextSibling);
  } else {
    section.appendChild(card);
  }
  _stashDeleteCardEl = card;
}

function hideStashCategoryDeleteConfirm() {
  if (_stashDeleteCardEl && _stashDeleteCardEl.parentNode) {
    _stashDeleteCardEl.parentNode.removeChild(_stashDeleteCardEl);
  }
  _stashDeleteCardEl = null;
}

async function deleteStashCategory(id) {
  const cats = await getStashCategories();
  const next = cats.filter(c => c.id !== id);
  // Items in the deleted category fall back to Unsorted
  const stash = await getStash();
  const updated = stash.map(it => it.categoryId === id ? { ...it, categoryId: 'cat_unsorted' } : it);
  await saveStashCategories(next);
  await chrome.storage.local.set({ stash: updated });
  if (activeStashCategoryId === id) activeStashCategoryId = null;
}

// Wire dblclick (rename) + contextmenu (popover) + input/change/keydown
// delegates once at module load. Idempotent via a guard flag.
let _stashCategoryWired = false;
function installStashCategoryEditing() {
  if (_stashCategoryWired) return;
  _stashCategoryWired = true;

  // Double-click a category chip → enter rename mode
  document.addEventListener('dblclick', (e) => {
    const chip = e.target.closest('.stash-cat-tab[data-action="stash-filter-category"]');
    if (!chip) return;
    e.preventDefault();
    openStashCategoryRename(chip.dataset.categoryId);
  });

  // Right-click a category chip → open popover
  document.addEventListener('contextmenu', (e) => {
    const chip = e.target.closest('.stash-cat-tab[data-action="stash-filter-category"]');
    if (!chip) return;
    e.preventDefault();
    showStashCategoryMenu(chip, e.clientX, e.clientY);
  });

  // Click anywhere outside the popover → close it
  document.addEventListener('mousedown', (e) => {
    if (!_stashCatMenuEl) return;
    if (e.target.closest('#stashCatMenuPop')) return;
    hideStashCategoryMenu();
  }, true);

  // Keydown: Enter to confirm, Esc to cancel (works for both add and rename inputs)
  // Click a chip body to expand/collapse its history list (only
  // for chips that have multiple stashes).
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('.stash-chip[data-stash-expandable="1"]');
    if (!chip) return;
    // Don't toggle when clicking on a button (reopen/remove) or a link
    if (e.target.closest('button, a')) return;
    chip.classList.toggle('expanded');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (document.getElementById('stashCategoryRenameInput')) {
        e.preventDefault();
        closeStashCategoryRename();
        renderStashColumn();
      } else if (document.getElementById('stashCategoryAddInput')) {
        e.preventDefault();
        closeStashCategoryAdd();
      }
    } else if (e.key === 'Enter') {
      if (document.getElementById('stashCategoryRenameInput')) {
        e.preventDefault();
        document.querySelector('.stash-cat-tab.editing .stash-cat-confirm')?.click();
      } else if (document.getElementById('stashCategoryAddInput')) {
        e.preventDefault();
        document.querySelector('#stashCategoryAddWrap .stash-cat-confirm')?.click();
      }
    }
  });
}

/* ----------------------------------------------------------------
   GLOBAL KEYBOARD SHORTCUTS
   Ctrl+K   → focus stash search (if stash is visible)
   Ctrl+H   → focus history search
   /        → focus stash search (when not in an input)
   Esc      → clear whichever search is focused
   ---------------------------------------------------------------- */
let _shortcutsWired = false;
function installGlobalShortcuts() {
  if (_shortcutsWired) return;
  _shortcutsWired = true;

  document.addEventListener('keydown', (e) => {
    // Don't steal keys while user is editing category names
    if (document.getElementById('stashCategoryRenameInput')) return;
    if (document.getElementById('stashCategoryAddInput'))    return;

    const isCtrl = e.ctrlKey || e.metaKey;

    // Ctrl+K / Ctrl+H / Ctrl+F → focus search
    if (isCtrl && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      const stashSearch = document.getElementById('stashSearch');
      if (stashSearch && stashSearch.offsetParent !== null) {
        stashSearch.focus();
        stashSearch.select();
      } else {
        const historySearch = document.getElementById('historySearch');
        if (historySearch) { historySearch.focus(); historySearch.select(); }
      }
      return;
    }
    if (isCtrl && !e.shiftKey && !e.altKey && (e.key === 'h' || e.key === 'H')) {
      e.preventDefault();
      const historySearch = document.getElementById('historySearch');
      if (historySearch) { historySearch.focus(); historySearch.select(); }
      return;
    }

    // '/' → focus stash search (only when not already in an input)
    if (e.key === '/' && !isCtrl && !e.altKey) {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement && document.activeElement.isContentEditable) return;
      const stashSearch = document.getElementById('stashSearch');
      if (stashSearch && stashSearch.offsetParent !== null) {
        e.preventDefault();
        stashSearch.focus();
        stashSearch.select();
      }
      return;
    }

    // Esc → clear whichever search has focus (or had focus last)
    if (e.key === 'Escape') {
      const ae = document.activeElement;
      if (ae && (ae.id === 'stashSearch' || ae.id === 'historySearch')) {
        if (ae.value) {
          ae.value = '';
          // Fire the right input event so live-filter rerenders
          ae.dispatchEvent(new Event('input', { bubbles: true }));
          ae.blur();
          e.preventDefault();
        }
        return;
      }
      // If hero is showing, jump to slide 0
      const hero = document.getElementById('heroSection');
      if (hero && hero.classList.contains('is-visible')) {
        setHeroSlide(0);
        e.preventDefault();
      }
    }
  });
}
installGlobalShortcuts();

/* ----------------------------------------------------------------
   STASH drag-and-drop — HTML5 native DnD, wired once per render.
   ---------------------------------------------------------------- */

let _stashDndWired = false;

function installStashDragAndDrop(listEl, categoriesEl) {
  if (_stashDndWired) return;
  _stashDndWired = true;

  // Drag start: stash the dragged item id on the dataTransfer.
  document.addEventListener('dragstart', (e) => {
    const chip = e.target.closest('.stash-chip');
    if (!chip) return;
    const id = chip.dataset.stashId;
    if (!id) return;
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    chip.classList.add('dragging');
  });

  document.addEventListener('dragend', (e) => {
    const chip = e.target.closest('.stash-chip');
    if (chip) chip.classList.remove('dragging');
    document.querySelectorAll('.stash-cat-tab.drag-over').forEach(el => el.classList.remove('drag-over'));
  });

  // Drop targets: any category tab. Only accept tabs that carry a
  // categoryId (the 'All' / '+ New' filters don't represent real
  // categories and should not be drop targets).
  document.addEventListener('dragover', (e) => {
    const tab = e.target.closest('.stash-cat-tab[data-category-id]');
    if (!tab) return;
    if (!e.dataTransfer.types.includes('text/plain')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    tab.classList.add('drag-over');
  });

  document.addEventListener('dragleave', (e) => {
    const tab = e.target.closest('.stash-cat-tab[data-category-id]');
    if (!tab) return;
    if (!tab.contains(e.relatedTarget)) tab.classList.remove('drag-over');
  });

  document.addEventListener('drop', async (e) => {
    const tab = e.target.closest('.stash-cat-tab[data-category-id]');
    if (!tab) return;
    e.preventDefault();
    tab.classList.remove('drag-over');
    const itemId = e.dataTransfer.getData('text/plain');
    const catId = tab.dataset.categoryId;
    if (!itemId || !catId) return;
    await moveStashToCategory(itemId, catId);
    if (typeof window.showToast === 'function') {
      showToast(t('stash.moved_to_category', tab.dataset.categoryName || ''));
    }
    await renderStashColumn();
  });
}

async function renderDeferredColumn() {
  // One-shot migration: legacy `deferred` data → new `stash` shape.
  // Idempotent (sets `_stashMigrated` flag in storage).
  await migrateDeferredToStash();
  // One-shot migration: collapse pre-merge stash duplicates into
  // single items with count + savedAtHistory.
  await migrateStashDuplicates();

  // Legacy auto-cleanup for the old `deferred` buffer — harmless after migration.
  await autoArchiveOld();

  // Render the new Stash section (replaces old "saved for later" UI).
  await renderStashColumn();

  const historySection   = document.getElementById('historySection');
  const historyListEl    = document.getElementById('historyList');
  const historyEmptyEl   = document.getElementById('historyEmpty');
  const historyCountEl   = document.getElementById('historyCount');
  const historySearchEl  = document.getElementById('historySearch');

  try {
    const [history, historySettings] = await Promise.all([
      getHistory(),
      window.settingsAPI ? window.settingsAPI.getSettings() : Promise.resolve({}),
    ]);
    renderHistorySection({
      section: historySection,
      listEl:  historyListEl,
      emptyEl: historyEmptyEl,
      countEl: historyCountEl,
      searchEl: historySearchEl,
      items: history,
      settings: historySettings,
      filterQuery: historySearchEl ? historySearchEl.value : '',
    });
  } catch (err) {
    console.warn('[TabCtrl] Could not load history:', err);
    if (historySection) historySection.style.display = 'none';
  }

  // Recompute hero visibility AFTER stash + history + open tabs are
  // all rendered with up-to-date counts. Without this, mutations from
  // event handlers (stash/remove/restore) never refresh the hero.
  updateHeroVisibility();
}

/**
 * updateHistoryClearOlderButton(settings) — update the "Clear >Nd" button label
 * to reflect the user's current retention-days setting. Called both from
 * renderHistorySection (when history has items) and from applyToDOM/init
 * (so the button is correct even when history is empty and the section is hidden).
 */
function updateHistoryClearOlderButton(settings) {
  const btn = document.getElementById('historyClearOlder');
  if (!btn) return;
  const days = (settings && settings.historyRetentionDays) || 7;
  btn.textContent = t('history.clear_older', days);
  btn.title = t('history.clear_older_hint', days);
}

/**
 * renderHistorySection() — render the History section (closed tabs).
 *
 * Layout:
 *   <empty> when no items
 *   <group "Today">      <item>...</item> ...   (grouped by date bucket)
 *   <group "Yesterday">
 *   ...
 *
 * Items are grouped by getDateBuckets(closedAt) so the buckets match the
 * saved-for-later visual rhythm.
 */
function renderHistorySection({ section, listEl, emptyEl, countEl, searchEl, items, filterQuery, settings }) {
  if (!section || !listEl) return;
  if (!items || items.length === 0) {
    section.style.display = 'none';
    _lastHistoryCount = 0;
    return;
  }
  section.style.display = '';
  _lastHistoryCount = items.length;

  // Dynamic 'Clear >Nd' button label so it reflects the user's retention setting.
  updateHistoryClearOlderButton(settings);

  // Optional search filter (live, on input handler in app.js)
  const q = (filterQuery || '').trim().toLowerCase();
  const filtered = q.length < 2
    ? items
    : items.filter(it =>
        (it.title || '').toLowerCase().includes(q) ||
        (it.url   || '').toLowerCase().includes(q));

  if (countEl) {
    const key = filtered.length === 1 ? 'history.count_one' : 'history.count_plural';
    countEl.textContent = t(key, filtered.length);
  }

  if (filtered.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) {
      emptyEl.textContent = t('history.empty');
      emptyEl.style.display = '';
    }
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  // --- Pagination ---
  // Page size from settings (default 5). When the filter changes the page
  // is reset to 0 so the user sees the top of the matched set.
  const pageSize = (settings && settings.historyPageSize) || 5;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  if (q !== _historyLastFilter) {
    _historyPage = 0;
    _historyLastFilter = q;
  }
  if (_historyPage >= totalPages) _historyPage = totalPages - 1;
  if (_historyPage < 0) _historyPage = 0;
  const start = _historyPage * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  // Group by date bucket OR domain, depending on the toggle.
  let html = '';
  if (_historyGroupBy === 'domain') {
    const groups = groupHistoryByDomain(pageItems);
    for (const g of groups) {
      const label = g.label || friendlyDomain(g.key) || g.key;
      if (g.items && g.items.length > 0) {
        html += `<div class="history-group-header">${escapeHtml(label)}</div>`;
        html += g.items.map(item => renderHistoryItem(item)).join('');
      }
    }
  } else {
    // Default: group by date bucket
    const groups = groupHistoryByDate(pageItems);
    const order = [
      ['today',     t('history.group_today')],
      ['yesterday', t('history.group_yesterday')],
      ['thisWeek',  t('history.group_this_week')],
      ['older',     t('history.group_older')],
    ];
    for (const [key, label] of order) {
      const list = groups[key];
      if (list && list.length > 0) {
        html += `<div class="history-group-header">${escapeHtml(label)}</div>`;
        html += list.map(item => renderHistoryItem(item)).join('');
      }
    }
  }

  // Pagination footer (only when there's more than one page)
  if (totalPages > 1) {
    const pageInfo = t('history.page_info', _historyPage + 1, totalPages);
    const prevDisabled = _historyPage === 0 ? 'disabled' : '';
    const nextDisabled = _historyPage >= totalPages - 1 ? 'disabled' : '';
    html += `<div class="history-pagination">
      <button class="history-page-btn" data-action="history-page-prev" type="button" ${prevDisabled} aria-label="Previous page">‹</button>
      <span class="history-page-info">${pageInfo}</span>
      <button class="history-page-btn" data-action="history-page-next" type="button" ${nextDisabled} aria-label="Next page">›</button>
    </div>`;
  }

  listEl.innerHTML = html;
}

// Pagination state (module-level; reset on filter change).
let _historyPage = 0;
let _historyLastFilter = '';
// Group-by mode for history section: 'time' (date buckets) | 'domain'.
let _historyGroupBy = 'time';

// Counts used by the hero visibility check. Updated each render pass.
let _lastStashCount = 0;
let _lastHistoryCount = 0;

/**
 * groupHistoryByDate(items) — bucket by today / yesterday / this week / older.
 * Identical bucketing to getDateBuckets() used by saved-for-later, so the
 * labels stay consistent across the two sections.
 */
function groupHistoryByDate(items) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 7);

  const groups = { today: [], yesterday: [], thisWeek: [], older: [] };
  for (const item of items) {
    if (!item || !item.closedAt) { groups.older.push(item); continue; }
    const ts = item.closedAt;
    if (ts >= startOfToday.getTime())         groups.today.push(item);
    else if (ts >= startOfYesterday.getTime()) groups.yesterday.push(item);
    else if (ts >= startOfWeek.getTime())      groups.thisWeek.push(item);
    else                                       groups.older.push(item);
  }
  return groups;
}

/**
 * groupHistoryByDomain(items) — group by eTLD+1 / friendlyDomain.
 * Returns array of { key, label, items } sorted by item count desc, then
 * label asc for stable order. Mirrors the Open Tabs / Stash grouping
 * so the visual rhythm matches across the three sections.
 */
function groupHistoryByDomain(items) {
  const groups = new Map();
  for (const item of items) {
    let key = 'unknown';
    let label = null;
    try {
      const settings = (window.settingsAPI && window.settingsAPI.getSettings) ? window.settingsAPI.getSettings() : null;
      // settings is async, but we already have it from the caller; pass-through via window
      // Cheap fallback: parse the hostname manually for grouping.
      const u = new URL(item.url || 'about:blank');
      const hostname = u.hostname || '';
      key = hostname || 'unknown';
      label = null; // friendlyDomain() applied at render time
    } catch {
      key = 'unknown';
    }
    if (!groups.has(key)) groups.set(key, { key, label, items: [] });
    groups.get(key).items.push(item);
  }
  // Sort items within each group by closedAt desc (most recent first).
  for (const g of groups.values()) {
    g.items.sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
  }
  return Array.from(groups.values())
    .sort((a, b) => b.items.length - a.items.length || a.key.localeCompare(b.key));
}

/**
 * renderHistoryItem(item) — one row: favicon + title + time + actions.
 */
function renderHistoryItem(item) {
  const faviconUrl = getFaviconUrl(item);
  const title = item.title || item.url || '';
  const safeTitle = title.replace(/"/g, '&quot;');
  const ago = timeAgo(item.closedAt);
  return `<div class="history-item" data-history-id="${item.id}">
    <div class="history-info">
      ${faviconUrl ? `<img class="history-favicon" src="${faviconUrl}" alt="">` : ''}
      <a class="history-title" href="${item.url}" target="_blank" rel="noopener" title="${safeTitle}">${escapeHtml(title)}</a>
    </div>
    <div class="history-meta">
      <span class="history-time">${ago}</span>
      <button class="history-action history-reopen" data-action="reopen-history-item" data-history-id="${item.id}" data-history-url="${item.url}" type="button" data-i18n-title="history.reopen" aria-label="Reopen">↻</button>
      <button class="history-action history-remove" data-action="delete-history-item" data-history-id="${item.id}" type="button" data-i18n-title="action.dismiss" aria-label="Remove">×</button>
    </div>
  </div>`;
}

// (Removed in commit 4: renderDeferredItem + renderArchiveItem.
//  Replaced by renderStashItem + renderHistoryItem.)
/* eslint-disable */


/* ----------------------------------------------------------------
   MAIN DASHBOARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderStaticDashboard()
 *
 * The main render function:
 * 1. Paints greeting + date
 * 2. Fetches open tabs via chrome.tabs.query()
 * 3. Groups tabs by domain (with landing pages pulled out to their own group)
 * 4. Renders domain cards
 * 5. Updates footer stats
 * 6. Renders the "Saved for Later" checklist
 */
async function renderStaticDashboard() {
  // --- Fetch tabs ---
  await fetchOpenTabs();
  const realTabs = getRealTabs();

  // --- Group tabs by domain ---
  // Landing pages (Gmail inbox, Twitter home, etc.) get their own special group
  // so they can be closed together without affecting content tabs on the same domain.
  const LANDING_PAGE_PATTERNS = [
    { hostname: 'mail.google.com', test: (p, h) =>
        !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/') },
    { hostname: 'x.com',               pathExact: ['/home'] },
    { hostname: 'www.linkedin.com',    pathExact: ['/'] },
    { hostname: 'github.com',          pathExact: ['/'] },
    { hostname: 'www.youtube.com',     pathExact: ['/'] },
    // Merge personal patterns from config.local.js (if it exists)
    ...(typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : []),
  ];

  function isLandingPage(url) {
    try {
      const parsed = new URL(url);
      return LANDING_PAGE_PATTERNS.some(p => {
        // Support both exact hostname and suffix matching (for wildcard subdomains)
        const hostnameMatch = p.hostname
          ? parsed.hostname === p.hostname
          : p.hostnameEndsWith
            ? parsed.hostname.endsWith(p.hostnameEndsWith)
            : false;
        if (!hostnameMatch) return false;
        if (p.test)       return p.test(parsed.pathname, url);
        if (p.pathPrefix) return parsed.pathname.startsWith(p.pathPrefix);
        if (p.pathExact)  return p.pathExact.includes(parsed.pathname);
        return parsed.pathname === '/';
      });
    } catch { return false; }
  }

  domainGroups = [];
  const groupMap    = {};
  const landingTabs = [];

  // Load user settings (controls aggregation mode + sub-grouping)
  const settings = await settingsAPI.getSettings();

  // First pass: classify every tab (isLandingByPattern + groupKey).
  // A tab is only treated as a "true" landing page if its group key has
  // count 1 — i.e. it's the only tab on its domain. This means
  // x.com/home + x.com/elonmusk both end up in the 'x.com' group
  // (because the landing page pattern is overridden by the coexisting
  // non-landing tab on the same domain).
  const items = realTabs.map(tab => {
    const r = settingsAPI.getGroupKeyForUrl(tab.url, settings);
    return {
      tab,
      isLandingByPattern: isLandingPage(tab.url),
      groupKey:    r.key,
      groupLabel:  r.label,
    };
  });

  // Count tabs per group key
  const groupCount = {};
  for (const item of items) {
    groupCount[item.groupKey] = (groupCount[item.groupKey] || 0) + 1;
  }

  // Second pass: build groups — landing pages only when alone
  for (const item of items) {
    try {
      if (item.isLandingByPattern && groupCount[item.groupKey] === 1) {
        landingTabs.push(item.tab);
        continue;
      }
      if (!groupMap[item.groupKey]) {
        groupMap[item.groupKey] = { domain: item.groupKey, label: item.groupLabel, tabs: [] };
      }
      groupMap[item.groupKey].tabs.push(item.tab);
    } catch {
      // Skip malformed URLs
    }
  }

  if (landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', tabs: landingTabs };
  }

  // Sort: landing pages first, then domains from landing page sites, then by tab count
  // Collect exact hostnames and suffix patterns for priority sorting
  const landingHostnames = new Set(LANDING_PAGE_PATTERNS.map(p => p.hostname).filter(Boolean));
  const landingSuffixes = LANDING_PAGE_PATTERNS.map(p => p.hostnameEndsWith).filter(Boolean);
  function isLandingDomain(domain) {
    if (landingHostnames.has(domain)) return true;
    return landingSuffixes.some(s => domain.endsWith(s));
  }
  domainGroups = Object.values(groupMap).sort((a, b) => {
    const aIsLanding = a.domain === '__landing-pages__';
    const bIsLanding = b.domain === '__landing-pages__';
    if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;

    const aIsPriority = isLandingDomain(a.domain);
    const bIsPriority = isLandingDomain(b.domain);
    if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;

    return b.tabs.length - a.tabs.length;
  });

  // --- Render domain cards ---
  const openTabsSection      = document.getElementById('openTabsSection');
  const openTabsMissionsEl   = document.getElementById('openTabsMissions');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');

  if (domainGroups.length > 0 && openTabsSection) {
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = t('section.open_tabs');
    // Compute fingerprints once for all open tabs (used for dupe detection)
    const allOpenUrls = realTabs.map(t => t.url).filter(Boolean);
    const fingerprintByUrl = await buildFingerprintMap(allOpenUrls);
    const fingerprintCounts = new Map();
    for (const url of allOpenUrls) {
      const fp = fingerprintByUrl.get(url);
      fingerprintCounts.set(fp, (fingerprintCounts.get(fp) || 0) + 1);
    }
    openTabsMissionsEl.innerHTML = domainGroups.map(g => renderDomainCard(g, settings, fingerprintCounts, fingerprintByUrl)).join('');
    openTabsSection.style.display = 'block';
  } else if (openTabsSection) {
    openTabsSection.style.display = 'none';
  }

  // --- Footer stats ---

  // --- Check for duplicate TabCtrl tabs ---
  checkTableControlDupes();

  // --- Render "Saved for Later" column ---
  await renderDeferredColumn();

  // --- Hero concept showcase (shown when everything is empty) ---
  updateHeroVisibility();
}

// HERO — empty-state concept showcase.
// Shown when no open tabs, no stash, no history. Three slogans rotate
// every ~6s. Click a dot to jump to a specific slide.
let _heroTimer = null;
let _heroIdx = 0;
const HERO_INTERVAL_MS = 6000;

function startHeroRotation() {
  if (_heroTimer) return;
  _heroTimer = setInterval(() => {
    _heroIdx = (_heroIdx + 1) % 3;
    setHeroSlide(_heroIdx);
  }, HERO_INTERVAL_MS);
}
function stopHeroRotation() {
  if (_heroTimer) { clearInterval(_heroTimer); _heroTimer = null; }
}

function setHeroSlide(idx) {
  _heroIdx = ((idx % 3) + 3) % 3;
  const slides = document.querySelectorAll('.hero-slide');
  const dots   = document.querySelectorAll('.hero-dot');
  slides.forEach((s, i) => s.classList.toggle('is-active', i === _heroIdx));
  dots.forEach((d, i)   => d.classList.toggle('is-active', i === _heroIdx));
}

function updateHeroVisibility() {
  const hero = document.getElementById('heroSection');
  if (!hero) return;
  const openCount    = (typeof openTabs !== 'undefined' && openTabs) ? openTabs.length : 0;
  const stashCount   = _lastStashCount || 0;
  const historyCount = _lastHistoryCount || 0;
  const wasVisible = hero.classList.contains('is-visible');
  const empty = openCount === 0 && stashCount === 0 && historyCount === 0;
  hero.classList.toggle('is-visible', empty);
  if (empty) {
    // Reset to slide 0 each time hero becomes visible — gives a clean
    // re-entry for the user instead of resuming mid-rotation.
    if (!wasVisible) {
      _heroIdx = 0;
      setHeroSlide(0);
    }
    startHeroRotation();
  } else {
    stopHeroRotation();
  }
}

// Click handler for hero dot navigation
document.addEventListener('click', (e) => {
  const dot = e.target.closest('.hero-dot');
  if (!dot) return;
  const slide = parseInt(dot.dataset.slide, 10);
  if (!Number.isFinite(slide)) return;
  setHeroSlide(slide);
});

async function renderHome() {
  await renderStaticDashboard();
  // Apply translations to any [data-i18n*] attributes still in the DOM.
  // (Language switcher moved into settings panel — no UI toggle to update here.)
  window.i18n.applyToDOM();
  // Set the "Clear >Nd" button label to the user's retention setting.
  // Safe to call even when history section is empty / hidden — updateHeroVisibility
  // handles the section show/hide; the button text just needs to be correct.
  if (window.settingsAPI) {
    window.settingsAPI.getSettings().then(settings => updateHistoryClearOlderButton(settings));
  } else {
    updateHistoryClearOlderButton(null);
  }
}


/* ----------------------------------------------------------------
   EVENT HANDLERS — using event delegation

   One listener on document handles ALL button clicks.
   Think of it as one security guard watching the whole building
   instead of one per door.
   ---------------------------------------------------------------- */

document.addEventListener('click', async (e) => {
  // Walk up the DOM to find the nearest element with data-action
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  // ---- Close duplicate TabCtrl tabs ----
  if (action === 'close-table-control-dupes') {
    await closeTableControlDupes();
    const banner = document.getElementById('tableControlDupeBanner');
    if (banner) {
      banner.style.transition = 'opacity 0.4s';
      banner.style.opacity = '0';
      setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = '1'; }, 400);
    }
    showToast(t('toast.closed_table_control_dupes'));
    return;
  }

  const card = actionEl.closest('.mission-card');

  // ---- Expand overflow chips ("+N more") ----
  if (action === 'expand-chips') {
    const overflowContainer = actionEl.parentElement.querySelector('.page-chips-overflow');
    if (overflowContainer) {
      overflowContainer.style.display = 'contents';
      actionEl.remove();
    }
    return;
  }

  // ---- Focus a specific tab ----
  if (action === 'focus-tab') {
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabUrl) await focusTab(tabUrl);
    return;
  }

  // ---- Close a single tab ----
  if (action === 'close-single-tab') {
    e.stopPropagation(); // don't trigger parent chip's focus-tab
    const tabUrl = actionEl.dataset.tabUrl;
    if (!tabUrl) return;

    // Find and close the tab, tracking it for undo (chrome.sessions.restore()
    // does NOT work for programmatically-closed tabs)
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    if (match) await closeSingleTabAndTrack(match.id);
    await fetchOpenTabs();

    // Animate the chip row out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => {
        chip.remove();
        // If the card now has no tabs, remove it too
        const parentCard = document.querySelector('.mission-card:has(.mission-pages:empty)');
        if (parentCard) animateCardOut(parentCard);
        document.querySelectorAll('.mission-card').forEach(c => {
          if (c.querySelectorAll('.page-chip[data-action="focus-tab"]').length === 0) {
            animateCardOut(c);
          }
        });
      }, 200);
    }

    // Update footer

    showToast(t('toast.tab_closed'), {
      undoLabel: t('toast.undo'),
      undoCallback: () => undoClose(),
    });
    return;
  }

  // ---- Save a single tab for later (then close it) ----
  if (action === 'defer-single-tab') {
    e.stopPropagation();
    const tabUrl   = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    if (!tabUrl) return;

    // Save to chrome.storage.local
    try {
      // Resolve the full Tab object from chrome.tabs so that
      // captureTabSnapshot() can read the tab's scroll position
      // and (if it's the active tab in the current window) capture
      // a thumbnail. Passing only { url, title } left the snapshot
      // empty because the id is required for executeScript /
      // captureVisibleTab. Bug found 2026-06-17 by 老板.
      const allTabs  = await chrome.tabs.query({});
      const fullTab  = allTabs.find(t => t.url === tabUrl) || { url: tabUrl, title: tabTitle };
      await saveTabForLater(fullTab);
      await renderDeferredColumn();
    } catch (err) {
      console.error('[TabCtrl] Failed to save tab:', err);
      const msg = (err && (err.message || err.toString)) ? (err.message || err.toString()) : 'unknown';
      showToast(t('toast.failed_save') + ' — ' + msg.slice(0, 80));
      return;
    }

    // Close the tab in Chrome (tracked for undo)
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    if (match) {
      // Tell the background service worker this close is stash-driven,
      // so tabs.onRemoved should NOT record it in history.
      try {
        await chrome.runtime.sendMessage({ type: 'skip-history', tabId: match.id });
      } catch {}
      await closeSingleTabAndTrack(match.id);
    }
    await fetchOpenTabs();

    // Animate chip out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => chip.remove(), 200);
    }

    showToast(t('toast.stashed'));
    await renderDeferredColumn();
    return;
  }

  // ---- Bookmark a tab (add to Chrome bookmarks) ----
  if (action === 'bookmark-tab') {
    e.stopPropagation();
    const tabUrl   = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    if (!tabUrl) return;

    // API unavailable — fall back to bookmark manager
    if (!chrome.bookmarks || typeof chrome.bookmarks.create !== 'function') {
      try { await chrome.tabs.create({ url: 'chrome://bookmarks/' }); } catch {}
      showToast(t('toast.bookmark_reload_hint') || 'Bookmarks API unavailable — reload TabCtrl at chrome://extensions');
      return;
    }

    // Already bookmarked → show manage / remove / move dialog
    if (_bookmarkedUrlsCache.has(tabUrl)) {
      showBookmarkMenu(tabUrl, tabTitle, actionEl, e);
      return;
    }

    // Not bookmarked → open the in-page bookmark dialog (Chrome Ctrl+D flow).
    showBookmarkDialog(tabUrl, tabTitle, actionEl);
    return;
  }

  // ---- Toggle folder tree node (expand/collapse) ----
  if (action === 'bookmark-tree-toggle') {
    e.stopPropagation();
    const node = actionEl.closest('.bookmark-tree-node');
    if (node) node.classList.toggle('expanded');
    return;
  }

  // ---- Select folder in tree ----
  if (action === 'bookmark-tree-select') {
    e.stopPropagation();
    const folderId = actionEl.dataset.folderId;
    const treeEl = document.getElementById('bookmarkTree');
    setSelectedBookmarkFolder(treeEl, folderId);
    return;
  }

  // ---- Close bookmark modal ----
  // In 'create' mode: just close.
  // In 'manage' mode: jump to the bookmark in Chrome's bookmark manager
  // (so the user lands on the page that just got saved).
  if (action === 'close-bookmark-modal') {
    if (_pendingBookmark && _pendingBookmark.mode === 'manage' && _pendingBookmark.bookmarkId) {
      const bookmarkId = _pendingBookmark.bookmarkId;
      hideBookmarkDialog();
      try {
        await chrome.tabs.create({ url: 'chrome://bookmarks/?id=' + encodeURIComponent(bookmarkId) });
      } catch (err) {
        showToast(t('toast.failed_bookmark') + ' — ' + ((err && err.message) ? err.message : String(err)).slice(0, 80));
      }
      return;
    }
    hideBookmarkDialog();
    return;
  }

  // ---- Remove bookmark from dialog ----
  if (action === 'remove-bookmark') {
    if (!_pendingBookmark || _pendingBookmark.mode !== 'manage') return;
    const { url, bookmarkId, actionEl } = _pendingBookmark;
    try {
      await chrome.bookmarks.remove(bookmarkId);
      _bookmarkedUrlsCache.delete(url);
      // Revert chip to unbookmarked state
      if (actionEl && actionEl.classList) {
        actionEl.classList.remove('bookmarked');
        const svg = actionEl.querySelector('svg');
        if (svg) svg.setAttribute('fill', 'none');
      }
      hideBookmarkDialog();
      showToast(t('toast.bookmark_removed'));
    } catch (err) {
      console.error('[TabCtrl] Failed to remove bookmark:', err);
      showToast(t('toast.failed_bookmark') + ' — ' + ((err && err.message) ? err.message : String(err)).slice(0, 80));
    }
    return;
  }

  // ---- Save or Move bookmark from dialog ----
  if (action === 'save-bookmark') {
    if (!_pendingBookmark) return;
    const { url, title, actionEl, mode } = _pendingBookmark;
    const nameInput    = document.getElementById('bookmarkNameInput');
    const treeEl = document.getElementById('bookmarkTree');
    const errorEl     = document.getElementById('bookmarkError');
    const chosenName  = nameInput.value.trim() || title || url;
    const parentId    = getSelectedBookmarkFolder(treeEl);

    if (!parentId) {
      errorEl.textContent = 'Please choose a folder first.';
      errorEl.style.display = 'block';
      return;
    }

    try {
      if (mode === 'create') {
        await chrome.bookmarks.create({ parentId, url, title: chosenName });
        _bookmarkedUrlsCache.add(url);
        // Flip chip to bookmarked state
        if (actionEl && actionEl.classList) {
          actionEl.classList.add('bookmarked');
          const svg = actionEl.querySelector('svg');
          if (svg) svg.setAttribute('fill', 'currentColor');
        }
        hideBookmarkDialog();
        showToast(t('toast.bookmarked', chosenName));
      } else {
        // mode === 'manage': move the bookmark to a different folder
        const { bookmarkId } = _pendingBookmark;
        await chrome.bookmarks.move(bookmarkId, { parentId });
        hideBookmarkDialog();
        showToast(t('toast.bookmark_moved'));
      }
    } catch (err) {
      console.error('[TabCtrl] Failed to save/move bookmark:', err);
      errorEl.textContent = 'Failed: ' + ((err && err.message) ? err.message : String(err)).slice(0, 80);
      errorEl.style.display = 'block';
    }
    return;
  }

  // ---- Toggle a subgroup (expand/collapse its tab chips) ----
  if (action === 'toggle-subgroup') {
    const rowId = actionEl.dataset.subgroupId;
    if (!rowId) return;
    const chipsContainer = document.getElementById(rowId);
    if (!chipsContainer) return;
    const isOpen = chipsContainer.style.display !== 'none';
    chipsContainer.style.display = isOpen ? 'none' : 'flex';
    const row = actionEl.closest('.subgroup-row');
    if (row) row.classList.toggle('open', !isOpen);
    return;
  }

  // ---- Close all tabs in a subgroup ----
  if (action === 'close-subgroup') {
    e.stopPropagation();
    const rowId = actionEl.dataset.subgroupId;
    const subgroupKey = actionEl.dataset.subgroupKey;
    if (!rowId || !subgroupKey) return;

    // Find the parent domain card and its data
    const card = actionEl.closest('.mission-card');
    const domainId = card?.dataset.domainId;
    if (!domainId) return;
    const group = domainGroups.find(g => 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId);
    if (!group) return;

    // Filter tabs whose subgroup key matches
    const tabsInSubgroup = group.tabs.filter(tab => getSubgroupKey(tab.url) === subgroupKey);
    if (tabsInSubgroup.length === 0) return;
    const urls = tabsInSubgroup.map(t => t.url);
    await closeTabsByUrls(urls);

    // Animate the row out
    const row = actionEl.closest('.subgroup-row');
    if (row) {
      row.classList.add('closing');
      setTimeout(() => row.remove(), 250);
    }

    // If no subgroups left, remove the parent card too
    setTimeout(() => {
      const cardStillThere = card && document.body.contains(card);
      if (cardStillThere) {
        const remaining = card.querySelectorAll('.subgroup-row:not(.closing)').length;
        if (remaining === 0) {
          animateCardOut(card);
          const idx = domainGroups.indexOf(group);
          if (idx !== -1) domainGroups.splice(idx, 1);
        } else {
          // Update parent domain card's count badge
          const newTotal = group.tabs.length - tabsInSubgroup.length;
          const tabBadge = card.querySelector('.open-tabs-badge');
          if (tabBadge) tabBadge.innerHTML = `${ICONS.tabs} ${newTotal !== 1 ? t('domain.tabs_open', newTotal) : t('domain.tab_open')}`;
        }
      }
    }, 300);

    const sgLabel = getSubgroupLabel(subgroupKey);
    showToast(urls.length !== 1
      ? t('toast.closed_from_group', urls.length, sgLabel)
      : t('toast.closed_one_from_group', sgLabel), {
      undoLabel: t('toast.undo'),
      undoCallback: () => undoClose(),
    });
    return;
  }

  // ---- Close all tabs in a domain group ----
  if (action === 'close-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    const group    = domainGroups.find(g => {
      return 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId;
    });
    if (!group) return;

    const urls      = group.tabs.map(t => t.url);
    // Landing pages and custom groups (whose domain key isn't a real hostname)
    // must use exact URL matching to avoid closing unrelated tabs
    const useExact  = group.domain === '__landing-pages__' || !!group.label;

    if (useExact) {
      await closeTabsExact(urls);
    } else {
      await closeTabsByUrls(urls);
    }

    if (card) {
      animateCardOut(card);
    }

    // Remove from in-memory groups
    const idx = domainGroups.indexOf(group);
    if (idx !== -1) domainGroups.splice(idx, 1);

    const groupLabel = group.domain === '__landing-pages__' ? t('domain.homepages') : (group.label || friendlyDomain(group.domain));
    showToast(urls.length !== 1
      ? t('toast.closed_from_group', urls.length, groupLabel)
      : t('toast.closed_one_from_group', groupLabel), {
      undoLabel: t('toast.undo'),
      undoCallback: () => undoClose(),
    });

    return;
  }

  // ---- Close duplicates, keep one copy ----
  if (action === 'dedup-keep-one') {
    const fpsEncoded = actionEl.dataset.dupeFps || '';
    const fps = fpsEncoded.split(',').map(u => decodeURIComponent(u)).filter(Boolean);
    if (fps.length === 0) return;

    await closeDuplicateTabs(fps, true);

    // Hide the dedup button
    actionEl.style.transition = 'opacity 0.2s';
    actionEl.style.opacity    = '0';
    setTimeout(() => actionEl.remove(), 200);

    // Remove dupe badges from the card
    if (card) {
      card.querySelectorAll('.chip-dupe-badge').forEach(b => {
        b.style.transition = 'opacity 0.2s';
        b.style.opacity    = '0';
        setTimeout(() => b.remove(), 200);
      });
      card.querySelectorAll('.open-tabs-badge').forEach(badge => {
        if (badge.textContent.includes('duplicate')) {
          badge.style.transition = 'opacity 0.2s';
          badge.style.opacity    = '0';
          setTimeout(() => badge.remove(), 200);
        }
      });
      card.classList.remove('has-amber-bar');
      card.classList.add('has-neutral-bar');
    }

    showToast(t('toast.dedup_done'), {
      undoLabel: t('toast.undo'),
      undoCallback: () => undoClose(),
    });
    return;
  }

  // (Removed in commit 4: toggle-select-mode / select-all /
  //  delete-selected / clear-completed handlers. The multi-select
  //  checkbox UI is gone; new stash uses per-item reopen/remove.)

  // ---- History: reopen a single entry ----
  if (action === 'reopen-history-item') {
    e.preventDefault();
    const url = actionEl.dataset.historyUrl;
    if (!url) return;
    try {
      await chrome.tabs.create({ url });
      // Remove the entry we just reopened (avoid stale "reopen" button)
      const id = actionEl.dataset.historyId;
      if (id) await removeHistoryEntry(id);
      showToast(t('history.reopened', shortDomain(url)));
      // Reset page so the user sees the updated top-of-list.
      _historyPage = 0;
      if (window.renderDeferredColumn) await window.renderDeferredColumn();
    } catch (err) {
      console.error('[TabCtrl] Reopen failed:', err);
    }
    return;
  }

  // ---- History: delete a single entry ----
  if (action === 'delete-history-item') {
    e.preventDefault();
    const id = actionEl.dataset.historyId;
    if (!id) return;
    await removeHistoryEntry(id);
    showToast(t('history.deleted'));
    // Reset to page 0 so the user sees the updated top-of-list.
    _historyPage = 0;
    if (window.renderDeferredColumn) await window.renderDeferredColumn();
    return;
  }

  // ---- History: pagination ----
  if (action === 'history-page-prev' || action === 'history-page-next') {
    e.preventDefault();
    const delta = action === 'history-page-next' ? +1 : -1;
    _historyPage = Math.max(0, _historyPage + delta);
    const section      = document.getElementById('historySection');
    const listEl       = document.getElementById('historyList');
    const emptyEl      = document.getElementById('historyEmpty');
    const countEl      = document.getElementById('historyCount');
    const searchEl     = document.getElementById('historySearch');
    const [items, settings] = await Promise.all([
      getHistory(),
      window.settingsAPI ? window.settingsAPI.getSettings() : Promise.resolve({}),
    ]);
    renderHistorySection({
      section, listEl, emptyEl, countEl, searchEl,
      items, settings,
      filterQuery: searchEl ? searchEl.value : '',
    });
    return;
  }

  // ---- History: group-by toggle (time | domain) ----
  if (action === 'history-group-by') {
    e.preventDefault();
    const next = actionEl.dataset.groupBy;
    if (!next || next === _historyGroupBy) return;
    _historyGroupBy = next;
    _historyPage = 0; // reset to first page so the user sees the new layout
    // Update toggle visual state
    document.querySelectorAll('.history-group-btn').forEach(b => {
      b.classList.toggle('is-active', b.dataset.groupBy === _historyGroupBy);
    });
    const section      = document.getElementById('historySection');
    const listEl       = document.getElementById('historyList');
    const emptyEl      = document.getElementById('historyEmpty');
    const countEl      = document.getElementById('historyCount');
    const searchEl     = document.getElementById('historySearch');
    const [items, settings] = await Promise.all([
      getHistory(),
      window.settingsAPI ? window.settingsAPI.getSettings() : Promise.resolve({}),
    ]);
    renderHistorySection({
      section, listEl, emptyEl, countEl, searchEl,
      items, settings,
      filterQuery: searchEl ? searchEl.value : '',
    });
    return;
  }

  // ---- History: clear all ----
  if (action === 'clear-history') {
    e.preventDefault();
    const items = await getHistory();
    if (items.length === 0) return;
    if (!confirm(t('history.clear_confirm', items.length))) return;
    await chrome.storage.local.remove('history');
    showToast(t('history.cleared', items.length));
    _historyPage = 0;
    await renderDeferredColumn();
    return;
  }

  // ---- History: clear entries older than retention ----
  if (action === 'clear-history-older') {
    e.preventDefault();
    const [items, settings] = await Promise.all([
      getHistory(),
      window.settingsAPI ? window.settingsAPI.getSettings() : Promise.resolve({}),
    ]);
    const days = (settings && settings.historyRetentionDays) || 7;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const olderCount = items.filter(it => it && it.closedAt && it.closedAt < cutoff).length;
    if (olderCount === 0) {
      showToast(t('history.clear_older_empty', days));
      return;
    }
    if (!confirm(t('history.clear_older_confirm', olderCount, days))) return;
    const pruned = await pruneHistoryNow(days);
    showToast(t('history.cleared', pruned));
    _historyPage = 0;
    await renderDeferredColumn();
    return;
  }

  // ---- Stash: filter chips ----
  if (action === 'stash-filter-all') {
    e.preventDefault();
    activeStashCategoryId = null;
    await renderStashColumn();
    return;
  }
  if (action === 'stash-filter-category') {
    e.preventDefault();
    // Right-click on a cat chip opens the popover (handled by contextmenu,
    // not here); a normal click just filters.
    activeStashCategoryId = actionEl.dataset.categoryId || null;
    await renderStashColumn();
    return;
  }

  // Inline add-category input controls
  if (action === 'stash-category-add-cancel') {
    e.preventDefault();
    e.stopPropagation();
    closeStashCategoryAdd();
    return;
  }
  if (action === 'stash-category-add-confirm') {
    e.preventDefault();
    e.stopPropagation();
    const input = document.getElementById('stashCategoryAddInput');
    if (!input) return;
    const name = input.value.trim().slice(0, 40);
    if (!name) { closeStashCategoryAdd(); return; }
    const cats = await getStashCategories();
    const nextOrder = (cats.reduce((m, c) => Math.max(m, c.order || 0), -1)) + 1;
    const newCat = {
      id: 'cat_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name,
      order: nextOrder,
      builtin: false,
    };
    cats.push(newCat);
    await saveStashCategories(cats);
    closeStashCategoryAdd();
    await renderStashColumn();
    return;
  }

  // Inline rename input controls
  if (action === 'stash-category-rename-cancel') {
    e.preventDefault();
    e.stopPropagation();
    closeStashCategoryRename();
    return;
  }
  if (action === 'stash-category-rename-confirm') {
    e.preventDefault();
    e.stopPropagation();
    const input = document.getElementById('stashCategoryRenameInput');
    const id = input && input.dataset.categoryId;
    if (!input || !id) return;
    const name = input.value.trim().slice(0, 40);
    if (name) {
      const cats = await getStashCategories();
      const cat = cats.find(c => c.id === id);
      if (cat) {
        cat.name = name;
        await saveStashCategories(cats);
      }
    }
    closeStashCategoryRename();
    await renderStashColumn();
    return;
  }

  // Right-click popover actions
  if (action === 'stash-category-rename-start') {
    e.preventDefault();
    e.stopPropagation();
    hideStashCategoryMenu();
    const id = actionEl.dataset.categoryId;
    if (id) openStashCategoryRename(id);
    return;
  }
  if (action === 'stash-category-delete-start') {
    e.preventDefault();
    e.stopPropagation();
    hideStashCategoryMenu();
    const id = actionEl.dataset.categoryId;
    if (!id) return;
    const cats = await getStashCategories();
    const cat = cats.find(c => c.id === id);
    if (!cat) return;
    showStashCategoryDeleteConfirm(cat);
    return;
  }
  if (action === 'stash-category-delete-confirm') {
    e.preventDefault();
    e.stopPropagation();
    const id = actionEl.dataset.categoryId;
    if (!id) return;
    await deleteStashCategory(id);
    hideStashCategoryDeleteConfirm();
    await renderStashColumn();
    return;
  }
  if (action === 'stash-category-delete-cancel') {
    e.preventDefault();
    e.stopPropagation();
    hideStashCategoryDeleteConfirm();
    return;
  }

  if (action === 'stash-reopen') {
    e.preventDefault();
    const url = actionEl.dataset.stashUrl;
    const id  = actionEl.dataset.stashId;
    if (!url) return;
    try {
      // Look up the snapshot (if any) so we can restore scroll
      // position once the new tab finishes loading.
      let snap = null;
      if (id) {
        const list = await getStash();
        const item = list.find(it => it.id === id);
        snap = item && item.snapshot;
      }
      const newTab = await chrome.tabs.create({ url });
      if (newTab && newTab.id != null && snap) {
        // Wait for the page to load, then scroll back to the saved
        // window position and any captured container scroll positions.
        // Accept both new ({window, containers}) and legacy
        // ({scrollX, scrollY}) snapshot shapes.
        const hasWindow    = snap.window && (snap.window.x || snap.window.y);
        const hasContainers = Array.isArray(snap.containers) && snap.containers.length > 0;
        const hasLegacy    = snap.scrollY || snap.scrollX;
        if (hasWindow || hasContainers || hasLegacy) {
          let fired = false;
          const triggerRestore = () => {
            if (fired) return;
            fired = true;
            chrome.tabs.onUpdated.removeListener(listener);
            restoreScrollForTab(newTab.id, snap);
          };
          // Primary: wait for `complete`. Avoids racing the document
          // load on slow pages.
          function listener(tabId, change) {
            if (tabId === newTab.id && change.status === 'complete') {
              triggerRestore();
            }
          }
          chrome.tabs.onUpdated.addListener(listener);
          // Fallback: if `complete` never fires (cached tab already
          // complete, listener missed, etc.), restore after 800ms anyway.
          // restoreScrollForTab itself retries 5x, so it's safe to start early.
          setTimeout(triggerRestore, 800);
        }
      }
      if (id) await removeFromStash(id);
      // Re-render so the chip disappears immediately after the
      // new tab is opened, instead of lingering until the next
      // render cycle.
      await renderDeferredColumn();
      showToast(t('stash.reopened', shortDomain(url)));
    } catch (err) {
      console.error('[TabCtrl] Stash reopen failed:', err);
    }
    return;
  }
  if (action === 'stash-remove') {
    e.preventDefault();
    const id = actionEl.dataset.stashId;
    if (!id) return;
    await removeFromStash(id);
    // Re-render the whole deferred column so the chip disappears
    // immediately, the count badge updates, and the empty state
    // appears if this was the last item.
    await renderDeferredColumn();
    showToast(t('stash.removed'));
    return;
  }
  if (action === 'stash-category-add') {
    e.preventDefault();
    openStashCategoryAdd();
    return;
  }

  // (Removed in commit 4: export-markdown handler. Export feature is
  //  gone in the new Tab Stash model; can be re-added later if needed.)

  // ---- Clear insights (close history) ----
  if (action === 'clear-insights') {
    e.preventDefault();
    const msg = window.i18n ? window.i18n.t('insights.clear_confirm') : 'Erase close history?';
    if (!confirm(msg)) return;
    await clearInsights();
    await renderInsights();
    return;
  }

  // ---- Close ALL open tabs ----
  // (Removed: 'close-all-open-tabs' handler — global close-all was a destructive
  //  one-click action that closed every user tab at once. Per-domain close
  //  still works via .action-btn.close-tabs inside each mission card.)
});

// ---- History search — live filter ----
document.addEventListener('input', async (e) => {
  if (e.target.id === 'historySearch') {
    const section = document.getElementById('historySection');
    const listEl  = document.getElementById('historyList');
    const emptyEl = document.getElementById('historyEmpty');
    const countEl = document.getElementById('historyCount');
    if (!section || !listEl) return;
    const [items, settings] = await Promise.all([
      getHistory(),
      window.settingsAPI ? window.settingsAPI.getSettings() : Promise.resolve({}),
    ]);
    renderHistorySection({
      section, listEl, emptyEl, countEl,
      searchEl: e.target,
      items, settings,
      filterQuery: e.target.value,
    });
    return;
  }

  // ---- Stash search — live filter (URL or title) ----
  if (e.target.id === 'stashSearch') {
    await renderStashColumn();
    return;
  }
});

/**
 * removeHistoryEntry(id) — drop one entry from the history buffer.
 * Storage write is atomic per entry; safe to call from any handler.
 */
async function removeHistoryEntry(id) {
  try {
    const items = await getHistory();
    const next  = items.filter(it => it.id !== id);
    if (next.length !== items.length) {
      await chrome.storage.local.set({ history: next });
    }
  } catch (err) {
    console.error('[TabCtrl] removeHistoryEntry failed:', err);
  }
}

/**
 * pruneHistoryNow(days) — drop history entries older than `days` days.
 * Called from the settings UI when the user changes the retention value.
 * `days` is clamped to [1, 30] to match the input min/max.
 *
 * Returns the number of entries pruned.
 */
async function pruneHistoryNow(days) {
  let d = parseInt(days, 10);
  if (!Number.isFinite(d)) d = 7;
  d = Math.max(1, Math.min(30, d));
  const cutoffMs = Date.now() - d * 24 * 60 * 60 * 1000;
  try {
    const items = await getHistory();
    const next  = items.filter(it => it && it.closedAt && it.closedAt >= cutoffMs);
    const pruned = items.length - next.length;
    if (pruned > 0) {
      await chrome.storage.local.set({ history: next });
    }
    return pruned;
  } catch (err) {
    console.error('[TabCtrl] pruneHistoryNow failed:', err);
    return 0;
  }
}

/**
 * shortDomain(url) — "github.com" from "https://github.com/foo".
 * Used in toast messages for compact display.
 */
function shortDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url || ''; }
}


/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */
setupGlobalErrorHandlers();

// Prime the bookmarked-URLs cache (for the ⭐ 'bookmarked' visual state).
// Fire-and-forget; renderStaticDashboard() re-renders after the await chain.
refreshBookmarkedUrlsCache();

// Clicking the dimmed overlay background closes the bookmark dialog.
const bmOverlay = document.getElementById('bookmarkOverlay');
if (bmOverlay) {
  bmOverlay.addEventListener('click', () => hideBookmarkDialog());
}

// ── Real-time tab refresh ─────────────────────────────────────────────
// Re-render when tabs are opened, navigated, or closed outside TabCtrl.
// Debounced: rapid bursts (e.g. opening 5 tabs in a row) collapse into
// a single re-render via scheduleRefresh(). A safety poll every 5s
// catches anything the event listeners missed (background-tab discard,
// service-worker restart, etc.).
let _refreshTimer = null;
let _refreshing = false;
let _lastRefreshSig = null; // fingerprint of last-rendered tab set, to skip no-op polls

function tabSetSignature(tabs) {
  // Compact hash of (id, url, title) per tab. Used to skip renders
  // when nothing actually changed.
  return tabs.map(t => (t.id || '') + ':' + (t.url || '') + ':' + (t.title || '')).join('|');
}

function scheduleRefresh(reason) {
  if (_refreshTimer) return;
  _refreshTimer = setTimeout(async () => {
    _refreshTimer = null;
    if (_refreshing) {
      // Already mid-refresh — re-schedule so we don't drop this tick.
      _refreshTimer = setTimeout(() => { _refreshTimer = null; scheduleRefresh(reason); }, 200);
      return;
    }
    _refreshing = true;
    try {
      await fetchOpenTabs();
      const sig = tabSetSignature(openTabs);
      if (sig !== _lastRefreshSig) {
        _lastRefreshSig = sig;
        await renderHome();
      }
    } catch (err) {
      console.warn('[TabCtrl] refresh failed (' + (reason || 'unknown') + '):', err && err.message);
    } finally {
      _refreshing = false;
    }
  }, 100); // coalesce bursts into a single render
}

chrome.tabs.onCreated.addListener(() => scheduleRefresh('onCreated'));
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  // Re-render on title/url/favicon changes AND on load-complete so the
  // open-tabs section stays in sync without waiting for the safety poll.
  if (change.status === 'complete' ||
      change.title ||
      change.url ||
      change.favIconUrl !== undefined) {
    scheduleRefresh('onUpdated:' + (change.status || Object.keys(change).filter(k => change[k]).join(',')));
  }
});
chrome.tabs.onRemoved.addListener(() => scheduleRefresh('onRemoved'));

// Safety net: poll every 5s. Catches anything the listeners missed
// (e.g. when the page is in a background window and Chrome throttles
// event delivery, or when an event fires while _refreshing is true and
// gets dropped).
setInterval(() => scheduleRefresh('poll'), 5000);

// Expose refresh hooks on window so the standalone settings page
// (settings.html / settings-page.js) can ask the new-tab dashboard
// to re-render after the user changes settings. Mounted 2026-06-22
// as part of the options_page refactor.
window.renderHome = renderHome;
window.renderDeferredColumn = renderDeferredColumn;
window.updateHistoryClearOlderButton = updateHistoryClearOlderButton;

renderHome();
