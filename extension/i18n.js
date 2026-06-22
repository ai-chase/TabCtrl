/**
 * i18n.js — Localization for TabCtrl
 *
 * Provides manual language switching (not following Chrome locale).
 * - First visit: follows browser language
 * - User choice persists in localStorage
 * - Sync-loaded (blocking script tag) to prevent flash of untranslated content
 *
 * Usage:
 *   - Static HTML: <h1 data-i18n="section.saved_later"></h1>
 *   - title attr:  <button data-i18n-title="action.close_tab">
 *   - placeholder: <input data-i18n-placeholder="section.search_archive">
 *   - HTML (with tags): <div data-i18n-html="banner.table_control_dupes"></div>
 *   - In JS:       i18n.t('time.just_now')  /  i18n.t('toast.closed_from_group', n, name)
 *
 * Keys support %s placeholders, replaced in order with extra args.
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'table-control-lang';

  /**
   * Translation dictionaries.
   * Add a new language by adding a key here — no other code changes needed.
   */
  const I18N = {
    en: {
      'app.title':                 'TabCtrl',
      'app.description':           'Take control of your tabs.',

      'banner.table_control_dupes': 'You have %s TabCtrl tabs open. To avoid wasting resources, click the button to close the extras.',
      'banner.close_extras':       'Close extras',

      'section.open_tabs':         'Right now',
      // ===== History section (closed tabs, auto-recorded by background.js) =====
      'history.title':             'History',
      'history.desc':              'Every tab you close is recorded here (default 7 days, configurable in Settings). Reopen or delete from the list below.',
      'history.search_placeholder':'Search closed tabs...',
      'history.empty':             'No history yet. Closed tabs will appear here.',
      'history.group_today':       'Today',
      'history.group_yesterday':   'Yesterday',
      'history.group_this_week':   'This week',
      'history.group_older':       'Older',
      'history.reopen':            'Reopen',
      'history.reopened':          'Reopened: %s',
      'history.deleted':           'Removed from history',
      'history.clear':             'Clear all',
      'history.clear_confirm':     'Clear all %s history entries?',
      'history.cleared':           'Cleared %s entries',
      'history.clear_older':       'Clear >%sd',
      'history.clear_older_hint':  'Drop entries older than the retention setting (%s days)',
      'history.clear_older_confirm': 'Drop %s entries older than %s days?',
      'history.clear_older_empty': 'No entries older than %s days to clear.',
      'history.count_one':         '1 entry',
      'history.count_plural':      '%s entries',
      'history.page_info':         'Page %s of %s',
      'history.group_time':       'Time',
      'history.group_domain':     'Domain',

      // ===== Stash section (replaces "Save for later") =====
      'stash.title':               'Tab Stash',
      'stash.desc':                'Stashed tabs appear here. They stay until you reopen or remove them. Drag tabs for temporary category management.',
      'stash.empty':               'Stash is empty. Use the bookmark icon on any chip to park it here.',
      'stash.empty_search':        'No stashed tabs match your search.',
      'stash.search_placeholder':  'Search stashed tabs...',
      'stash.all':                 'All',
      'stash.uncategorized':       'Unsorted',
      'stash.category_new':        'New category',
      'stash.category_add':        'Add category',
      'stash.category_rename':     'Rename',
      'stash.category_delete':     'Delete category',
      'stash.category_delete_confirm': 'Delete category "%s"? Tabs in it will move to Unsorted.',
      'stash.category_placeholder': 'Category name...',
      'stash.note_placeholder':    'Add a note...',
      'stash.reopen':              'Reopen',
      'stash.reopened':            'Reopened: %s',
      'stash.removed':             'Removed from stash',
      'stash.drag_hint':           'Drag to another category',
      'stash.position_hint':       'Position saved — reopen to jump back',
      'stash.position_hint_xy':    'Scroll X=%s, Y=%s — reopen to jump back',
      'stash.position_hint_with_containers': 'Window X=%s Y=%s + %s scrolled container(s) — reopen to jump back',
      'stash.position_hint_top':   'Saved at top of page (X=0, Y=0)',
      'stash.stashed_count':       'Stashed %s times — click to see history',
      'stash.item_count':          '%s items',
      'stash.item_count_one':      '1 item',
      'stash.items_label':         'items',
      'stash.count_one':           '1 tab',
      'stash.count_plural':        '%s tabs',
      'stash.uncategorized_count_one': '1 unsorted',
      'stash.uncategorized_count_plural': '%s unsorted',

      'section.domain_count':      '1 domain',
      'section.domain_count_plural':  '%s domains',

      'domain.homepages':          'Homepages',
      'domain.tabs_open':          '%s tabs open',
      'domain.tab_open':           '1 tab open',
      'domain.duplicates':         '%s duplicate',
      'domain.duplicates_plural':  '%s duplicates',
      'domain.local_files':        'Local files',
      'domain.unknown':            'Unknown',

      'action.close_all':          'Close all %s tabs',
      'action.close_all_one':      'Close all 1 tab',
      'action.close_duplicates':   'Close %s duplicate',
      'action.close_duplicates_plural': 'Close %s duplicates',
      'action.save_for_later':     'Add to Stash',
      'action.bookmark':           'Add to Chrome bookmarks',
      'action.close_tab':          'Close this tab',
      'action.dismiss':            'Dismiss',
      'action.cancel':             'Cancel',

      'empty.title':               'Inbox zero, but for tabs.',
      'empty.subtitle':            "You're free.",
      'empty.domains_zero':        '0 domains',

      'time.just_now':             'just now',
      'time.min_ago':              '%s min ago',
      'time.hr_ago':               '%s hr ago',
      'time.hr_ago_plural':        '%s hrs ago',
      'time.yesterday':            'yesterday',
      'time.days_ago':             '%s days ago',

      'toast.closed_table_control_dupes': 'Closed extra TabCtrl tabs',
      'toast.tab_closed':          'Tab closed',
      'toast.undo':                'Undo',
      'toast.undo_failed':         'Undo failed',
      'toast.stashed':             'Added to Stash',
      'toast.failed_save':         'Failed to save tab',
      'toast.bookmarked':          'Bookmarked: %s',
      'toast.bookmark_removed':    'Bookmark removed',
      'toast.bookmark_moved':      'Bookmark moved',
      'toast.failed_bookmark':     'Failed to bookmark',
      'toast.bookmark_reload_hint':'Bookmarks API unavailable — open chrome://extensions and reload TabCtrl, then try again',
      'toast.snapshot_permission_missing': 'Snapshot needs site access — reload TabCtrl at chrome://extensions',

      // Bookmark dialog
      'bookmark.title':            'Add bookmark',
      'bookmark.bookmarked_title': 'Bookmark options',
      'bookmark.name_label':       'Name',
      'bookmark.folder_label':     'Folder',
      'bookmark.cancel':           'Cancel',
      'bookmark.save':             'Save',
      'bookmark.remove':           'Remove',
      'bookmark.move':            'Move',
      'bookmark.go_to_bookmark':   'Go to bookmark',
      'toast.closed_from_group':   'Closed %s tabs from %s',
      'toast.closed_one_from_group': 'Closed 1 tab from %s',
      'toast.dedup_done':          'Closed duplicates, kept one copy each',

      'search.no_results':         'No results',
      'footer.open_tabs':          'Open tabs',
      'author.x_tooltip':          'Follow 承越.Chase on X',

      'insights.title':            'Insights',
      'insights.closed_today':     'closed today',
      'insights.closed_week':      'closed this week',
      'insights.closed_total':     'total closed',
      'insights.top_all':          'top domains (all time)',
      'insights.top_week':         'top this week',
      'insights.no_closes':        'No closes yet',
      'insights.no_week':          'No closes this week',
      'insights.clear':            'Clear insights',
      'insights.clear_confirm':    'Erase all close history? This cannot be undone.',

      'lang.switch':               'Language',
      'lang.en':                   'EN',
      'lang.zh':                   '中',

      'settings.title':                 'Settings',
      'settings.page_title':            'TabCtrl Settings',
      'settings.page_subtitle':         'Configure how your new tab dashboard behaves. All settings save instantly.',
      'settings.back_link':             'Back to Dashboard',
      'settings.back_tooltip':          'Open new tab dashboard',
      'settings.footer_storage':        'Settings are stored locally in your browser. Nothing is sent anywhere.',
      'settings.aggregation':           'Aggregation',
      'settings.display':               'Display',
      'settings.mode_full_hostname':    'Full hostname',
      'settings.mode_full_hostname_hint': 'each subdomain separate',
      'settings.mode_main_domain':      'Main domain',
      'settings.mode_main_domain_hint': 'merge *.google.com etc.',
      'settings.mode_custom':           'Custom rules',
      'settings.mode_custom_hint':      'define your own pattern → group',
      'settings.sub_grouping':          'Sub-group by path',
      'settings.sub_grouping_hint':     'each repo / channel as its own row',
      'settings.no_rules':              'No rules yet. Click below to add one.',
      'settings.add_rule':              'Add rule',
      'settings.rule_pattern_placeholder': 'pattern (e.g. .google.com)',
      'settings.rule_key_placeholder':  'key',
      'settings.rule_label_placeholder': 'label (optional)',
      'settings.reset':                 'Reset to defaults',
      'settings.reset_confirm':         'Reset all settings to defaults?',
      'settings.language':              'Language',
      'settings.language_auto':         'Auto',
      'settings.language_auto_hint':    'follow browser',

      // History settings
      'settings.history':                       'History',
      'settings.history_desc':                  'Closed-tab history is kept for a configurable number of days and shown 5 per page by default.',
      'settings.history_retention_label':       'Keep closed-tab history for',
      'settings.history_days':                  'days',
      'settings.history_retention_hint':        'Older entries are pruned automatically. 1\u201330 days.',
      'settings.history_page_size_label':       'Show per page',
      'settings.history_entries':               'entries',
      'settings.history_page_size_hint':        '3\u201320 entries per page. More pages = more clicks to scroll through.',

      // ===== Unified "Tab Grouping" section (replaces 3 old sections) =====
      'settings.grouping':                 'Tab Grouping',
      'settings.grouping_desc':            'Decide how tabs are split into cards. Two levels: across domains first, then within each domain.',
      'settings.grouping_level1':          'Level 1 — across domains',
      'settings.grouping_level1_merge':    'Merge subdomains',
      'settings.grouping_level1_merge_hint': 'all *.google.com together as one card',
      'settings.grouping_level1_merge_recommended': 'recommended',
      'settings.grouping_level1_separate': 'Separate subdomains',
      'settings.grouping_level1_separate_hint': 'docs.google.com / mail.google.com as separate cards',
      'settings.grouping_level1_custom':   'Custom rules',
      'settings.grouping_level1_custom_hint': 'define your own pattern → group',
      'settings.grouping_level2':          'Level 2 — inside each domain',
      'settings.grouping_level2_enabled':  'Group by URL pattern',
      'settings.grouping_level2_enabled_hint': 'each repo / channel / subreddit as its own row',
      'settings.grouping_level2_rules':    'Subgroup rules',
      'settings.grouping_level2_rules_desc': 'First matching rule wins. User rules run first and override built-ins.',
      'settings.sub_grouping_builtin':       'Built-in rules',
      'settings.sub_grouping_builtin_show':  'Show all',
      'settings.sub_grouping_builtin_hide':  'Hide',
      'settings.sub_grouping_user':          'Your custom rules',
      'settings.sub_grouping_user_empty':    'No custom rules. Add one below, or test a URL to override a built-in.',
      'settings.sub_grouping_add':           'Add custom rule',
      'settings.sub_grouping_test':          'Quick test',
      'settings.sub_grouping_test_placeholder': 'Paste a URL to see which rule matches...',
      'settings.sub_grouping_test_result':   'Subgroup key: %s',
      'settings.sub_grouping_test_matched':  'Matched: %s',
      'settings.sub_grouping_test_none':     'No rule matched — would fall back to \'/\' (single bucket).',
      'settings.sub_grouping_test_override': 'Override this domain',
      'settings.sub_grouping_field_pattern': 'Pattern',
      'settings.sub_grouping_field_match':   'Match (regex)',
      'settings.sub_grouping_field_template': 'Output (template)',
      'settings.sub_grouping_pattern_hint':  'hostname (e.g. youtube.com) or * for catch-all',
      'settings.sub_grouping_match_hint':    'JS regex against the URL path',
      'settings.sub_grouping_template_hint': 'use $1, $2 for capture groups',
      'settings.sub_grouping_invalid_regex': 'Invalid regex — rule ignored at runtime',
      'settings.sub_grouping_source_default': 'built-in',
      'settings.sub_grouping_source_user':    'custom',
    },

    zh: {
      'app.title':                 'TabCtrl',
      'app.description':           '掌控你的标签页。',

      'banner.table_control_dupes': '你打开了 %s 个 TabCtrl 标签页，为了不必要资源浪费，请点击按钮关闭多余的。',
      'banner.close_extras':       '关闭多余的',

      'section.open_tabs':         '当前打开',
      // ===== 历史记录 section (后台自动记录关闭的标签) =====
      'history.title':             '历史记录',
      'history.desc':              '你关闭的每一个标签都会自动保存在这里（默认 7 天，可在设置中调整）。可以从下方列表重新打开或删除。',
      'history.search_placeholder':'搜索已关闭的标签...',
      'history.empty':             '暂无历史。关闭的标签会出现在这里。',
      'history.group_today':       '今天',
      'history.group_yesterday':   '昨天',
      'history.group_this_week':   '本周',
      'history.group_older':       '更早',
      'history.reopen':            '重新打开',
      'history.reopened':          '已重新打开: %s',
      'history.deleted':           '已从历史中移除',
      'history.clear':             '清空全部',
      'history.clear_confirm':     '确定清空全部 %s 条历史记录？',
      'history.cleared':           '已清空 %s 条',
      'history.clear_older':       '清空 %s 天前',
      'history.clear_older_hint':  '删除超过保留天数（%s 天）的记录',
      'history.clear_older_confirm': '确认删除 %s 条超过 %s 天的记录？',
      'history.clear_older_empty': '没有超过 %s 天的记录可清空。',
      'history.count_one':         '1 条',
      'history.count_plural':      '%s 条',
      'history.page_info':         '第 %s 页 / 共 %s 页',
      'history.group_time':       '按时间',
      'history.group_domain':     '按域名',

      // ===== Hero (空状态概念轮播) =====
      'hero.slogan_1': '当标签页过载成为日常，TabCtrl 帮你回到清晰。',
      'hero.slogan_2': '不是要打开更多，只是让你看清现有。',
      'hero.slogan_3': '注意力是稀缺资源，TabCtrl 帮你珍惜它。',
      'hero.sub_1':    '标签堆积如山，我们帮你看到地面。',
      'hero.sub_2':    '更少点击，更少噪音，还是那些标签。',
      'hero.sub_3':    '每个固定标签都是对"重要"的投票。',

      // ===== 标签暂存 (取代"稍后再读") =====
      'stash.title':               '标签暂存',
      'stash.desc':                '加入暂存的标签在这显示，它会一直保留直到重新打开或删除，拖拽标签可以进行临时的分类管理。',
      'stash.empty':               '暂存区为空。点击任何 chip 上的书签图标即可暂存。',
      'stash.empty_search':        '没有匹配的暂存标签。',
      'stash.search_placeholder':  '搜索暂存标签...',
      'stash.all':                 '全部',
      'stash.uncategorized':       '未分类',
      'stash.category_new':        '新建分类',
      'stash.category_add':        '添加分类',
      'stash.category_rename':     '重命名',
      'stash.category_delete':     '删除分类',
      'stash.category_delete_confirm': '删除分类"%s"？该分类下的标签会移到未分类。',
      'stash.category_placeholder': '分类名称...',
      'stash.note_placeholder':    '添加备注...',
      'stash.reopen':              '重新打开',
      'stash.reopened':            '已重新打开: %s',
      'stash.removed':             '已从暂存中移除',
      'stash.drag_hint':           '拖到其他分类',
      'stash.moved_to_category':   '已移动到 %s',
      'stash.position_hint':       '已保存位置——重新打开时会跳转',
      'stash.position_hint_xy':    '滚动 X=%s, Y=%s——重新打开时会跳转',
      'stash.position_hint_with_containers': '窗口 X=%s Y=%s + %s 个滚动容器——重新打开时会跳转',
      'stash.position_hint_top':   '已保存顶部位置 (X=0, Y=0)',
      'stash.stashed_count':       '已暂存 %s 次——点击查看历史',
      'stash.item_count':          '%s 项',
      'stash.item_count_one':      '1 项',
      'stash.items_label':         '项',
      'stash.count_one':           '1 个标签',
      'stash.count_plural':        '%s 个标签',
      'stash.uncategorized_count_one': '1 个未分类',
      'stash.uncategorized_count_plural': '%s 个未分类',

      'section.domain_count':      '1 个域名',
      'section.domain_count_plural':  '%s 个域名',

      'domain.homepages':          '首页组',
      'domain.tabs_open':          '%s 个标签打开',
      'domain.tab_open':           '1 个标签打开',
      'domain.duplicates':         '%s 个重复',
      'domain.duplicates_plural':  '%s 个重复',
      'domain.local_files':        '本地文件',
      'domain.unknown':            '未知',

      'action.close_all':          '关闭全部 %s 个',
      'action.close_all_one':      '关闭全部 1 个',
      'action.close_duplicates':   '关闭 %s 个重复',
      'action.close_duplicates_plural': '关闭 %s 个重复',
      'action.save_for_later':     '加入暂存',
      'action.bookmark':           '加入收藏夹',
      'action.close_tab':          '关闭这个标签',
      'action.dismiss':            '删除',
      'action.cancel':             '取消',

      'empty.title':               '标签页归零了。',
      'empty.subtitle':            '你自由了。',
      'empty.domains_zero':        '0 个域名',

      'time.just_now':             '刚刚',
      'time.min_ago':              '%s 分钟前',
      'time.hr_ago':               '%s 小时前',
      'time.hr_ago_plural':        '%s 小时前',
      'time.yesterday':            '昨天',
      'time.days_ago':             '%s 天前',

      'toast.closed_table_control_dupes': '已关闭多余的 TabCtrl 标签',
      'toast.tab_closed':          '标签已关闭',
      'toast.undo':                '撤销',
      'toast.undo_failed':         '撤销失败',
      'toast.stashed':             '已加入暂存',
      'toast.bookmarked':          '已加入收藏: %s',
      'toast.bookmark_removed':    '已移除书签',
      'toast.bookmark_moved':      '已移动书签',
      'toast.failed_bookmark':     '收藏失败',
      'toast.bookmark_reload_hint':'收藏 API 不可用——请到 chrome://extensions 重新加载 TabCtrl 后再试',
      'toast.snapshot_permission_missing': '快照需要站点访问权限——请到 chrome://extensions 重新加载 TabCtrl',

      // Bookmark dialog
      'bookmark.title':            '添加书签',
      'bookmark.bookmarked_title': '书签选项',
      'bookmark.name_label':       '名称',
      'bookmark.folder_label':     '文件夹',
      'bookmark.cancel':           '取消',
      'bookmark.save':             '保存',
      'bookmark.remove':           '移除',
      'bookmark.move':             '移动',
      'bookmark.go_to_bookmark':   '跳转到书签',
      'toast.failed_save':         '保存失败',
      'toast.closed_from_group':   '已从 %s 关闭 %s 个标签',
      'toast.closed_one_from_group': '已从 %s 关闭 1 个标签',
      'toast.dedup_done':          '已去重，每组保留一个',

      'search.no_results':         '没有结果',
      'footer.open_tabs':          '打开的标签',
      'author.x_tooltip':          '在 X 上关注 承越.Chase',

      'insights.title':            '洞察',
      'insights.closed_today':     '今日关闭',
      'insights.closed_week':      '本周关闭',
      'insights.closed_total':     '累计关闭',
      'insights.top_all':          '常关域名（总）',
      'insights.top_week':         '本周常关',
      'insights.no_closes':        '还没关过',
      'insights.no_week':          '本周没关过',
      'insights.clear':            '清空数据',
      'insights.clear_confirm':    '清空所有关闭历史？此操作不可撤销。',

      'lang.switch':               '语言',
      'lang.en':                   'EN',
      'lang.zh':                   '中',

      'settings.title':                 '设置',
      'settings.page_title':            'TabCtrl 设置',
      'settings.page_subtitle':         '配置你的新标签页仪表盘行为。所有设置即时保存。',
      'settings.back_link':             '返回仪表盘',
      'settings.back_tooltip':          '打开新标签页仪表盘',
      'settings.footer_storage':        '设置仅存储在本地浏览器中，不会上传到任何地方。',
      'settings.aggregation':           '聚合',
      'settings.display':               '显示',
      'settings.mode_full_hostname':    '完整域名',
      'settings.mode_full_hostname_hint': '每个子域独立',
      'settings.mode_main_domain':      '主域名',
      'settings.mode_main_domain_hint': '合并 *.google.com 等',
      'settings.mode_custom':           '自定义规则',
      'settings.mode_custom_hint':      '自定义 pattern → 分组',
      'settings.sub_grouping':          '按路径子聚合',
      'settings.sub_grouping_hint':     '每个 repo / 频道单独一行',
      'settings.no_rules':              '还没规则。点下方添加。',
      'settings.add_rule':              '添加规则',
      'settings.rule_pattern_placeholder': 'pattern（如 .google.com）',
      'settings.rule_key_placeholder':  'key',
      'settings.rule_label_placeholder': 'label（可选）',
      'settings.reset':                 '恢复默认',
      'settings.reset_confirm':         '确定要恢复默认设置吗？',
      'settings.language':              '语言',
      'settings.language_auto':         '自动',
      'settings.language_auto_hint':    '跟随浏览器',

      // History settings
      'settings.history':                       '历史记录',
      'settings.history_desc':                  '历史记录保存的天数可配置，默认每页显示 5 条。',
      'settings.history_retention_label':       '历史记录保留',
      'settings.history_days':                  '天',
      'settings.history_retention_hint':        '超过保留天数的记录会自动清理。范围 1–30 天。',
      'settings.history_page_size_label':       '每页显示',
      'settings.history_entries':               '条',
      'settings.history_page_size_hint':        '每页 3–20 条。页数越多，需要点击翻页的次数也越多。',

      // ===== 统一的"标签分组" section =====
      'settings.grouping':                 '标签分组',
      'settings.grouping_desc':            '决定标签页如何切分成卡片。两层：先跨域名分，再在每个域名内分。',
      'settings.grouping_level1':          '第一层 — 跨域名',
      'settings.grouping_level1_merge':    '合并子域',
      'settings.grouping_level1_merge_hint': '所有 *.google.com 合成一张卡',
      'settings.grouping_level1_merge_recommended': '推荐',
      'settings.grouping_level1_separate': '分开子域',
      'settings.grouping_level1_separate_hint': 'docs.google.com / mail.google.com 各自一张卡',
      'settings.grouping_level1_custom':   '自定义规则',
      'settings.grouping_level1_custom_hint': '自定义 pattern → 分组',
      'settings.grouping_level2':          '第二层 — 域名内',
      'settings.grouping_level2_enabled':  '按 URL 模式分组',
      'settings.grouping_level2_enabled_hint': '每个 repo / 频道 / subreddit 单独一行',
      'settings.grouping_level2_rules':    '子分组规则',
      'settings.grouping_level2_rules_desc': '首条命中规则生效。用户规则优先于内置。',
      'settings.sub_grouping_builtin':       '内置规则',
      'settings.sub_grouping_builtin_show':  '展开全部',
      'settings.sub_grouping_builtin_hide':  '收起',
      'settings.sub_grouping_user':          '自定义规则',
      'settings.sub_grouping_user_empty':    '暂无自定义规则。在下方添加，或测试一个 URL 来覆盖内置规则。',
      'settings.sub_grouping_add':           '添加自定义规则',
      'settings.sub_grouping_test':          '快速测试',
      'settings.sub_grouping_test_placeholder': '粘贴一个 URL，看命中哪条规则...',
      'settings.sub_grouping_test_result':   '子分组 key: %s',
      'settings.sub_grouping_test_matched':  '命中: %s',
      'settings.sub_grouping_test_none':     '没有规则命中 — 会回退到 \'/\'（全部归一组）。',
      'settings.sub_grouping_test_override': '覆盖该域名',
      'settings.sub_grouping_field_pattern': '域名 pattern',
      'settings.sub_grouping_field_match':   '匹配（正则）',
      'settings.sub_grouping_field_template': '输出（模板）',
      'settings.sub_grouping_pattern_hint':  '域名（如 youtube.com），* 表示兜底',
      'settings.sub_grouping_match_hint':    '对 URL path 生效的 JS 正则',
      'settings.sub_grouping_template_hint': '用 $1, $2 引用捕获组',
      'settings.sub_grouping_invalid_regex': '正则非法 — 运行时跳过该规则',
      'settings.sub_grouping_source_default': '内置',
      'settings.sub_grouping_source_user':    '自定义',
    },
  };

  /**
   * Get the user's current language preference.
   * Falls back to navigator.language on first visit.
   */
  function getLang() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && I18N[stored]) return stored;
    } catch {
      // localStorage may be unavailable (e.g. file:// in some browsers)
    }
    const nav = (navigator.language || 'en').toLowerCase();
    if (nav.startsWith('zh')) return 'zh';
    return 'en';
  }

  /**
   * Set the user's language preference and reload the page.
   * Reload is the simplest reliable way to re-render everything from scratch.
   */
  function setLang(lang) {
    if (!I18N[lang]) return;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {}
    location.reload();
  }

  /**
   * Look up a translation key. Falls back to English if missing.
   * %s placeholders are replaced in order with extra arguments.
   *
   * @param {string} key
   * @param {...(string|number)} args
   * @returns {string}
   */
  function t(key, ...args) {
    const lang = getLang();
    const dict = I18N[lang] || I18N.en;
    let str = dict[key];
    if (str === undefined) str = I18N.en[key] != null ? I18N.en[key] : key;
    if (args.length === 0) return str;
    let i = 0;
    return str.replace(/%s/g, () => (i < args.length ? String(args[i++]) : ''));
  }

  /**
   * Apply translations to all [data-i18n*] elements on the page.
   * Handles textContent, title, placeholder, and innerHTML variants.
   */
  function applyToDOM() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.setAttribute('title', t(el.dataset.i18nTitle));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
    });
    document.querySelectorAll('[data-i18n-html]').forEach((el) => {
      el.innerHTML = t(el.dataset.i18nHtml);
    });
    document.documentElement.lang = getLang() === 'zh' ? 'zh-CN' : 'en';
  }

  // Expose API globally
  window.i18n = {
    t,
    getLang,
    setLang,
    applyToDOM,
    available: Object.keys(I18N),
    /**
     * Clear the persisted language choice (used by settings reset).
     * After this, getLang() falls back to navigator.language.
     */
    clearPersistedLang() {
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
    },
  };

  // Apply static translations as soon as DOM is parsed.
  // app.js may call applyToDOM() again later after rendering dynamic content.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyToDOM);
  } else {
    applyToDOM();
  }
})();
