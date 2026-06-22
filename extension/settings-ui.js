/**
 * settings-ui.js — Stub for the new-tab page
 *
 * Settings no longer live inside the new-tab page (they were extracted
 * into a standalone options_page on 2026-06-22 — see settings.html,
 * settings.css, settings-page.js). This file now does exactly one
 * thing: wire the inline gear icon in the hero section to
 * `chrome.runtime.openOptionsPage()`, which Chrome opens as a
 * regular tab the user can keep, pin, or close at will.
 *
 * The hero gear uses `data-action="open-settings"` (kept for
 * backwards compatibility with the old in-page panel), so we
 * intercept the click here.
 */

(function () {
  'use strict';

  function onSettingsClick(e) {
    const btn = e.target.closest('#settingsBtn, [data-action="open-settings"]');
    if (!btn) return;
    e.preventDefault();
    // Fall back to opening settings.html directly if the runtime API
    // is unavailable (shouldn't happen in MV3, but cheap insurance).
    if (chrome.runtime && chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else if (chrome.runtime && chrome.runtime.getURL) {
      window.open(chrome.runtime.getURL('settings.html'), '_blank');
    }
  }

  function init() {
    document.addEventListener('click', onSettingsClick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
