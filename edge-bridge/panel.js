(() => {
  'use strict';

  if (!/^post\.alibaba\.com$/i.test(location.hostname) || !/\/product\/(publish|easyListing)\.htm/i.test(location.pathname)) return;
  if (window.__alibabaDraftPanelLoaded) return;
  window.__alibabaDraftPanelLoaded = true;

  const TOKEN = 'local-alibaba-bridge-2026';
  const BASE = 'http://127.0.0.1:8765';
  const STORAGE_KEY = 'alibabaDraftPanel.v1';

  const DEFAULT_CONFIG = {
    brand: 'Worldpeak',
    origin: 'China',
    province: 'Jiangsu',
    manufacturer_batch: '2026-Q4',
    company_name: '',
    company_description: '',
    company_faqs: [],
    publish_defaults: {
      currency: 'USD',
      moq: 100,
      moq_unit: 'piece',
      price_min: 2.5,
      price_max: 3.2,
      lead_time_days: { min: 15, max: 30 },
      packaging_method: 'Poly bag + export carton',
      carton_size_cm: '',
      gross_weight_kg: ''
    }
  };

  const state = {
    draft: null,
    config: clone(DEFAULT_CONFIG),
    rows: [],
    filter: 'all',
    onlyEmpty: true,
    highlight: true,
    busy: false,
    bridgeOnline: null,
    imageUploads: new Set(),
    imageBusy: false,
    imageInfo: { scanned: false, count: 0, hashes: [], placeholder: false, max: 6 },
    companyImagePlan: null,
    companyImageBusy: false
  };

  const highlightSaved = new Map();
  let shadow = null;
  let toastTimer = null;

  const HTML = `
  <style>
    :host { all: initial; }
    * { box-sizing: border-box; }
    .panel {
      width: 480px; max-height: calc(100vh - 24px); display: flex; flex-direction: column;
      background: #fff; color: #1f2937; border: 1px solid #d1d5db; border-radius: 10px;
      box-shadow: 0 12px 32px rgba(15, 23, 42, .22);
      font: 12.5px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      overflow: hidden;
    }
    .panel.collapsed { width: 240px; }
    .head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: #111827; color: #fff; }
    .head .title { font-weight: 700; font-size: 13px; }
    .ver { font-weight: 400; opacity: .6; font-size: 11px; }
    .head-actions { display: flex; align-items: center; gap: 8px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #6b7280; }
    .dot.on { background: #22c55e; box-shadow: 0 0 0 3px rgba(34, 197, 94, .2); }
    .dot.off { background: #ef4444; }
    .icon { background: transparent; border: 0; color: #fff; font-size: 16px; cursor: pointer; padding: 0 4px; }
    .body { padding: 10px; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
    .panel.collapsed .body { display: none; }
    .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 9px 10px; background: #fff; }
    .label { font-weight: 700; font-size: 12px; color: #111827; }
    .muted { color: #6b7280; }
    .small { font-size: 11px; }
    .row { display: flex; align-items: center; }
    .row.gap { gap: 8px; margin-top: 8px; flex-wrap: wrap; }
    .row.between { justify-content: space-between; }
    .btn { border: 1px solid #d1d5db; background: #fff; color: #111827; border-radius: 6px; padding: 5px 9px; font-size: 12px; cursor: pointer; }
    .btn:hover { background: #f9fafb; }
    .btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
    .btn.primary:hover { background: #1d4ed8; }
    .btn:disabled { opacity: .5; cursor: not-allowed; }
    .link { border: 0; background: none; color: #2563eb; cursor: pointer; font-size: 11.5px; padding: 0; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 8px; margin-top: 8px; }
    .grid2 label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: #4b5563; }
    .grid2 input { border: 1px solid #d1d5db; border-radius: 5px; padding: 4px 6px; font-size: 12px; width: 100%; }
    .cfg-wide { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; font-size: 11px; color: #4b5563; }
    .cfg-wide textarea, .faq-row input, .faq-row textarea { border: 1px solid #d1d5db; border-radius: 5px; padding: 4px 6px; font: inherit; font-size: 12px; width: 100%; }
    .cfg-wide textarea, .faq-row textarea { resize: vertical; }
    .faq-config { margin-top: 8px; border-top: 1px solid #eef0f2; padding-top: 7px; }
    .faq-row { border: 1px solid #eef0f2; border-radius: 6px; padding: 6px; margin-top: 6px; display: flex; flex-direction: column; gap: 4px; }
    .faq-top { display: flex; align-items: center; justify-content: space-between; }
    .faq-top .btn { padding: 2px 6px; font-size: 11px; }
    .chips { display: flex; gap: 6px; margin: 7px 0 6px; }
    .chip { border: 1px solid #d1d5db; background: #fff; border-radius: 999px; padding: 2px 8px; font-size: 11px; cursor: pointer; }
    .chip.active { background: #111827; color: #fff; border-color: #111827; }
    .table-wrap { max-height: 280px; overflow: auto; border: 1px solid #e5e7eb; border-radius: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { padding: 4px 5px; border-bottom: 1px solid #eef0f2; text-align: left; vertical-align: top; }
    th { position: sticky; top: 0; background: #f9fafb; z-index: 1; font-weight: 600; color: #4b5563; }
    td.fname { font-weight: 600; }
    td .src { font-weight: 400; color: #9ca3af; font-size: 10px; }
    td.val { color: #374151; word-break: break-word; }
    .badge { display: inline-block; padding: 1px 5px; border-radius: 999px; font-size: 10px; white-space: nowrap; }
    .badge.empty { background: #fef3c7; color: #92400e; }
    .badge.same { background: #dcfce7; color: #166534; }
    .badge.conflict { background: #fee2e2; color: #991b1b; }
    .badge.unmatched, .badge.missing_row, .badge.missing_faq { background: #ede9fe; color: #5b21b6; }
    .badge.readonly { background: #e5e7eb; color: #374151; }
    .badge.no_value, .badge.skip { background: #f3f4f6; color: #6b7280; }
    .badge.too_long { background: #fee2e2; color: #991b1b; }
    .badge.present { background: #dcfce7; color: #166534; }
    .badge.uploaded { background: #dbeafe; color: #1e40af; }
    .badge.pending { background: #fef3c7; color: #92400e; }
    .check { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #374151; }
    .images { margin: 5px 0 0; padding-left: 16px; color: #374151; max-height: 190px; overflow: auto; }
    .images li { margin: 3px 0; }
    .img-badge { margin-left: 4px; }
    .foot { text-align: center; color: #6b7280; font-size: 10.5px; padding: 2px 0 4px; }
    details summary { cursor: pointer; font-weight: 700; font-size: 12px; color: #111827; }
    .toast { display: none; background: #111827; color: #fff; padding: 6px 9px; border-radius: 6px; font-size: 11.5px; }
    .toast.show { display: block; }
  </style>
  <div class="panel" id="panel">
    <div class="head">
      <div class="title">发品助手 <span class="ver">v0.7</span></div>
      <div class="head-actions">
        <span class="dot" id="bridgeDot" title="本地桥接状态"></span>
        <button class="icon" id="collapseBtn" title="收起">—</button>
      </div>
    </div>
    <div class="body" id="body">
      <div class="toast" id="toast"></div>

      <div class="card">
        <div class="row between">
          <div class="label">产品草稿</div>
          <button class="link" id="loadDraftBtn">从本地载入</button>
        </div>
        <div id="draftMeta" class="muted small">未载入草稿</div>
        <div id="bridgeState" class="muted small"></div>
        <div class="row gap">
          <button class="btn" id="importBtn">导入 JSON</button>
          <button class="btn primary" id="refreshBtn">读取页面并对比</button>
        </div>
        <input id="fileInput" type="file" accept=".json,application/json" hidden>
      </div>

      <details class="card" id="configBox">
        <summary>公司配置（默认已填参考页信息）</summary>
        <div class="grid2">
          <label>品牌<input id="cfgBrand"></label>
          <label>原产地<input id="cfgOrigin"></label>
          <label>省份<input id="cfgProvince"></label>
          <label>生产批次<input id="cfgBatch"></label>
          <label>公司名<input id="cfgCompany"></label>
          <label>MOQ<input id="cfgMoq" type="number"></label>
          <label>最低价<input id="cfgPriceMin" type="number" step="0.01"></label>
          <label>最高价<input id="cfgPriceMax" type="number" step="0.01"></label>
          <label>交期(天)<input id="cfgLeadMin" type="number"></label>
          <label>到<input id="cfgLeadMax" type="number"></label>
          <label>包装<input id="cfgPackaging"></label>
          <label>毛重(kg)<input id="cfgWeight"></label>
        </div>
        <label class="cfg-wide">公司介绍（英文，≤2000 字符）<textarea id="cfgCompanyDesc" rows="5" maxlength="2000"></textarea></label>
        <div class="faq-config">
          <div class="row between">
            <span class="label">公司 FAQ</span>
            <button class="btn" id="addFaqBtn">添加 FAQ</button>
          </div>
          <div id="cfgFaqList"></div>
        </div>
        <div class="row gap">
          <button class="btn" id="saveConfigBtn">保存配置</button>
          <span class="muted small">只保存在本机</span>
        </div>
      </details>

      <div class="card">
        <div class="row between">
          <div class="label">页面差异</div>
          <div class="muted small" id="diffSummary">尚未读取</div>
        </div>
        <div class="chips" id="filterChips">
          <button class="chip active" data-filter="all">全部</button>
          <button class="chip" data-filter="empty">空白</button>
          <button class="chip" data-filter="conflict">冲突</button>
          <button class="chip" data-filter="unmatched">未匹配</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th></th><th>字段</th><th>草稿值</th><th>页面值</th><th>状态</th></tr></thead>
            <tbody id="diffBody"></tbody>
          </table>
        </div>
        <div class="row gap">
          <label class="check"><input type="checkbox" id="onlyEmpty" checked> 只填空白字段</label>
          <label class="check"><input type="checkbox" id="highlightChk" checked> 高亮页面</label>
        </div>
        <div class="row gap">
          <button class="btn primary" id="fillBtn" disabled>填充选中项 (0)</button>
          <button class="btn" id="clearHighlightBtn">清除高亮</button>
        </div>
        <div id="fillResult" class="muted small"></div>
      </div>

      <div class="card">
        <div class="label">商品描述</div>
        <div class="muted small">富文本编辑器需要手动粘贴，v1 不自动写入。</div>
        <div class="row gap">
          <button class="btn" id="copyHtmlBtn">复制 HTML</button>
          <button class="btn" id="copyTextBtn">复制纯文本</button>
        </div>
      </div>

      <div class="card">
        <div class="row between">
          <div class="label">商品图片</div>
          <div class="muted small" id="imageSummary">尚未扫描</div>
        </div>
        <ol id="imageList" class="images"><li class="muted">未载入草稿</li></ol>
        <div class="row gap">
          <button class="btn" id="scanImagesBtn">扫描页面</button>
          <button class="btn primary" id="uploadImagesBtn" disabled>上传缺失图片</button>
        </div>
        <div id="imageResult" class="muted small"></div>
      </div>

      <div class="foot">不会点击保存或发布。请人工检查后手动提交。</div>
    </div>
  </div>`;

  function $(sel) {
    return shadow ? shadow.querySelector(sel) : null;
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function mergeConfig(base, extra) {
    const out = clone(base);
    if (!extra || typeof extra !== 'object') return out;
    for (const [key, value] of Object.entries(extra)) {
      if (value && typeof value === 'object' && !Array.isArray(value) && out[key] && typeof out[key] === 'object') {
        out[key] = mergeConfig(out[key], value);
      } else if (value !== undefined) {
        out[key] = value;
      }
    }
    return out;
  }

  function normalizeFaqs(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map(item => ({
        question: String((item && item.question) || '').trim(),
        answer: String((item && item.answer) || '').trim()
      }))
      .filter(item => item.question || item.answer)
      .slice(0, 8);
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function cut(value, max) {
    const text = String(value == null ? '' : value);
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
  }

  function norm(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function sameValue(a, b) {
    const na = norm(a);
    const nb = norm(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    const numeric = /^-?\d+(\.\d+)?$/;
    if (numeric.test(na) && numeric.test(nb)) return Number(na) === Number(nb);
    return na.replace(/\s*\/\s*/g, '/') === nb.replace(/\s*\/\s*/g, '/');
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function ensureCompanyEditors() {
    if (companySectionLoaded() && faqQuestions().length) return true;
    try {
      await runtimeSendMessage({ type: 'alibaba_mount_company_editors' }, 8000);
    } catch (error) {}
    for (let attempt = 0; attempt < 12; attempt++) {
      if (companySectionLoaded()) return true;
      await sleep(120);
    }
    return companySectionLoaded();
  }

  function companySectionLoaded() {
    return !!document.querySelector('#struct-companyDesc textarea');
  }

  function firstVisible(selector) {
    const list = Array.from(document.querySelectorAll(selector));
    return list.find(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }) || list[0] || null;
  }

  function attrRows() {
    return Array.from(document.querySelectorAll('.posting-field-more-attrs .item'))
      .filter(item => item.querySelector('.attr-title input'));
  }

  function findAttrRow(name) {
    const target = norm(name);
    for (const item of document.querySelectorAll('.posting-field-more-attrs .item')) {
      const titleEl = item.querySelector('.attr-title input') || item.querySelector('.attr-title');
      const title = titleEl ? (titleEl.value || titleEl.textContent || '') : '';
      if (norm(title) === target) return item;
    }
    return null;
  }

  function attrValueInput(item) {
    if (!item) return null;
    return item.querySelector('.attr-value input, .attr-value textarea, .attr-value [contenteditable="true"]');
  }

  function faqBox() {
    return document.querySelector('#struct-companyFaqDesc');
  }

  function faqQuestions() {
    const box = faqBox();
    return box ? Array.from(box.querySelectorAll('input[placeholder="请输入问题"]')) : [];
  }

  function faqAnswers() {
    const box = faqBox();
    return box ? Array.from(box.querySelectorAll('textarea[placeholder="请输入回答"]')) : [];
  }

  function faqControl(row) {
    const list = row.faqField === 'question' ? faqQuestions() : faqAnswers();
    return list[row.faqIndex] || null;
  }

  function resolveValue(raw) {
    if (raw == null) return { value: '', unresolved: false };
    let unresolved = false;
    const value = String(raw).replace(/\{\{\s*company\.([a-zA-Z_]+)\s*\}\}/g, (_, key) => {
      const map = {
        brand: state.config.brand,
        origin: state.config.origin,
        province: state.config.province,
        manufacturer_batch: state.config.manufacturer_batch,
        name: state.config.company_name,
        company_name: state.config.company_name
      };
      const resolved = map[key];
      if (resolved == null || String(resolved).trim() === '') {
        unresolved = true;
        return '';
      }
      return String(resolved);
    });
    return { value, unresolved };
  }

  function buildRows() {
    if (!state.draft) {
      state.rows = [];
      return;
    }
    const draft = state.draft;
    const attrs = draft.attributes || {};
    const cfg = state.config;
    const defaults = cfg.publish_defaults || {};
    const rows = [];

    const add = def => {
      const resolved = resolveValue(def.value);
      rows.push({
        ...def,
        value: resolved.value,
        unresolved: resolved.unresolved,
        matched: false,
        current: '',
        el: null,
        status: undefined,
        selected: undefined,
        selectable: false
      });
    };

    add({ id: 'title', group: '基本信息', label: '商品名称', selector: 'input#productTitle', value: draft.title, maxLength: 128 });
    add({ id: 'model', group: '基本信息', label: '型号', selector: '#struct-p-3 input', value: attrs['Model Number'] });
    add({ id: 'type', group: '基本信息', label: '种类', selector: '#struct-p-191284008 input', value: attrs['Type'] });
    add({ id: 'origin', group: '基本信息', label: '原产地', selector: '#struct-p-1 input', value: cfg.origin });
    add({ id: 'province', group: '基本信息', label: '省份', selector: '#struct-p-1-1', value: cfg.province, readOnly: true });
    add({ id: 'brand', group: '基本信息', label: '品牌（1）', selector: '#struct-p-2 input', value: cfg.brand });
    add({ id: 'brand2', group: '基本信息', label: '品牌（2）', selector: '#struct-p-210192652 input', value: '', skip: true, note: '同名字段，v1 不自动填写' });
    add({ id: 'packing', group: '基本信息', label: '包装', selector: '#struct-p-210188265 input', value: attrs['Packing'] || draft.packaging?.method });
    add({ id: 'product_name', group: '基本信息', label: '品名', selector: '#struct-p-133600302 input', value: attrs['Product Name'] });
    add({ id: 'batch', group: '基本信息', label: '生产批次', selector: '#struct-p-100008467 input', value: cfg.manufacturer_batch });
    add({ id: 'moq', group: '交易信息', label: '最小起订量', selector: 'input#minOrderQuantity', value: draft.moq?.value ?? defaults.moq });
    add({ id: 'price_min', group: '交易信息', label: '最低价', selector: 'input[placeholder="请输入最低价"]', value: draft.price?.reference_range?.min ?? defaults.price_min });
    add({ id: 'price_max', group: '交易信息', label: '最高价', selector: 'input[placeholder="请输入最高价"]', value: draft.price?.reference_range?.max ?? defaults.price_max });
    add({ id: 'gross_weight', group: '物流信息', label: '毛重 (KG/Piece)', selector: 'input#pkgWeight', value: draft.packaging?.weight || defaults.gross_weight_kg });

    add({ id: 'company_desc', group: '公司信息', label: '公司介绍', selector: '#struct-companyDesc textarea', value: cfg.company_description, maxLength: 2000 });
    normalizeFaqs(cfg.company_faqs).forEach((faq, index) => {
      add({ id: 'faq_q_' + index, group: '公司信息', label: 'FAQ Q' + (index + 1), kind: 'faq', faqIndex: index, faqField: 'question', value: faq.question, maxLength: 150 });
      add({ id: 'faq_a_' + index, group: '公司信息', label: 'FAQ A' + (index + 1), kind: 'faq', faqIndex: index, faqField: 'answer', value: faq.answer, maxLength: 500 });
    });

    Object.entries(draft.custom_attributes || {}).forEach(([name, value]) => {
      add({ id: 'attr:' + name, group: '自定义属性', label: name, kind: 'attr', attrName: name, value });
    });

    state.rows = rows;
  }

  function readRow(row) {
    if (row.kind === 'faq') {
      const input = faqControl(row);
      row.el = input;
      row.matched = !!input;
      row.current = input ? (input.value == null ? '' : input.value) : '';
      return;
    }
    if (row.kind === 'attr') {
      if (!row.item || !document.contains(row.item)) row.item = findAttrRow(row.attrName);
      const input = attrValueInput(row.item);
      row.el = input;
      row.matched = !!input;
      if (!input) {
        row.current = '';
      } else if (input.isContentEditable) {
        row.current = input.textContent || '';
      } else {
        row.current = input.value == null ? '' : input.value;
      }
      return;
    }
    const el = firstVisible(row.selector);
    row.el = el;
    row.matched = !!el;
    if (!el) {
      row.current = '';
    } else if (el.matches('input, textarea, select')) {
      row.current = el.value == null ? '' : el.value;
    } else {
      row.current = el.textContent || '';
    }
  }

  function computeStatus(row) {
    if (row.skip || !row.id) return 'skip';
    if (row.unresolved) return 'no_value';
    if (row.value == null || String(row.value).trim() === '') return 'no_value';
    if (row.maxLength && String(row.value).length > row.maxLength) return 'too_long';
    if (!row.matched) {
      if (row.kind === 'attr') return 'missing_row';
      if (row.kind === 'faq') return 'missing_faq';
      return 'unmatched';
    }
    if (row.readOnly) return 'readonly';
    if (!String(row.current || '').trim()) return 'empty';
    if (sameValue(row.value, row.current)) return 'same';
    return 'conflict';
  }

  function refreshRows() {
    for (const row of state.rows) {
      const previous = row.status;
      readRow(row);
      row.status = computeStatus(row);
      const creatable = (row.kind === 'attr' && row.status === 'missing_row')
        || (row.kind === 'faq' && row.status === 'missing_faq');
      row.selectable = row.status === 'empty' || (!state.onlyEmpty && row.status === 'conflict') || creatable;
      if (row.selected === undefined || previous !== row.status) {
        row.selected = row.selectable;
      }
      if (!row.selectable) row.selected = false;
    }
  }

  let autoRefreshToken = 0;

  function autoRefreshUntilReady() {
    const token = ++autoRefreshToken;
    const delays = [500, 1200, 2400, 4000, 6500];
    const step = attempt => {
      if (attempt >= delays.length) return;
      setTimeout(async () => {
        if (token !== autoRefreshToken || !state.draft) return;
        await ensureCompanyEditors();
        const before = state.rows.filter(row => row.matched).length;
        refreshRows();
        renderAll();
        const after = state.rows.filter(row => row.matched).length;
        const companyExpected = state.rows.some(row => row.id === 'company_desc' || row.kind === 'faq');
        const companyLoaded = !companyExpected || companySectionLoaded();
        if (after === 0 || after > before || !companyLoaded) step(attempt + 1);
      }, delays[attempt]);
    };
    step(0);
  }

  function statusLabel(status) {
    return {
      empty: '可填',
      same: '一致',
      conflict: '冲突',
      unmatched: '未匹配',
      missing_row: '无属性行',
      missing_faq: '无FAQ行',
      readonly: '只读',
      no_value: '草稿缺值',
      skip: '跳过',
      too_long: '超长'
    }[status] || status;
  }

  function renderTable() {
    const body = $('#diffBody');
    if (!body) return;
    let rows = state.rows;
    if (state.filter === 'empty') rows = rows.filter(row => row.status === 'empty');
    else if (state.filter === 'conflict') rows = rows.filter(row => row.status === 'conflict');
    else if (state.filter === 'unmatched') rows = rows.filter(row => row.status === 'unmatched' || row.status === 'missing_row' || row.status === 'missing_faq');

    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="5" class="muted">没有符合条件的字段</td></tr>';
    } else {
      body.innerHTML = rows.map(row => {
        const index = state.rows.indexOf(row);
        const title = row.note ? `${row.label}（${row.note}）` : row.label;
        return `<tr>
          <td><input type="checkbox" data-idx="${index}" ${row.selected ? 'checked' : ''} ${row.selectable ? '' : 'disabled'}></td>
          <td class="fname">${esc(title)}<div class="src">${esc(row.group || '')}</div></td>
          <td class="val" title="${esc(row.value)}">${esc(cut(row.value, 34))}</td>
          <td class="val" title="${esc(row.current)}">${esc(cut(row.current, 26))}</td>
          <td><span class="badge ${row.status}">${esc(statusLabel(row.status))}</span></td>
        </tr>`;
      }).join('');
    }

    shadow.querySelectorAll('#diffBody input[type="checkbox"]').forEach(box => {
      box.addEventListener('change', () => {
        const row = state.rows[Number(box.dataset.idx)];
        if (row) {
          row.selected = box.checked;
          updateFillButton();
        }
      });
    });

    const counts = { empty: 0, same: 0, conflict: 0, unmatched: 0, no_value: 0, readonly: 0, skip: 0 };
    for (const row of state.rows) {
      if (row.status === 'missing_row' || row.status === 'missing_faq') counts.unmatched++;
      else if (counts[row.status] !== undefined) counts[row.status]++;
    }
    $('#diffSummary').textContent = `可填 ${counts.empty} · 一致 ${counts.same} · 冲突 ${counts.conflict} · 未匹配 ${counts.unmatched} · 缺值 ${counts.no_value}`;
  }

  function updateFillButton() {
    const button = $('#fillBtn');
    if (!button) return;
    const count = state.rows.filter(row => row.selected && row.selectable).length;
    button.textContent = `填充选中项 (${count})`;
    button.disabled = state.busy || count === 0;
  }

  function renderDraftMeta() {
    const meta = $('#draftMeta');
    if (!meta) return;
    if (!state.draft) {
      meta.textContent = '未载入草稿';
      return;
    }
    const draft = state.draft;
    const keywords = (draft.keywords || []).length;
    const images = (draft.images || []).length;
    const missing = (draft.missing || []).length;
    meta.innerHTML = `<div style="font-weight:600;color:#111827">${esc(cut(draft.title || '(无标题)', 62))}</div>
      <div class="muted small">${(draft.title || '').length}/128 字符 · ${keywords} 关键词 · ${images} 张图 · ${missing} 项待确认</div>`;
  }

  function imageName(image) {
    return String((image && image.file) || '').split('/').pop();
  }

  function imageKey(image) {
    return imageName(image).replace(/\.[^.]+$/, '').toLowerCase();
  }

  function pushImageToken(tokens, raw) {
    let text = String(raw == null ? '' : raw).trim();
    if (!text) return;
    text = text.split('/').pop() || '';
    try { text = decodeURIComponent(text); } catch (error) {}
    text = text.replace(/_\d+x\d+(\.[a-z0-9]+)?$/i, '').replace(/\.(jpe?g|png|webp)$/i, '');
    if (text) tokens.push(text.toLowerCase());
  }

  function scanPageImages() {
    const items = Array.from(document.querySelectorAll('.image-upload-list li.image-upload-list-item'));
    const tokens = [];
    for (const item of items) {
      const nameEl = item.querySelector('.image-fileName');
      if (nameEl) pushImageToken(tokens, nameEl.getAttribute('title') || nameEl.textContent);
      const el = item.querySelector('.image-upload-list-item-thumbnail div') || item.querySelector('[style*="background-image"]');
      const background = el ? getComputedStyle(el).backgroundImage : '';
      const match = background.match(/url\(["']?([^"')]+)["']?\)/);
      if (match) pushImageToken(tokens, match[1]);
    }
    state.imageInfo = {
      scanned: true,
      count: items.length,
      hashes: [...new Set(tokens)],
      placeholder: !!document.querySelector('#image-placeholder'),
      max: 6
    };
    return state.imageInfo;
  }

  function renderImages() {
    const list = $('#imageList');
    if (!list) return;
    const info = scanPageImages();
    const images = (state.draft && state.draft.images) || [];
    const hashes = new Set(info.hashes);
    let present = 0;
    let pending = 0;
    const rows = images.map(image => {
      const name = imageName(image);
      const key = imageKey(image);
      const onPage = hashes.has(key);
      const uploaded = state.imageUploads.has(key);
      if (onPage || uploaded) present++;
      else pending++;
      const badge = onPage
        ? '<span class="badge present img-badge">已存在</span>'
        : uploaded
          ? '<span class="badge uploaded img-badge">本次已上传</span>'
          : '<span class="badge pending img-badge">待上传</span>';
      return `<li><strong>${esc(image.order || '')}. ${esc(image.role || '')}</strong>${badge} — ${esc(name)}<br><span class="muted small">${esc(image.note || '')}</span></li>`;
    });
    list.innerHTML = rows.length ? rows.join('') : '<li class="muted">草稿中没有图片信息</li>';

    const summary = $('#imageSummary');
    if (summary) {
      const slots = Math.max(0, info.max - info.count);
      summary.textContent = `页面 ${info.count}/${info.max} 张 · 已有 ${present} · 待上传 ${pending}${info.placeholder ? ` · 剩余 ${slots} 位` : ' · 上传位已满'}`;
    }
    const button = $('#uploadImagesBtn');
    if (button) {
      button.disabled = state.imageBusy || pending === 0 || !info.placeholder || !info.scanned;
      button.textContent = state.imageBusy ? '上传中…' : `上传缺失图片 (${pending})`;
    }
  }

  async function uploadMissingImages() {
    if (state.imageBusy || !state.draft) return;
    const info = scanPageImages();
    const hashes = new Set(info.hashes);
    const missing = (state.draft.images || []).filter(image => {
      const key = imageKey(image);
      return !hashes.has(key) && !state.imageUploads.has(key);
    });
    if (!missing.length) {
      toast('页面已有全部草稿图片');
      renderImages();
      return;
    }
    const panelHost = document.getElementById('alibaba-draft-panel-host');
    if (panelHost) panelHost.style.pointerEvents = 'none';
    state.imageBusy = true;
    renderImages();
    const resultEl = $('#imageResult');
    if (resultEl) resultEl.textContent = `正在上传 ${missing.length} 张图片，请勿刷新页面…`;
    try {
      const result = await runtimeSendMessage({
        type: 'alibaba_upload_images',
        names: missing.map(imageName)
      }, 300000);
      for (const item of (result.uploaded || [])) {
        state.imageUploads.add(String(item.name).replace(/\.[^.]+$/, '').toLowerCase());
      }
      const uploaded = (result.uploaded || []).length;
      const skipped = (result.skipped || []).length;
      const failed = result.failed || [];
      if (resultEl) {
        resultEl.textContent = `上传成功 ${uploaded} 张${skipped ? `，页面已存在 ${skipped} 张` : ''}${failed.length ? `，失败 ${failed.length} 张：${failed.map(item => `${item.name}（${item.error}）`).join('、')}` : ''}。未保存，请人工检查。`;
      }
      toast(uploaded ? `已上传 ${uploaded} 张，未保存` : '没有上传成功');
    } catch (error) {
      if (resultEl) resultEl.textContent = `上传失败：${error.message}`;
      toast('图片上传失败');
    } finally {
      state.imageBusy = false;
      if (panelHost) panelHost.style.pointerEvents = '';
      renderImages();
    }
  }

  async function loadCompanyImagePlan() {
    try {
      const plan = await bridgeFetch('/company-image-upload-plan', {}, 5000);
      state.companyImagePlan = plan && Array.isArray(plan.images) ? plan : { albums: [], images: [] };
    } catch (error) {
      state.companyImagePlan = null;
    }
    renderCompanyImages();
    return state.companyImagePlan;
  }

  function companyPageCounts() {
    const counts = {};
    document.querySelectorAll('#companyImage .gallery-item-container').forEach(item => {
      const nameEl = item.querySelector('.gallery-item-header-cn-name');
      const name = nameEl ? String(nameEl.textContent || '').trim() : '';
      if (name) counts[name] = item.querySelectorAll('.gallery-item-images img:not(.upload-style-item-icon)').length;
    });
    return counts;
  }

  function renderCompanyImages() {
    const list = $('#companyImageList');
    const summary = $('#companyImageSummary');
    const button = $('#uploadCompanyImagesBtn');
    const plan = state.companyImagePlan;
    const albums = (plan && Array.isArray(plan.albums)) ? plan.albums : [];
    const total = (plan && Array.isArray(plan.images)) ? plan.images.length : 0;
    const pageCounts = companyPageCounts();
    if (list) {
      list.innerHTML = albums.length
        ? albums.map(album => {
          const current = pageCounts[album.album] || 0;
          const done = current >= album.count;
          return `<li><strong>${esc(album.album)}</strong> — 计划 ${album.count} · 页面 ${current} <span class="badge ${done ? 'present' : 'pending'}">${done ? '已齐' : (current ? '待补齐' : '待上传')}</span></li>`;
        }).join('')
        : '<li class="muted">没有配置公司图集</li>';
    }
    if (summary) summary.textContent = plan ? `${albums.length} 个图集 · ${total} 张图` : '读取失败';
    if (button) {
      button.disabled = state.companyImageBusy || total === 0;
      button.textContent = state.companyImageBusy ? '上传中…' : '上传公司图集';
    }
  }

  async function uploadCompanyImages() {
    if (state.companyImageBusy) return;
    state.companyImageBusy = true;
    renderCompanyImages();
    const resultEl = $('#companyImageResult');
    if (resultEl) resultEl.textContent = '正在按图集上传，请勿刷新页面…';
    try {
      const result = await runtimeSendMessage({ type: 'alibaba_upload_company_images' }, 600000);
      const uploaded = (result.uploaded || []).length;
      const failed = result.failed || [];
      const skipped = result.skipped || [];
      const parts = [`上传成功 ${uploaded} 张`];
      if (skipped.length) parts.push(`跳过 ${skipped.length} 个已齐图集`);
      if (failed.length) {
        parts.push(`失败 ${failed.length} 项：${failed.map(item => `${item.album || ''}${item.name ? ' / ' + item.name : ''}（${item.error}）`).join('、')}`);
      }
      if (resultEl) resultEl.textContent = `${parts.join('，')}。未保存，请人工检查。`;
      toast(uploaded ? `公司图集已上传 ${uploaded} 张` : '没有上传成功');
    } catch (error) {
      if (resultEl) resultEl.textContent = `上传失败：${error.message}`;
      toast('公司图集上传失败');
    } finally {
      state.companyImageBusy = false;
      renderCompanyImages();
    }
  }

  function faqRowHtml(faq, index) {
    return `<div class="faq-row" data-index="${index}">
      <div class="faq-top"><span class="muted small">Q${index + 1}</span><button type="button" class="btn faq-del" data-index="${index}">删除</button></div>
      <input class="faq-q" maxlength="150" placeholder="问题" value="${esc(faq.question)}">
      <textarea class="faq-a" maxlength="500" rows="3" placeholder="回答">${esc(faq.answer)}</textarea>
    </div>`;
  }

  function renderFaqInputs() {
    const list = $('#cfgFaqList');
    if (!list) return;
    const faqs = normalizeFaqs(state.config.company_faqs);
    list.innerHTML = (faqs.length ? faqs : [{ question: '', answer: '' }]).map(faqRowHtml).join('');
  }

  function readFaqInputs() {
    return Array.from(shadow.querySelectorAll('#cfgFaqList .faq-row')).map(row => {
      const question = row.querySelector('.faq-q');
      const answer = row.querySelector('.faq-a');
      return {
        question: question ? question.value.trim() : '',
        answer: answer ? answer.value.trim() : ''
      };
    }).filter(item => item.question || item.answer).slice(0, 8);
  }

  function renderConfigInputs() {
    const cfg = state.config;
    const defaults = cfg.publish_defaults || {};
    $('#cfgBrand').value = cfg.brand || '';
    $('#cfgOrigin').value = cfg.origin || '';
    $('#cfgProvince').value = cfg.province || '';
    $('#cfgBatch').value = cfg.manufacturer_batch || '';
    $('#cfgCompany').value = cfg.company_name || '';
    $('#cfgMoq').value = defaults.moq == null ? '' : defaults.moq;
    $('#cfgPriceMin').value = defaults.price_min == null ? '' : defaults.price_min;
    $('#cfgPriceMax').value = defaults.price_max == null ? '' : defaults.price_max;
    $('#cfgLeadMin').value = defaults.lead_time_days?.min == null ? '' : defaults.lead_time_days.min;
    $('#cfgLeadMax').value = defaults.lead_time_days?.max == null ? '' : defaults.lead_time_days.max;
    $('#cfgPackaging').value = defaults.packaging_method || '';
    $('#cfgWeight').value = defaults.gross_weight_kg == null ? '' : defaults.gross_weight_kg;
    $('#cfgCompanyDesc').value = cfg.company_description || '';
    renderFaqInputs();
  }

  function numberOrBlank(input) {
    const value = String(input.value || '').trim();
    return value === '' ? '' : Number(value);
  }

  function readConfigInputs() {
    const defaults = state.config.publish_defaults || {};
    state.config = mergeConfig(state.config, {
      brand: $('#cfgBrand').value.trim(),
      origin: $('#cfgOrigin').value.trim(),
      province: $('#cfgProvince').value.trim(),
      manufacturer_batch: $('#cfgBatch').value.trim(),
      company_name: $('#cfgCompany').value.trim(),
      company_description: $('#cfgCompanyDesc').value.trim(),
      company_faqs: readFaqInputs(),
      publish_defaults: {
        moq: numberOrBlank($('#cfgMoq')),
        price_min: numberOrBlank($('#cfgPriceMin')),
        price_max: numberOrBlank($('#cfgPriceMax')),
        lead_time_days: {
          min: numberOrBlank($('#cfgLeadMin')),
          max: numberOrBlank($('#cfgLeadMax'))
        },
        packaging_method: $('#cfgPackaging').value.trim(),
        gross_weight_kg: $('#cfgWeight').value.trim()
      }
    });
    state.config.publish_defaults = mergeConfig(defaults, state.config.publish_defaults);
  }

  function renderAll() {
    renderDraftMeta();
    renderTable();
    renderImages();
    updateFillButton();
    if (state.highlight) applyHighlights();
    else clearHighlights();
  }

  function applyHighlights() {
    clearHighlights();
    if (!state.highlight) return;
    for (const row of state.rows) {
      if (!row.el || !document.contains(row.el)) continue;
      const color = row.status === 'empty' ? '#f59e0b'
        : row.status === 'conflict' ? '#ef4444'
        : row.status === 'unmatched' || row.status === 'missing_row' || row.status === 'missing_faq' ? '#8b5cf6'
        : null;
      if (!color) continue;
      highlightSaved.set(row.el, {
        outline: row.el.style.outline,
        outlineOffset: row.el.style.outlineOffset,
        boxShadow: row.el.style.boxShadow
      });
      row.el.style.outline = `2px solid ${color}`;
      row.el.style.outlineOffset = '1px';
      row.el.style.boxShadow = `0 0 0 3px ${color}33`;
    }
  }

  function clearHighlights() {
    for (const [el, previous] of highlightSaved) {
      el.style.outline = previous.outline;
      el.style.outlineOffset = previous.outlineOffset;
      el.style.boxShadow = previous.boxShadow;
    }
    highlightSaved.clear();
  }

  function setNativeValue(el, value) {
    if (!el) throw new Error('element not found');
    if (el.isContentEditable) {
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const tag = el.tagName;
    const proto = tag === 'TEXTAREA' ? HTMLTextAreaElement.prototype
      : tag === 'SELECT' ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }

  async function ensureAttrRows(names) {
    const missing = [...new Set(names)].filter(name => !findAttrRow(name));
    const emptyCount = attrRows().filter(item => {
      const input = item.querySelector('.attr-title input');
      return !String(input ? input.value : '').trim();
    }).length;
    const toAdd = Math.max(0, missing.length - emptyCount);
    for (let i = 0; i < toAdd; i++) {
      const button = document.querySelector('.posting-field-more-attrs .add-attr-btn');
      if (!button) return;
      const before = attrRows().length;
      button.click();
      let added = false;
      for (let attempt = 0; attempt < 25; attempt++) {
        await sleep(100);
        if (attrRows().length > before) {
          added = true;
          break;
        }
      }
      if (!added) return;
    }
  }

  async function ensureFaqRows(needed) {
    let count = faqQuestions().length;
    let guard = 0;
    while (count < needed && guard < 8) {
      const add = document.querySelector('#struct-companyFaqDesc .add-items');
      if (!add) return;
      add.click();
      let next = count;
      for (let attempt = 0; attempt < 25; attempt++) {
        await sleep(100);
        next = faqQuestions().length;
        if (next > count) break;
      }
      if (next <= count) return;
      count = next;
      guard++;
    }
  }

  async function fillGenericRow(row) {
    let el = firstVisible(row.selector);
    if (!el) throw new Error('element not found');
    setNativeValue(el, String(row.value));
    await sleep(220);
    el = firstVisible(row.selector);
    row.el = el;
    row.current = el ? (el.matches('input, textarea, select') ? el.value : el.textContent) : '';
    return !!el && sameValue(row.value, row.current);
  }

  async function fillAttrRow(row, emptyRows) {
    let item = findAttrRow(row.attrName);
    if (!item && emptyRows.length) item = emptyRows.shift();
    if (!item) throw new Error('no attr row');
    const titleInput = item.querySelector('.attr-title input');
    if (!titleInput) throw new Error('no attr title input');
    if (norm(titleInput.value) !== norm(row.attrName)) {
      setNativeValue(titleInput, row.attrName);
      for (let attempt = 0; attempt < 6; attempt++) {
        await sleep(120);
        item = findAttrRow(row.attrName);
        if (item) break;
      }
    }
    item = findAttrRow(row.attrName);
    if (!item) throw new Error('attr row missing after title');
    const valueInput = attrValueInput(item);
    if (!valueInput) throw new Error('no attr value input');
    setNativeValue(valueInput, String(row.value));
    await sleep(220);
    const checkItem = findAttrRow(row.attrName);
    const checkInput = attrValueInput(checkItem);
    row.item = checkItem;
    row.el = checkInput;
    row.current = checkInput ? checkInput.value : '';
    return !!checkInput && sameValue(row.value, checkInput.value);
  }

  async function fillFaqRow(row) {
    const input = faqControl(row);
    if (!input) throw new Error('faq row missing');
    setNativeValue(input, String(row.value));
    await sleep(220);
    const check = faqControl(row);
    row.el = check;
    row.current = check ? check.value : '';
    return !!check && sameValue(row.value, check.value);
  }

  async function fillSelected() {
    if (state.busy) return;
    refreshRows();
    const selected = state.rows.filter(row => row.selected && row.selectable);
    if (!selected.length) {
      toast('没有可填写的字段');
      return;
    }
    if (selected.some(row => row.id === 'company_desc' || row.kind === 'faq')) {
      await ensureCompanyEditors();
      refreshRows();
    }
    const companyReady = companySectionLoaded();
    const targets = companyReady
      ? selected
      : selected.filter(row => row.id !== 'company_desc' && row.kind !== 'faq');
    if (targets.length < selected.length) {
      toast('公司信息区域尚未加载，请先滚动到「2. 公司介绍」；本次跳过公司介绍和 FAQ');
    }
    if (!targets.length) {
      toast('公司信息区域尚未加载，请先滚动到「2. 公司介绍」');
      return;
    }
    state.busy = true;
    updateFillButton();
    const watchdog = setTimeout(() => {
      if (!state.busy) return;
      state.busy = false;
      updateFillButton();
      const resultEl = $('#fillResult');
      if (resultEl) resultEl.textContent = '填充超时，请刷新页面后重试。';
      toast('填充超时');
    }, 45000);
    const succeeded = [];
    const failed = [];
    try {
      await ensureAttrRows(targets.filter(row => row.kind === 'attr').map(row => row.attrName));
      const faqIndexes = targets.filter(row => row.kind === 'faq').map(row => row.faqIndex);
      if (faqIndexes.length) await ensureFaqRows(Math.max(...faqIndexes) + 1);
      refreshRows();
      const emptyRows = attrRows().filter(item => {
        const input = item.querySelector('.attr-title input');
        return !String(input ? input.value : '').trim();
      });
      for (const row of targets) {
        try {
          let ok = false;
          if (row.kind === 'attr') ok = await fillAttrRow(row, emptyRows);
          else if (row.kind === 'faq') ok = await fillFaqRow(row);
          else ok = await fillGenericRow(row);
          if (ok) succeeded.push(row.label);
          else failed.push(row.label);
        } catch (error) {
          failed.push(row.label);
        }
      }
    } finally {
      clearTimeout(watchdog);
      state.busy = false;
      refreshRows();
      renderAll();
    }
    const message = `已填 ${succeeded.length} 项${failed.length ? `，失败 ${failed.length} 项：${failed.join('、')}` : ''}。未保存，请人工检查。`;
    $('#fillResult').textContent = message;
    toast('填充完成，未保存');
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {}
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch (error) {
      return false;
    }
  }

  async function copyDescription(kind) {
    if (!state.draft) return;
    const text = kind === 'html' ? state.draft.description_html : state.draft.description_text;
    if (!text) {
      toast('草稿中没有描述');
      return;
    }
    const ok = await copyText(text);
    toast(ok ? (kind === 'html' ? 'HTML 已复制，请粘贴到富文本编辑器' : '纯文本已复制') : '复制失败');
  }

  function toast(message) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function runtimeSendMessage(message, timeout) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('扩展后台超时'));
      }, timeout);
      try {
        chrome.runtime.sendMessage(message, response => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            reject(new Error(lastError.message));
            return;
          }
          if (!response) {
            reject(new Error('扩展后台无响应'));
            return;
          }
          if (!response.ok) {
            reject(new Error(response.error || '桥接请求失败'));
            return;
          }
          resolve(response.data);
        });
      } catch (error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  async function bridgeFetch(path, options = {}, timeout = 4000) {
    const canUseRuntime = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && chrome.runtime.sendMessage;
    if (canUseRuntime) {
      return await runtimeSendMessage({ type: 'bridge_fetch', path, options }, timeout);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(TOKEN)}`;
      const res = await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get('content-type') || '';
      return contentType.includes('json') ? await res.json() : await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  async function bridgeFetchRetry(path, attempts = 3, timeout = 4000) {
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await bridgeFetch(path, {}, timeout);
      } catch (error) {
        lastError = error;
        await sleep(1200);
      }
    }
    throw lastError;
  }

  async function checkBridge() {
    try {
      await bridgeFetch('/status', {}, 3000);
      state.bridgeOnline = true;
      state.bridgeError = '';
    } catch (error) {
      state.bridgeOnline = false;
      state.bridgeError = String((error && error.message) || error);
    }
    const dot = $('#bridgeDot');
    if (dot) {
      dot.className = `dot ${state.bridgeOnline ? 'on' : 'off'}`;
      dot.title = state.bridgeOnline ? '本地桥接已连接' : `本地桥接未连接：${state.bridgeError}`;
    }
    const hint = $('#bridgeState');
    if (hint) hint.textContent = state.bridgeOnline ? '本地桥接已连接' : '离线模式：使用内置数据，图片需手动上传';
  }

  async function loadStored() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const got = await chrome.storage.local.get(STORAGE_KEY);
        return got && got[STORAGE_KEY] ? got[STORAGE_KEY] : null;
      }
    } catch (error) {}
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  async function saveStored() {
    const payload = { draft: state.draft, config: state.config, savedAt: Date.now() };
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ [STORAGE_KEY]: payload });
        return;
      }
    } catch (error) {}
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {}
  }

  function setDraft(draft) {
    if (!draft || typeof draft !== 'object' || !draft.title) throw new Error('草稿缺少 title');
    state.draft = draft;
    state.imageUploads = new Set();
    const imageResult = $('#imageResult');
    if (imageResult) imageResult.textContent = '';
    buildRows();
    refreshRows();
    renderAll();
    saveStored();
    loadCompanyImagePlan();
    autoRefreshUntilReady();
    toast('草稿已载入');
  }

  function wireEvents() {
    $('#collapseBtn').addEventListener('click', () => {
      const panel = $('#panel');
      panel.classList.toggle('collapsed');
      $('#collapseBtn').textContent = panel.classList.contains('collapsed') ? '+' : '—';
    });

    $('#loadDraftBtn').addEventListener('click', async () => {
      try {
        const config = await bridgeFetchRetry('/config');
        if (config && typeof config === 'object') {
          state.config = mergeConfig(DEFAULT_CONFIG, config);
          renderConfigInputs();
        }
        const draft = await bridgeFetchRetry('/draft');
        setDraft(draft);
        toast('已重新载入草稿与公司配置');
      } catch (error) {
        toast('桥接未连接，请用“导入 JSON”');
      }
    });

    $('#importBtn').addEventListener('click', () => $('#fileInput').click());
    $('#fileInput').addEventListener('change', async event => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      try {
        setDraft(JSON.parse(await file.text()));
      } catch (error) {
        toast(`JSON 解析失败：${error.message}`);
      }
      event.target.value = '';
    });

    $('#refreshBtn').addEventListener('click', async () => {
      if (!state.draft) {
        toast('请先载入草稿');
        return;
      }
      await ensureCompanyEditors();
      refreshRows();
      renderAll();
      toast('已读取页面并生成差异（未修改页面）');
    });

    $('#addFaqBtn').addEventListener('click', () => {
      readConfigInputs();
      const faqs = normalizeFaqs(state.config.company_faqs);
      if (faqs.length >= 8) {
        toast('公司 FAQ 最多 8 条');
        return;
      }
      faqs.push({ question: '', answer: '' });
      state.config.company_faqs = faqs;
      renderFaqInputs();
    });

    $('#cfgFaqList').addEventListener('click', event => {
      const button = event.target && event.target.closest ? event.target.closest('.faq-del') : null;
      if (!button) return;
      readConfigInputs();
      const faqs = normalizeFaqs(state.config.company_faqs);
      faqs.splice(Number(button.dataset.index), 1);
      state.config.company_faqs = faqs;
      renderFaqInputs();
    });

    $('#saveConfigBtn').addEventListener('click', async () => {
      readConfigInputs();
      await saveStored();
      let savedToBridge = false;
      try {
        await bridgeFetch('/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state.config)
        });
        savedToBridge = true;
      } catch (error) {}
      if (state.draft) {
        buildRows();
        refreshRows();
        renderAll();
      }
      toast(savedToBridge ? '配置已保存到本地桥接' : '配置已保存在本机');
    });

    $('#fillBtn').addEventListener('click', fillSelected);
    $('#clearHighlightBtn').addEventListener('click', clearHighlights);
    $('#copyHtmlBtn').addEventListener('click', () => copyDescription('html'));
    $('#copyTextBtn').addEventListener('click', () => copyDescription('text'));
    $('#scanImagesBtn').addEventListener('click', () => {
      renderImages();
      toast('已扫描页面图片');
    });
    $('#uploadImagesBtn').addEventListener('click', uploadMissingImages);
    $('#scanCompanyImagesBtn').addEventListener('click', async () => {
      await loadCompanyImagePlan();
      toast('已读取公司图集配置');
    });
    $('#uploadCompanyImagesBtn').addEventListener('click', uploadCompanyImages);

    $('#onlyEmpty').addEventListener('change', event => {
      state.onlyEmpty = event.target.checked;
      for (const row of state.rows) {
        row.selected = row.selectable && (row.status === 'empty' || (!state.onlyEmpty && row.status === 'conflict'));
      }
      renderTable();
      updateFillButton();
    });

    $('#highlightChk').addEventListener('change', event => {
      state.highlight = event.target.checked;
      if (state.highlight) applyHighlights();
      else clearHighlights();
    });

    shadow.querySelectorAll('#filterChips .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        state.filter = chip.dataset.filter;
        shadow.querySelectorAll('#filterChips .chip').forEach(item => item.classList.toggle('active', item === chip));
        renderTable();
      });
    });

    ['click', 'mousedown', 'keydown', 'input', 'change'].forEach(eventName => {
      shadow.addEventListener(eventName, event => event.stopPropagation());
    });
  }

  async function init() {
    const host = document.createElement('div');
    host.id = 'alibaba-draft-panel-host';
    host.style.position = 'fixed';
    host.style.top = '12px';
    host.style.right = '12px';
    host.style.zIndex = '2147483647';
    host.style.width = '480px';
    host.style.maxHeight = 'calc(100vh - 24px)';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = HTML;
    wireEvents();

    const stored = await loadStored();
    if (stored && stored.config) state.config = mergeConfig(DEFAULT_CONFIG, stored.config);
    if (stored && stored.draft) state.draft = stored.draft;
    renderConfigInputs();

    try {
      const config = await bridgeFetchRetry('/config');
      if (config && typeof config === 'object') {
        state.config = mergeConfig(DEFAULT_CONFIG, config);
        renderConfigInputs();
      }
    } catch (error) {}

    try {
      const latestDraft = await bridgeFetchRetry('/draft');
      if (latestDraft && typeof latestDraft === 'object' && latestDraft.title) {
        const changed = !state.draft || JSON.stringify(latestDraft) !== JSON.stringify(state.draft);
        state.draft = latestDraft;
        if (changed) state.imageUploads = new Set();
      }
    } catch (error) {}

    if (state.draft) {
      buildRows();
      refreshRows();
    }
    renderAll();
    saveStored();
    autoRefreshUntilReady();
    checkBridge();
    setInterval(checkBridge, 20000);
  }

  window.__alibabaDraftPanelApi = {
    loadDraftObject(draft) {
      setDraft(draft);
      return true;
    },
    loadConfigObject(config) {
      state.config = mergeConfig(DEFAULT_CONFIG, config || {});
      renderConfigInputs();
      if (state.draft) {
        buildRows();
        refreshRows();
        renderAll();
      }
      return true;
    },
    refresh() {
      refreshRows();
      renderAll();
      return state.rows.map(row => ({
        id: row.id,
        label: row.label,
        group: row.group,
        value: row.value,
        current: row.current,
        status: row.status,
        selected: row.selected,
        selectable: row.selectable
      }));
    },
    fill() {
      return fillSelected();
    },
    clearHighlights,
    state
  };

  init().catch(error => {
    console.error('[Alibaba Draft Panel]', error);
  });
})();
