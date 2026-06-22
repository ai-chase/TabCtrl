/**
 * settings.js — User-configurable settings for TabCtrl
 *
 * Persisted in chrome.storage.local under key 'table-control-settings'.
 * Provides default values and load/save helpers, plus the group-key
 * computation that decides how tabs are aggregated into domain cards.
 *
 * Settings shape:
 * {
 *   aggregationMode:    "main-domain" | "full-hostname" | "custom"
 *   customRules:        [{ pattern, groupKey, groupLabel }, ...]
 *   subGroupingEnabled: boolean
 *   subGroupingRules:   [{ source, pattern, match, template }, ...]
 *                        — sub-group tabs inside each domain by URL patterns
 *                        — source: 'default' | 'user' (user overrides built-in)
 *   historyRetentionDays: 1-30 — auto-prune closed-tab history older than this
 *   historyPageSize:      3-20 — closed-tab entries shown per page
 * }
 */

(function () {
  'use strict';

  const SETTINGS_KEY = 'table-control-settings';

  /**
   * Built-in sub-grouping rules. Matched in order; first hit wins.
   * Each rule: { source, pattern, match, template }
   *   - source:   'default' | 'user' (set by UI on add)
   *   - pattern:  hostname or hostname suffix (use '*' as catch-all)
   *   - match:    JS RegExp against the URL pathname (no flags)
   *   - template: output subgroup key, with $1, $2 ... placeholders
   *
   * User rules (source: 'user') are prepended at match-time, so they
   * override defaults. To "disable" a default, add a higher-priority user
   * rule that matches the same pattern.
   */
  const DEFAULT_SUB_GROUPING_RULES = [
    // GitHub: owner/repo (e.g. Aaron-l33/cool-project)
    { source: 'default', pattern: 'github.com',      match: '^/([^/]+)/([^/]+)',     template: '$1/$2' },
    { source: 'default', pattern: 'gist.github.com', match: '^/([^/]+)/([^/]+)',     template: '$1/$2' },
    // YouTube: @channel (works for /@mkbhd, /@mkbhd/videos, etc.)
    { source: 'default', pattern: 'youtube.com',     match: '^/@([^/]+)',            template: '@$1' },
    { source: 'default', pattern: 'www.youtube.com', match: '^/@([^/]+)',            template: '@$1' },
    // Reddit: r/subreddit (matches /r/X/comments/...)
    { source: 'default', pattern: 'reddit.com',      match: '^/r/([^/]+)',           template: 'r/$1' },
    { source: 'default', pattern: 'old.reddit.com',  match: '^/r/([^/]+)',           template: 'r/$1' },
    // X / Twitter: @user (matches /elonmusk, /elonmusk/status/...)
    { source: 'default', pattern: 'twitter.com',     match: '^/([^/]+)',             template: '@$1' },
    { source: 'default', pattern: 'x.com',           match: '^/([^/]+)',             template: '@$1' },
    { source: 'default', pattern: 'www.x.com',       match: '^/([^/]+)',             template: '@$1' },
    // Stack Overflow: question id
    { source: 'default', pattern: 'stackoverflow.com', match: '^/questions/([^/]+)', template: '$1' },
    // Catch-all: path's first segment (e.g. notion.so/My-Page → My-Page)
    { source: 'default', pattern: '*',               match: '^/([^/]+)',             template: '$1' },
  ];

  /**
   * Built-in stash categories. User can rename, delete, or add to these.
   * Order matters — it controls the left-to-right tab order in the UI.
   *
   * Unsorted is intentionally first (above any user category) so the
   * "no classification" bucket is always one click away.
   */
  const DEFAULT_STASH_CATEGORIES = [
    { id: 'cat_unsorted', name: 'Unsorted', order: 0, builtin: true },
  ];

  const DEFAULT_SETTINGS = {
    aggregationMode:      'main-domain',
    customRules:          [],
    subGroupingEnabled:   false,
    subGroupingRules:     DEFAULT_SUB_GROUPING_RULES.slice(),  // user-overridable; built-ins are kept for transparency
    language:             'auto',     // 'auto' | 'en' | 'zh' — UI mirror of i18n's STORAGE_KEY
    recordHistory:        true,       // record close events to history (TabCtrl-driven closes only)
    archiveRetentionDays: 90,         // legacy, kept for migration
    historyRetentionDays: 7,          // auto-prune closed-tab history older than this (1-30)
    historyPageSize:      5,          // how many closed-tab entries to show per page (3-20)
    stashCategories:      DEFAULT_STASH_CATEGORIES.slice(),    // user-editable; built-ins listed for transparency
  };

  // In-memory cache; populated on first getSettings() and refreshed by saveSettings().
  let cached = null;

  /**
   * Get current settings (loads from storage on first call, caches after).
   */
  async function getSettings() {
    if (cached) return cached;
    try {
      const { [SETTINGS_KEY]: stored } = await chrome.storage.local.get(SETTINGS_KEY);
      cached = mergeWithDefaults(stored || {});
    } catch {
      cached = { ...DEFAULT_SETTINGS };
    }
    return cached;
  }

  /**
   * Save settings (replaces entire settings object) and update cache.
   * Triggers a re-render via storage change listener if wired up.
   */
  async function saveSettings(settings) {
    cached = mergeWithDefaults(settings || {});
    try {
      await chrome.storage.local.set({ [SETTINGS_KEY]: cached });
    } catch (err) {
      console.error('[TabCtrl] Failed to save settings:', err);
    }
    return cached;
  }

  /**
   * Reset to defaults.
   */
  async function resetSettings() {
    return await saveSettings({ ...DEFAULT_SETTINGS });
  }

  /**
   * Compute the group key for a URL based on current settings.
   * Returns { key, label } — key is the stable identifier used to group tabs;
   * label is what to display in the UI (null means: derive from key via friendlyDomain).
   *
   * Synchronous — caller is expected to await getSettings() once and pass
   * the resolved settings object in.
   */
  function getGroupKeyForUrl(url, settings) {
    settings = settings || DEFAULT_SETTINGS;
    let hostname;
    try {
      hostname = new URL(url).hostname;
    } catch {
      return { key: 'unknown', label: null };
    }

    // Special URLs keep their existing identity
    if (url.startsWith('file://')) {
      return { key: 'local-files', label: null };
    }
    if (hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      return { key: hostname, label: null };
    }

    switch (settings.aggregationMode) {
      case 'full-hostname':
        return { key: hostname, label: null };

      case 'custom': {
        const rules = settings.customRules || [];
        for (const rule of rules) {
          const pattern = (rule.pattern || '').trim();
          if (!pattern) continue;
          // Support both ".google.com" (suffix match) and "google.com" (also suffix)
          const bare = pattern.replace(/^\./, '');
          if (hostname === bare || hostname.endsWith('.' + bare)) {
            return {
              key:   (rule.groupKey || bare).trim(),
              label: (rule.groupLabel || '').trim() || null,
            };
          }
        }
        // No rule matched — fall back to main-domain
        return { key: getMainDomain(hostname), label: null };
      }

      case 'main-domain':
      default:
        return { key: getMainDomain(hostname), label: null };
    }
  }

  /**
   * Curated multi-part Public Suffix List entries that affect
   * main-domain extraction. Covers ~95% of real-world multi-part TLDs
   * (mostly country-code second-level registrations).
   *
   *   bbc.co.uk       → main is "bbc.co.uk" (3 parts), NOT "co.uk"
   *   example.com.cn  → main is "example.com.cn" (3 parts), NOT "com.cn"
   *   foo.cn          → main is "foo.cn" (2 parts)
   *
   * Sourced from Mozilla PSL — only the rules that change main-domain
   * extraction behavior for 2-segment hostnames. Full PSL is hundreds
   * of KB; this curated list keeps extension size small while handling
   * the common cases.
   */
  const MULTI_PART_TLDS = new Set([
    // UK
    'co.uk', 'org.uk', 'net.uk', 'ac.uk', 'gov.uk', 'sch.uk', 'me.uk', 'ltd.uk', 'plc.uk',
    // Japan
    'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'ed.jp', 'ad.jp', 'gr.jp', 'lg.jp',
    // Korea
    'co.kr', 'or.kr', 'ne.kr', 'go.kr', 'ac.kr', 're.kr',
    // China
    'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn', 'mil.cn',
    // Hong Kong / Taiwan / Singapore
    'com.hk', 'org.hk', 'net.hk', 'edu.hk', 'gov.hk',
    'com.tw', 'org.tw', 'net.tw', 'edu.tw', 'gov.tw',
    'com.sg', 'org.sg', 'net.sg', 'edu.sg', 'gov.sg',
    // Australia / India / New Zealand / South Africa
    'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
    'co.in', 'net.in', 'org.in', 'edu.in', 'gov.in',
    'co.nz', 'net.nz', 'org.nz', 'edu.nz', 'govt.nz',
    'co.za', 'org.za', 'net.za', 'ac.za', 'gov.za',
    // Americas
    'com.br', 'net.br', 'org.br', 'edu.br', 'gov.br',
    'com.ar', 'org.ar', 'gov.ar', 'edu.ar',
    'com.mx', 'org.mx', 'edu.mx', 'gob.mx',
    'com.co', 'com.pe', 'com.ve', 'com.ec', 'com.do',
    // Asia / Middle East
    'com.tr', 'org.tr', 'edu.tr', 'gov.tr',
    'com.ph', 'net.ph', 'org.ph',
    'co.th', 'ac.th', 'go.th',
    'co.id', 'or.id', 'go.id', 'ac.id',
    'co.il', 'org.il', 'net.il', 'ac.il', 'gov.il',
    'com.eg', 'edu.eg', 'gov.eg',
    'co.ke', 'org.ke',
    'co.ma', 'org.ma',
    'co.ng', 'org.ng',
    // Europe (selected)
    'co.es', 'org.es', 'edu.es', 'gov.es',
    'co.it', 'org.it',
    'com.ru', 'org.ru', 'net.ru',
    'com.pl', 'org.pl', 'edu.pl', 'gov.pl',
    'co.cz', 'org.cz',
    'co.gr', 'org.gr',
    'co.hu', 'org.hu',
    'co.rs', 'org.rs',
    'com.ua', 'org.ua',
    'co.ee', 'org.ee',
    'co.lv', 'org.lv',
    'co.lt', 'org.lt',
    'co.dk', 'org.dk',
    'co.nl', 'com.nl',
    'co.be', 'org.be',
    'co.ch', 'org.ch',
    'co.at', 'or.at',
    'co.ie', 'org.ie',
    'com.pt', 'org.pt',
  ]);

  /**
   * Get main domain (last 2 segments, or 3 if last 2 form a multi-part TLD).
   *
   *   mail.google.com  → "google.com"
   *   gist.github.com  → "github.com"
   *   github.com       → "github.com"
   *   bbc.co.uk        → "bbc.co.uk"  (PSL: co.uk is a public suffix)
   *   example.com.cn   → "example.com.cn"
   *   foo.cn           → "foo.cn"
   */
  function getMainDomain(hostname) {
    const parts = hostname.split('.');
    if (parts.length <= 2) return hostname;

    // Check if the last 2 segments form a known multi-part TLD.
    // If so, take 3 segments instead of 2.
    const lastTwo = parts.slice(-2).join('.');
    if (MULTI_PART_TLDS.has(lastTwo) && parts.length >= 3) {
      return parts.slice(-3).join('.');
    }
    return parts.slice(-2).join('.');
  }

  function mergeWithDefaults(obj) {
    const retention = obj.archiveRetentionDays;
    // subGroupingRules migration: older versions have no field at all.
    // Seed with built-in defaults so existing users get the curated rules
    // without losing any user-added rules (they're already in obj).
    let subGroupingRules = DEFAULT_SETTINGS.subGroupingRules.slice();
    if (Array.isArray(obj.subGroupingRules) && obj.subGroupingRules.length > 0) {
      subGroupingRules = obj.subGroupingRules;
    }
    // stashCategories migration: empty/missing -> seed with built-ins.
    // User-added categories live in obj already, so we just preserve them.
    let stashCategories = DEFAULT_SETTINGS.stashCategories.slice();
    if (Array.isArray(obj.stashCategories) && obj.stashCategories.length > 0) {
      stashCategories = obj.stashCategories;
    }
    // History retention: clamp to [1, 30]. Sane defaults if missing/invalid.
    let historyRetentionDays = DEFAULT_SETTINGS.historyRetentionDays;
    if (typeof obj.historyRetentionDays === 'number' && obj.historyRetentionDays >= 1 && obj.historyRetentionDays <= 30) {
      historyRetentionDays = obj.historyRetentionDays;
    }

    // History page size: clamp to [3, 20].
    let historyPageSize = DEFAULT_SETTINGS.historyPageSize;
    if (typeof obj.historyPageSize === 'number' && obj.historyPageSize >= 3 && obj.historyPageSize <= 20) {
      historyPageSize = obj.historyPageSize;
    }

    return {
      aggregationMode:      obj.aggregationMode    || DEFAULT_SETTINGS.aggregationMode,
      customRules:          Array.isArray(obj.customRules) ? obj.customRules : [],
      subGroupingEnabled:   obj.subGroupingEnabled === true,
      subGroupingRules:     subGroupingRules,
      language:             obj.language || DEFAULT_SETTINGS.language,
      recordHistory:        typeof obj.recordHistory === 'boolean' ? obj.recordHistory : DEFAULT_SETTINGS.recordHistory,
      archiveRetentionDays: (typeof retention === 'number') ? retention : DEFAULT_SETTINGS.archiveRetentionDays,
      historyRetentionDays: historyRetentionDays,
      historyPageSize:      historyPageSize,
      stashCategories:      stashCategories,
    };
  }

  // Expose the multi-part TLD list so friendlyDomain() in app.js can
  // strip them before splitting the hostname by '.' (e.g. so
  // "sina.com.cn" displays as "Sina", not "Sina Com Cn").
  window.MULTI_PART_TLDS = MULTI_PART_TLDS;

  /**
   * getSubgroupKey(url, settings)
   *
   * Returns the subgroup key for a URL based on the user's subGroupingRules.
   * First matching rule wins. User rules (source: 'user') are checked
   * before defaults (source: 'default') so users can override.
   *
   * Returns '/' when no rule matches (caller renders as a single bucket).
   */
  function getSubgroupKey(url, settings) {
    settings = settings || DEFAULT_SETTINGS;
    let parsed;
    try { parsed = new URL(url); } catch { return '/'; }
    const hostname = parsed.hostname;
    const path     = parsed.pathname;
    const rules    = settings.subGroupingRules || DEFAULT_SUB_GROUPING_RULES;

    // Sort rules: user rules first, then defaults. Stable order within each.
    const sorted = rules.slice().sort((a, b) => {
      const aUser = (a.source === 'user') ? 0 : 1;
      const bUser = (b.source === 'user') ? 0 : 1;
      return aUser - bUser;
    });

    for (const rule of sorted) {
      // Hostname match: '*' catch-all, exact, or suffix (.google.com)
      let hostnameOk = false;
      if (rule.pattern === '*') {
        hostnameOk = true;
      } else if (!rule.pattern) {
        continue;
      } else {
        const bare = rule.pattern.replace(/^\./, '');
        hostnameOk = hostname === bare || hostname.endsWith('.' + bare);
      }
      if (!hostnameOk) continue;

      // Path regex match
      let m;
      try { m = path.match(new RegExp(rule.match)); }
      catch { continue; }   // bad regex → skip this rule, try next
      if (!m) continue;

      // Template substitution: $1, $2 ... → capture groups
      return rule.template.replace(/\$(\d+)/g, (_, idx) => m[+idx] != null ? m[+idx] : '');
    }
    return '/';
  }

  // Expose API
  window.settingsAPI = {
    getSettings,
    saveSettings,
    resetSettings,
    getGroupKeyForUrl,
    getMainDomain,
    getSubgroupKey,
    DEFAULT_SETTINGS,
    DEFAULT_SUB_GROUPING_RULES,
    DEFAULT_STASH_CATEGORIES,
  };
})();
