/**
 * settings-page.js — Standalone settings page for TabCtrl
 *
 * This file is the body-less version of settings-ui.js, lifted out of
 * the new-tab page into a Chrome options_page (chrome://extensions/...
 * TabCtrl/options.html) on 2026-06-22. All slide-in-panel / overlay
 * plumbing has been removed — settings now live on their own page.
 *
 * Renders the settings form and handles all user interactions
 * (language, aggregation mode, custom rules add/remove/edit, sub-
 * grouping toggle, reset, history retention). Reads/writes via
 * window.settingsAPI; re-renders the dashboard via window.renderDashboard
 * on every change so the new-tab page stays in sync.
 */

(function () {
  'use strict';

  let bodyEl = null;

  // Tracks whether the built-in rules list is expanded (persisted in memory only)
  let builtinExpanded = false;

  /* ----------------------------------------------------------------
     RENDER
     ---------------------------------------------------------------- */

  async function render() {
    const settings = await window.settingsAPI.getSettings();
    const rules = settings.customRules || [];

    bodyEl.innerHTML = `
      <section class="settings-section">
        <h3 class="settings-section-title" data-i18n="settings.language">Language</h3>
        <div class="settings-radio-group">
          <label class="settings-radio">
            <input type="radio" name="language" value="auto" ${settings.language === 'auto' ? 'checked' : ''}>
            <span data-i18n="settings.language_auto">Auto</span>
            <span class="settings-radio-hint" data-i18n="settings.language_auto_hint">follow browser</span>
          </label>
          <label class="settings-radio">
            <input type="radio" name="language" value="en" ${settings.language === 'en' ? 'checked' : ''}>
            <span>English</span>
          </label>
          <label class="settings-radio">
            <input type="radio" name="language" value="zh" ${settings.language === 'zh' ? 'checked' : ''}>
            <span>中文</span>
          </label>
        </div>
      </section>

      <section class="settings-section settings-grouping-section">
        <h3 class="settings-section-title" data-i18n="settings.grouping">Tab Grouping</h3>
        <p class="settings-section-desc" data-i18n="settings.grouping_desc">Decide how tabs are split into cards. Two levels: across domains first, then within each domain.</p>

        <div class="settings-level-block">
          <div class="settings-level-label" data-i18n="settings.grouping_level1">Level 1 — across domains</div>

          <label class="settings-radio-card">
            <input type="radio" name="aggregationMode" value="main-domain" ${settings.aggregationMode === 'main-domain' ? 'checked' : ''}>
            <div class="settings-radio-card-body">
              <div class="settings-radio-card-icon" aria-hidden="true">
                <svg width="64" height="40" viewBox="0 0 64 40" xmlns="http://www.w3.org/2000/svg">
                  <rect x="4"  y="6" width="18" height="28" rx="3" fill="currentColor" opacity="0.45"/>
                  <rect x="24" y="6" width="18" height="28" rx="3" fill="currentColor" opacity="0.45"/>
                  <rect x="44" y="6" width="18" height="28" rx="3" fill="currentColor" opacity="0.45"/>
                  <rect x="2"  y="3" width="60" height="34" rx="4" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2"/>
                </svg>
              </div>
              <div class="settings-radio-card-text">
                <div class="settings-radio-card-title">
                  <span data-i18n="settings.grouping_level1_merge">Merge subdomains</span>
                  <span class="settings-recommended-badge" data-i18n="settings.grouping_level1_merge_recommended">recommended</span>
                </div>
                <div class="settings-radio-card-hint" data-i18n="settings.grouping_level1_merge_hint">all *.google.com together as one card</div>
              </div>
            </div>
          </label>

          <label class="settings-radio-card">
            <input type="radio" name="aggregationMode" value="full-hostname" ${settings.aggregationMode === 'full-hostname' ? 'checked' : ''}>
            <div class="settings-radio-card-body">
              <div class="settings-radio-card-icon" aria-hidden="true">
                <svg width="64" height="40" viewBox="0 0 64 40" xmlns="http://www.w3.org/2000/svg">
                  <rect x="4"  y="6" width="18" height="28" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>
                  <rect x="24" y="6" width="18" height="28" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>
                  <rect x="44" y="6" width="18" height="28" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>
                </svg>
              </div>
              <div class="settings-radio-card-text">
                <div class="settings-radio-card-title">
                  <span data-i18n="settings.grouping_level1_separate">Separate subdomains</span>
                </div>
                <div class="settings-radio-card-hint" data-i18n="settings.grouping_level1_separate_hint">docs.google.com / mail.google.com as separate cards</div>
              </div>
            </div>
          </label>

          <label class="settings-radio-card">
            <input type="radio" name="aggregationMode" value="custom" ${settings.aggregationMode === 'custom' ? 'checked' : ''}>
            <div class="settings-radio-card-body">
              <div class="settings-radio-card-icon" aria-hidden="true">
                <svg width="64" height="40" viewBox="0 0 64 40" xmlns="http://www.w3.org/2000/svg">
                  <rect x="4"  y="4"  width="56" height="10" rx="2" fill="currentColor" opacity="0.3"/>
                  <rect x="4"  y="16" width="56" height="10" rx="2" fill="currentColor" opacity="0.3"/>
                  <rect x="4"  y="28" width="56" height="10" rx="2" fill="currentColor" opacity="0.3"/>
                </svg>
              </div>
              <div class="settings-radio-card-text">
                <div class="settings-radio-card-title">
                  <span data-i18n="settings.grouping_level1_custom">Custom rules</span>
                </div>
                <div class="settings-radio-card-hint" data-i18n="settings.grouping_level1_custom_hint">define your own pattern → group</div>
              </div>
            </div>
          </label>

          <div class="settings-custom-rules" id="customRulesList" style="display:${settings.aggregationMode === 'custom' ? 'block' : 'none'}">
            ${rules.length === 0
              ? `<div class="settings-empty" data-i18n="settings.no_rules">No rules yet. Click below to add one.</div>`
              : rules.map((rule, i) => renderCustomRule(rule, i)).join('')
            }
            <button class="settings-add-rule" data-action="add-rule" type="button">
              + <span data-i18n="settings.add_rule">Add rule</span>
            </button>
          </div>
        </div>

        <div class="settings-level-block">
          <div class="settings-level-label" data-i18n="settings.grouping_level2">Level 2 — inside each domain</div>

          <label class="settings-checkbox settings-level2-toggle">
            <input type="checkbox" id="subGroupingEnabled" ${settings.subGroupingEnabled ? 'checked' : ''}>
            <span class="settings-checkbox-title" data-i18n="settings.grouping_level2_enabled">Group by URL pattern</span>
            <span class="settings-radio-hint" data-i18n="settings.grouping_level2_enabled_hint">each repo / channel / subreddit as its own row</span>
          </label>

          <div class="settings-level2-rules" style="display:${settings.subGroupingEnabled ? 'block' : 'none'}">
            <div class="settings-subgroup-block-title" data-i18n="settings.grouping_level2_rules">Subgroup rules</div>
            <p class="settings-section-desc" data-i18n="settings.grouping_level2_rules_desc">First matching rule wins. User rules run first and override built-ins.</p>
            ${renderSubGroupingRulesBody(settings)}
          </div>
        </div>
      </section>

      <section class="settings-section settings-history-section">
        <h3 class="settings-section-title" data-i18n="settings.history">History</h3>
        <p class="settings-section-desc" data-i18n="settings.history_desc">Every tab you close is recorded here (default 7 days, configurable in Settings). Reopen or delete from the list below.</p>
        ${renderHistorySettingsBody(settings)}
      </section>

      <div class="settings-footer">
        <button class="settings-reset" data-action="reset-settings" type="button">
          <span data-i18n="settings.reset">Reset to defaults</span>
        </button>
      </div>
    `;

    // Translate the freshly inserted elements
    if (window.i18n && window.i18n.applyToDOM) {
      window.i18n.applyToDOM();
    }
  }

  /* ----------------------------------------------------------------
     HISTORY — retention + pagination
     ---------------------------------------------------------------- */
  function renderHistorySettingsBody(settings) {
    const retention = settings.historyRetentionDays != null ? settings.historyRetentionDays : 7;
    const pageSize  = settings.historyPageSize != null ? settings.historyPageSize : 5;
    return `
      <div class="settings-history-row">
        <label class="settings-history-label">
          <span data-i18n="settings.history_retention_label">Keep closed-tab history for</span>
          <input type="number" min="1" max="30" step="1"
                 id="historyRetentionDays" class="settings-history-input"
                 value="${retention}">
          <span data-i18n="settings.history_days">days</span>
        </label>
        <p class="settings-section-desc" data-i18n="settings.history_retention_hint">
          Older entries are pruned automatically. 1\u201330 days.
        </p>
      </div>
      <div class="settings-history-row">
        <label class="settings-history-label">
          <span data-i18n="settings.history_page_size_label">Show per page</span>
          <input type="number" min="3" max="20" step="1"
                 id="historyPageSize" class="settings-history-input"
                 value="${pageSize}">
          <span data-i18n="settings.history_entries">entries</span>
        </label>
        <p class="settings-section-desc" data-i18n="settings.history_page_size_hint">
          3\u201320 entries per page. More pages = more clicks to scroll through.
        </p>
      </div>
    `;
  }


  /**
   * Render the body of the Subgroup rules section (no outer section/wrapper
   * — caller puts it inside its own container).
   */
  function renderSubGroupingRulesBody(settings) {
    const allRules = settings.subGroupingRules || [];
    const userRules    = allRules.filter(r => r.source === 'user');
    const builtinRules = allRules.filter(r => r.source !== 'user');
    const defaultRules = (window.settingsAPI && window.settingsAPI.DEFAULT_SUB_GROUPING_RULES)
      ? window.settingsAPI.DEFAULT_SUB_GROUPING_RULES
      : [];

    return `
        <div class="settings-subgroup-block">
          <div class="settings-subgroup-block-head">
            <span class="settings-subgroup-block-title" data-i18n="settings.sub_grouping_builtin">Built-in rules</span>
            <button class="settings-link-btn" data-action="toggle-builtin" type="button">
              ${builtinExpanded
                ? '<span data-i18n="settings.sub_grouping_builtin_hide">Hide</span>'
                : '<span data-i18n="settings.sub_grouping_builtin_show">Show all</span>'}
            </button>
          </div>
          <div class="settings-rule-list ${builtinExpanded ? 'expanded' : 'collapsed'}">
            ${builtinRules.length > 0
              ? builtinRules.map((r, i) => renderBuiltinRule(r, i)).join('')
              : defaultRules.map((r, i) => renderBuiltinRule(r, i)).join('')}
          </div>
        </div>

        <div class="settings-subgroup-block">
          <div class="settings-subgroup-block-head">
            <span class="settings-subgroup-block-title" data-i18n="settings.sub_grouping_user">Your custom rules</span>
          </div>
          ${userRules.length === 0
            ? `<div class="settings-empty" data-i18n="settings.sub_grouping_user_empty">No custom rules. Add one below, or test a URL to override a built-in.</div>`
            : `<div class="settings-rule-list expanded">${userRules.map((r, i) => renderUserRule(r, i)).join('')}</div>`}
          <button class="settings-add-rule" data-action="add-subgroup-rule" type="button">
            + <span data-i18n="settings.sub_grouping_add">Add custom rule</span>
          </button>
        </div>

        <div class="settings-subgroup-block">
          <div class="settings-subgroup-block-head">
            <span class="settings-subgroup-block-title" data-i18n="settings.sub_grouping_test">Quick test</span>
          </div>
          <input type="text" class="settings-subgroup-test-input" id="subgroupTestInput"
                 placeholder="${escapeAttr(window.i18n ? window.i18n.t('settings.sub_grouping_test_placeholder') : 'Paste a URL...')}"
                 data-i18n-placeholder="settings.sub_grouping_test_placeholder">
          <div class="settings-subgroup-test-result" id="subgroupTestResult"></div>
        </div>
    `;
  }

  function renderBuiltinRule(rule, index) {
    return `
      <div class="settings-rule settings-rule-readonly" data-rule-index="${index}">
        <span class="rule-pattern rule-source-builtin">${escapeHtml(rule.pattern)}</span>
        <span class="rule-arrow">→</span>
        <code class="rule-match">${escapeHtml(rule.match)}</code>
        <span class="rule-arrow">→</span>
        <code class="rule-template">${escapeHtml(rule.template)}</code>
      </div>
    `;
  }

  function renderUserRule(rule, index) {
    return `
      <div class="settings-rule" data-rule-index="${index}">
        <input type="text" class="rule-pattern" value="${escapeAttr(rule.pattern || '')}"
               placeholder="pattern" data-i18n-placeholder="settings.sub_grouping_pattern_hint"
               data-action="update-subgroup-rule" data-field="pattern">
        <span class="rule-arrow">→</span>
        <input type="text" class="rule-match-input" value="${escapeAttr(rule.match || '')}"
               placeholder="regex" data-i18n-placeholder="settings.sub_grouping_match_hint"
               data-action="update-subgroup-rule" data-field="match">
        <span class="rule-arrow">→</span>
        <input type="text" class="rule-template" value="${escapeAttr(rule.template || '')}"
               placeholder="template" data-i18n-placeholder="settings.sub_grouping_template_hint"
               data-action="update-subgroup-rule" data-field="template">
        <button class="rule-remove" data-action="remove-subgroup-rule" data-rule-index="${index}" type="button" aria-label="Remove">×</button>
      </div>
    `;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function renderCustomRule(rule, index) {
    return `
      <div class="settings-rule" data-rule-index="${index}">
        <input type="text" class="rule-pattern" value="${escapeAttr(rule.pattern || '')}"
               placeholder="pattern" data-i18n-placeholder="settings.rule_pattern_placeholder"
               data-action="update-rule" data-field="pattern">
        <span class="rule-arrow">→</span>
        <input type="text" class="rule-key" value="${escapeAttr(rule.groupKey || '')}"
               placeholder="key" data-i18n-placeholder="settings.rule_key_placeholder"
               data-action="update-rule" data-field="groupKey">
        <input type="text" class="rule-label" value="${escapeAttr(rule.groupLabel || '')}"
               placeholder="label" data-i18n-placeholder="settings.rule_label_placeholder"
               data-action="update-rule" data-field="groupLabel">
        <button class="rule-remove" data-action="remove-rule" data-rule-index="${index}" type="button" aria-label="Remove">×</button>
      </div>
    `;
  }

  function escapeAttr(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function ensureRefs() {
    if (!bodyEl) bodyEl = document.getElementById('settingsBody');
  }

  /* ----------------------------------------------------------------
     EVENT HANDLERS
     ---------------------------------------------------------------- */

  async function handleClick(e) {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;

    if (action === 'open-settings') {
      // Ignored on the standalone settings page — there's nothing to open.
      // (Kept as a no-op so existing HTML data-action="open-settings"
      // attributes don't throw errors.)
      e.preventDefault();
      return;
    }
    if (action === 'close-settings') {
      // No-op on standalone page. Use the back link / browser back.
      e.preventDefault();
      return;
    }
    if (action === 'add-rule') {
      e.preventDefault();
      const settings = await window.settingsAPI.getSettings();
      settings.customRules = settings.customRules || [];
      settings.customRules.push({ pattern: '', groupKey: '', groupLabel: '' });
      await window.settingsAPI.saveSettings(settings);
      await render();
      if (window.renderDashboard) await window.renderDashboard();
      return;
    }
    if (action === 'remove-rule') {
      e.preventDefault();
      const idx = parseInt(actionEl.dataset.ruleIndex, 10);
      const settings = await window.settingsAPI.getSettings();
      if (idx >= 0 && idx < settings.customRules.length) {
        settings.customRules.splice(idx, 1);
        await window.settingsAPI.saveSettings(settings);
        await render();
        if (window.renderDashboard) await window.renderDashboard();
      }
      return;
    }
    if (action === 'reset-settings') {
      e.preventDefault();
      if (!confirm(getConfirmMessage('settings.reset_confirm'))) return;
      await window.settingsAPI.resetSettings();
      // Clear i18n's persisted language so reset truly reverts to auto
      if (window.i18n && window.i18n.clearPersistedLang) {
        window.i18n.clearPersistedLang();
      }
      await render();
      if (window.renderDashboard) await window.renderDashboard();
      return;
    }
    if (action === 'toggle-builtin') {
      e.preventDefault();
      builtinExpanded = !builtinExpanded;
      await render();
      return;
    }
    if (action === 'add-subgroup-rule') {
      e.preventDefault();
      const settings = await window.settingsAPI.getSettings();
      settings.subGroupingRules = settings.subGroupingRules || [];
      // Pre-fill pattern from the test input (if it looks like a hostname)
      const testInput = document.getElementById('subgroupTestInput');
      let pattern = '';
      if (testInput && testInput.value) {
        try {
          const u = new URL(testInput.value);
          pattern = u.hostname.replace(/^www\./, '');
        } catch {}
      }
      settings.subGroupingRules.push({
        source:   'user',
        pattern:  pattern,
        match:    '^/([^/]+)',
        template: '$1',
      });
      await window.settingsAPI.saveSettings(settings);
      await render();
      if (window.renderDashboard) await window.renderDashboard();
      return;
    }
    if (action === 'remove-subgroup-rule') {
      e.preventDefault();
      const idx = parseInt(actionEl.dataset.ruleIndex, 10);
      const settings = await window.settingsAPI.getSettings();
      // Map UI index (only user rules) to real array index
      const userIndices = (settings.subGroupingRules || [])
        .map((r, i) => (r.source === 'user' ? i : -1))
        .filter(i => i !== -1);
      const realIdx = userIndices[idx];
      if (realIdx != null && settings.subGroupingRules[realIdx]) {
        settings.subGroupingRules.splice(realIdx, 1);
        await window.settingsAPI.saveSettings(settings);
        await render();
        if (window.renderDashboard) await window.renderDashboard();
      }
      return;
    }
  }

  async function handleChange(e) {
    // Radio: language mode (special — triggers reload)
    if (e.target.name === 'language') {
      const lang = e.target.value;
      const settings = await window.settingsAPI.getSettings();
      settings.language = lang;
      await window.settingsAPI.saveSettings(settings);
      const effective = lang === 'auto'
        ? ((navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en')
        : lang;
      window.i18n.setLang(effective);  // triggers location.reload()
      return;
    }
    // Radio: aggregation mode
    if (e.target.name === 'aggregationMode') {
      const settings = await window.settingsAPI.getSettings();
      settings.aggregationMode = e.target.value;
      await window.settingsAPI.saveSettings(settings);
      await render();
      if (window.renderDashboard) await window.renderDashboard();
      return;
    }
    // Checkbox: sub-grouping
    if (e.target.id === 'subGroupingEnabled') {
      const settings = await window.settingsAPI.getSettings();
      settings.subGroupingEnabled = e.target.checked;
      await window.settingsAPI.saveSettings(settings);
      if (window.renderDashboard) await window.renderDashboard();
      return;
    }
    // Number: history retention (1-30 days)
    if (e.target.id === 'historyRetentionDays') {
      let days = parseInt(e.target.value, 10);
      if (!Number.isFinite(days)) days = 7;
      days = Math.max(1, Math.min(30, days));
      e.target.value = days;
      const settings = await window.settingsAPI.getSettings();
      settings.historyRetentionDays = days;
      await window.settingsAPI.saveSettings(settings);
      // Prune anything older than the new retention immediately.
      await pruneHistoryNow(days);
      if (window.renderDeferredColumn) await window.renderDeferredColumn();
      return;
    }
    // Number: history page size (3-20)
    if (e.target.id === 'historyPageSize') {
      let size = parseInt(e.target.value, 10);
      if (!Number.isFinite(size)) size = 5;
      size = Math.max(3, Math.min(20, size));
      e.target.value = size;
      const settings = await window.settingsAPI.getSettings();
      settings.historyPageSize = size;
      await window.settingsAPI.saveSettings(settings);
      if (window.renderDeferredColumn) await window.renderDeferredColumn();
      return;
    }
  }

  async function handleInput(e) {
    // Custom rule field edits (Aggregation > Custom rules)
    const ruleEl = e.target.closest('[data-action="update-rule"]');
    if (ruleEl) {
      const ruleRow = ruleEl.closest('.settings-rule');
      const idx = parseInt(ruleRow.dataset.ruleIndex, 10);
      const field = ruleEl.dataset.field;
      const settings = await window.settingsAPI.getSettings();
      if (settings.customRules[idx]) {
        settings.customRules[idx][field] = ruleEl.value;
        await window.settingsAPI.saveSettings(settings);
        if (window.renderDashboard) await window.renderDashboard();
      }
      return;
    }
    // Sub-grouping user rule field edits
    const sgRuleEl = e.target.closest('[data-action="update-subgroup-rule"]');
    if (sgRuleEl) {
      const ruleRow = sgRuleEl.closest('.settings-rule');
      const idx = parseInt(ruleRow.dataset.ruleIndex, 10);
      const field = sgRuleEl.dataset.field;
      const settings = await window.settingsAPI.getSettings();
      // UI idx maps to user-only rules
      const userIndices = (settings.subGroupingRules || [])
        .map((r, i) => (r.source === 'user' ? i : -1))
        .filter(i => i !== -1);
      const realIdx = userIndices[idx];
      if (realIdx != null && settings.subGroupingRules[realIdx]) {
        settings.subGroupingRules[realIdx][field] = sgRuleEl.value;
        await window.settingsAPI.saveSettings(settings);
        if (window.renderDashboard) await window.renderDashboard();
      }
      return;
    }
    // Quick-test URL input (live evaluation)
    if (e.target.id === 'subgroupTestInput') {
      runSubgroupTest(e.target.value);
      return;
    }
  }

  /**
   * Live-evaluate the test URL against the user's subGroupingRules and
   * render the result. Pure client-side — no save.
   */
  async function runSubgroupTest(url) {
    const resultEl = document.getElementById('subgroupTestResult');
    if (!resultEl) return;
    url = (url || '').trim();
    if (!url) {
      resultEl.innerHTML = '';
      return;
    }
    let parsed;
    try { parsed = new URL(url); }
    catch {
      resultEl.innerHTML = `<span class="settings-subgroup-test-error">Invalid URL</span>`;
      return;
    }
    const settings = await window.settingsAPI.getSettings();
    const api = window.settingsAPI;
    // Find first matching rule (same logic as getSubgroupKey)
    const rules = (settings.subGroupingRules || []).slice().sort((a, b) => {
      const aUser = (a.source === 'user') ? 0 : 1;
      const bUser = (b.source === 'user') ? 0 : 1;
      return aUser - bUser;
    });
    let match = null;
    let key = '/';
    for (const rule of rules) {
      let hostnameOk = false;
      if (rule.pattern === '*') hostnameOk = true;
      else if (!rule.pattern) continue;
      else {
        const bare = rule.pattern.replace(/^\./, '');
        hostnameOk = parsed.hostname === bare || parsed.hostname.endsWith('.' + bare);
      }
      if (!hostnameOk) continue;
      let m;
      try { m = parsed.pathname.match(new RegExp(rule.match)); }
      catch { continue; }
      if (!m) continue;
      key = rule.template.replace(/\$(\d+)/g, (_, idx) => m[+idx] != null ? m[+idx] : '');
      match = rule;
      break;
    }
    const t = window.i18n ? window.i18n.t.bind(window.i18n) : (k) => k;
    const sourceLabel = match
      ? (match.source === 'user' ? t('settings.sub_grouping_source_user') : t('settings.sub_grouping_source_default'))
      : '';
    const matchedText = match
      ? `${escapeHtml(match.pattern)} ${escapeHtml(match.match)} → ${escapeHtml(match.template)} (${sourceLabel})`
      : '';
    const overrideBtn = match
      ? `<button class="settings-link-btn" data-action="add-subgroup-rule" type="button">
           <span data-i18n="settings.sub_grouping_test_override">Override this domain</span>
         </button>`
      : '';
    if (match) {
      resultEl.innerHTML = `
        <div class="settings-subgroup-test-line">
          <strong>${t('settings.sub_grouping_test_result', escapeHtml(key))}</strong>
        </div>
        <div class="settings-subgroup-test-line settings-subgroup-test-matched">
          <span>${t('settings.sub_grouping_test_matched', matchedText)}</span>
          ${overrideBtn}
        </div>
      `;
    } else {
      resultEl.innerHTML = `
        <div class="settings-subgroup-test-line settings-subgroup-test-empty">
          ${t('settings.sub_grouping_test_none')}
        </div>
        ${overrideBtn}
      `;
    }
  }

  function getConfirmMessage(key) {
    if (window.i18n) return window.i18n.t(key || 'settings.reset_confirm');
    return 'Are you sure?';
  }

  /* ----------------------------------------------------------------
     INIT
     ---------------------------------------------------------------- */

  function init() {
    document.addEventListener('click', handleClick);
    document.addEventListener('change', handleChange);
    document.addEventListener('input', handleInput);
    // ESC key no longer closes a panel — it's a full page now.
    // (The browser handles ESC for native dialogs.)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        // Optional: focus the back link so keyboard users can return
        const back = document.querySelector('.settings-page-back');
        if (back && document.activeElement === document.body) back.focus();
      }
    });

    // Render once on load; re-render on any settings-shaped storage change
    // (e.g. if the new-tab page updates settings in another window).
    ensureRefs();
    render().catch(() => {});
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'local') return;
        const keys = Object.keys(changes);
        if (keys.some(k => /settings|ings/i.test(k))) {
          render().catch(() => {});
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
