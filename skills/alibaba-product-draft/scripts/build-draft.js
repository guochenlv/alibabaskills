#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const args = { root: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') args.root = argv[++i];
    else if (arg === '--listing') args.listing = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asText(value, fallback = '') {
  if (value == null) return fallback;
  return String(value);
}

function normalizeAttributeObject(value) {
  if (!isObject(value)) return {};
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.trim() && (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')) {
      out[key] = item;
    }
  }
  return out;
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>(?=)/gi, '\n')
    .replace(/<\s*\/p\s*>/gi, '\n\n')
    .replace(/<\s*\/li\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<\s*\/td\s*>/gi, ' | ')
    .replace(/<\s*\/tr\s*>/gi, '\n')
    .replace(/<\s*h[1-6][^>]*>/gi, '\n')
    .replace(/<\s*\/h[1-6]\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]*\|[ \t]*\n/g, '\n')
    .replace(/^[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function readJson(file, required) {
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`Missing required file: ${file}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid JSON in ${file}: ${String((error && error.message) || error)}`);
  }
}

function normalizeImages(root, images) {
  if (!Array.isArray(images)) return [];
  return images.map((image, index) => {
    const raw = asText(isObject(image) ? image.file : image).replace(/\\/g, '/').replace(/^\.\//, '');
    const file = raw.startsWith('images/') ? raw : `images/${path.basename(raw)}`;
    const absolute = path.resolve(root, file);
    if (!fs.existsSync(absolute)) throw new Error(`Image not found: ${file}`);
    const role = asText(image && image.role, 'gallery');
    if (!['main', 'gallery', 'detail', 'specification'].includes(role)) {
      throw new Error(`Invalid image role "${role}" for ${file}`);
    }
    return {
      file,
      role,
      order: Number(image && image.order) || index + 1,
      note: asText(image && image.note)
    };
  });
}

function normalizeMissing(missing) {
  if (!Array.isArray(missing)) return [];
  return missing.map((item, index) => {
    if (!isObject(item) || !asText(item.field).trim()) {
      throw new Error(`missing[${index}] needs a field`);
    }
    return {
      field: asText(item.field).trim(),
      reason: asText(item.reason).trim(),
      action: asText(item.action, 'Confirm manually.').trim() || 'Confirm manually.'
    };
  });
}

function mergeObject(defaults, value) {
  return { ...defaults, ...(isObject(value) ? value : {}) };
}

function checkPlaceholders(draft) {
  const errors = [];
  const allowed = /^\{\{\s*company\.(brand|origin|manufacturer_batch|name|company_name)\s*\}\}$/;
  const scan = (value, location) => {
    if (typeof value !== 'string') return;
    const matches = value.match(/\{\{[^}]+\}\}/g) || [];
    for (const match of matches) {
      if (!allowed.test(match)) errors.push(`Unsupported placeholder ${match} in ${location}`);
    }
  };
  scan(draft.title, 'title');
  scan(draft.description_html, 'description_html');
  for (const keyword of draft.keywords) scan(keyword, 'keywords');
  for (const [key, value] of Object.entries(draft.attributes)) scan(value, `attributes.${key}`);
  for (const [key, value] of Object.entries(draft.custom_attributes)) scan(value, `custom_attributes.${key}`);
  return errors;
}

function attributeRows(attributes, sources) {
  return Object.entries(attributes)
    .map(([key, value]) => `| ${key} | ${asText(value)} | ${asText(sources[key], '')} |`)
    .join('\n');
}

function imageRows(images) {
  return images
    .map(image => `| ${image.order} | ${image.file} | ${image.role} | ${image.note} |`)
    .join('\n');
}

function missingRows(missing) {
  return missing
    .map(item => `| ${item.field} | ${item.reason} | ${item.action} |`)
    .join('\n');
}

function buildMarkdown(draft) {
  const attributes = attributeRows(draft.attributes, draft.attribute_sources);
  const images = imageRows(draft.images);
  const missing = missingRows(draft.missing);
  return `# Alibaba 产品草稿

生成时间：${draft.generated_at}

模式：${draft.mode}

建议类目：${draft.category.suggested_path_zh || draft.category.suggested_path_en || '(待选择)'}

## 1. 标题（${draft.title_length}/${draft.title_max_length}）

${draft.title}

## 2. 关键词

${draft.keywords.map(keyword => `- ${keyword}`).join('\n')}

## 3. 英文描述（纯文本预览）

${draft.description_text}

## 4. 类目属性

| 属性 | 值 | 来源 |
|---|---|---|
${attributes}

## 5. 通用默认值

| 字段 | 值 | 说明 |
|---|---|---|
| MOQ | ${draft.moq.value} ${draft.moq.unit} | ${draft.moq.note} |
| 包装 | ${draft.packaging.method} | ${draft.packaging.note} |
| 交期 | ${draft.lead_time.min_days}-${draft.lead_time.max_days} 天 | ${draft.lead_time.note} |
| 价格 | ${draft.price.reference_range ? `${draft.price.currency} ${draft.price.reference_range.min} - ${draft.price.reference_range.max}` : '待人工填写'} | ${draft.price.note} |

## 6. 图片顺序

| 顺序 | 文件 | 角色 | 说明 |
|---|---|---|---|
${images}

## 7. 需要人工确认

| 字段 | 原因 | 处理 |
|---|---|---|
${missing || '| - | - | - |'}

## 8. 公司与发布配置

公司信息不由模型生成。品牌、原产地、生产批次和公司名由 Edge 插件配置解析；未解析的占位符不会被填入页面。

${draft.reference_listing ? `## 9. 参考商品\n\n- 商品 ID：${draft.reference_listing.item_id || ''}\n- 标题：${draft.reference_listing.title || ''}\n- 说明：${draft.reference_listing.note || ''}\n` : ''}`;
}

function buildPreview(draft) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Product description preview</title>
<style>
  body { margin: 0; padding: 32px; background: #f5f5f5; font-family: Arial, Helvetica, sans-serif; color: #222; }
  .card { max-width: 960px; margin: 0 auto; background: #fff; padding: 32px 40px; box-shadow: 0 1px 4px rgba(0,0,0,.12); }
  h1 { font-size: 24px; line-height: 1.35; margin: 0 0 8px; }
  .meta { color: #666; font-size: 13px; margin-bottom: 24px; }
  h3 { margin-top: 28px; font-size: 18px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  td { border: 1px solid #ddd; padding: 8px 10px; vertical-align: top; }
  td:first-child { width: 34%; background: #fafafa; }
  li { margin: 6px 0; }
</style>
</head>
<body>
<div class="card">
  <h1>${draft.title}</h1>
  <div class="meta">Keywords: ${draft.keywords.join(' | ')}</div>
  ${draft.description_html}
</div>
</body>
</html>
`;
}

function pageFieldMap() {
  return {
    page: 'https://post.alibaba.com/product/publish.htm',
    note: 'Stable selectors observed on 2026-10-19. The plugin must read before write and skip read-only or unmatched fields.',
    fields: {
      title: { selector: 'input#productTitle', max_length: 128 },
      model: { selector: '#struct-p-3 input' },
      type: { selector: '#struct-p-191284008 input' },
      origin: { selector: '#struct-p-1 input' },
      province: { selector: '#struct-p-1-1', read_only: true },
      brand: { selector: '#struct-p-2 input' },
      brand_secondary: { selector: '#struct-p-210192652 input' },
      packing: { selector: '#struct-p-210188265 input' },
      product_name: { selector: '#struct-p-133600302 input' },
      manufacturer_batch: { selector: '#struct-p-100008467 input' },
      custom_attributes: { selector: '.posting-field-more-attrs .item', title: '.attr-title input', value: '.attr-value input' },
      moq: { selector: 'input#minOrderQuantity' },
      price_min: { selector: 'input[placeholder="请输入最低价"]' },
      price_max: { selector: 'input[placeholder="请输入最高价"]' },
      gross_weight: { selector: 'input#pkgWeight' },
      package_length: { selector: 'input[placeholder*="长"]' },
      package_width: { selector: 'input[placeholder*="宽"]' },
      package_height: { selector: 'input[placeholder*="高"]' },
      description: { selector: 'rich text editor', note: 'Paste HTML or plain text; selector must be confirmed per category.' },
      save: { selector: '.draftBtn-button', write_action: true, manual_only: true },
      submit: { selector: '.button-submit-button', write_action: true, manual_only: true }
    }
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node build-draft.js --root . [--listing output/listing.json] [--out output]');
    return;
  }
  const root = path.resolve(args.root);
  const outDir = path.resolve(root, args.out || 'output');
  const listingPath = path.resolve(root, args.listing || path.join('output', 'listing.json'));
  const listing = readJson(listingPath, true);
  if (!isObject(listing)) throw new Error('listing.json must contain an object');

  const title = asText(listing.title).trim();
  if (!title) throw new Error('listing.title is required');
  if (title.length > 128) throw new Error(`listing.title is ${title.length} characters; maximum is 128`);

  const keywords = Array.isArray(listing.keywords)
    ? [...new Set(listing.keywords.map(item => asText(item).trim()).filter(Boolean))]
    : [];
  if (!keywords.length) throw new Error('listing.keywords must contain at least one phrase');

  const descriptionHtml = asText(listing.description_html).trim();
  if (!descriptionHtml) throw new Error('listing.description_html is required');

  const attributes = normalizeAttributeObject(listing.attributes);
  if (!Object.keys(attributes).length) throw new Error('listing.attributes must contain at least one attribute');
  const attributeSources = normalizeAttributeObject(listing.attribute_sources);
  const customAttributes = normalizeAttributeObject(listing.custom_attributes);
  const customAttributeSources = isObject(listing.custom_attribute_sources)
    ? normalizeAttributeObject(listing.custom_attribute_sources)
    : (listing.custom_attribute_sources == null ? {} : listing.custom_attribute_sources);
  const images = normalizeImages(root, listing.images);
  if (!images.length) throw new Error('listing.images must contain at least one image');
  const missing = normalizeMissing(listing.missing);

  const category = mergeObject({
    suggested_path_en: '',
    suggested_path_zh: '',
    selection: 'manual_required',
    note: 'Category must be selected manually before filling because attributes differ.'
  }, listing.category);

  const moq = mergeObject({
    value: 100,
    unit: 'piece',
    source: 'default',
    note: 'Generic starting MOQ; confirm with factory.'
  }, listing.moq);
  const price = mergeObject({
    currency: 'USD',
    tiers: [],
    reference_range: null,
    source: 'missing',
    note: 'Business-sensitive; fill manually.'
  }, listing.price);
  const packaging = mergeObject({
    method: 'Poly bag + export carton',
    size: '',
    weight: '',
    source: 'default',
    note: 'Confirm carton size and gross weight.'
  }, listing.packaging);
  const leadTime = mergeObject({
    min_days: 15,
    max_days: 30,
    source: 'default',
    note: 'Generic lead time; confirm production capacity.'
  }, listing.lead_time);
  const certifications = mergeObject({
    value: [],
    source: 'missing',
    note: 'Confirm certification marks before claiming them.'
  }, listing.certifications);

  const draft = {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    mode: asText(listing.mode, 'new_product'),
    language: asText(listing.language, 'en'),
    category,
    title,
    title_length: title.length,
    title_max_length: 128,
    keywords,
    description_html: descriptionHtml,
    description_text: htmlToText(descriptionHtml),
    attributes,
    attribute_sources: attributeSources,
    custom_attributes: customAttributes,
    custom_attribute_sources: customAttributeSources,
    moq,
    price,
    packaging,
    lead_time: leadTime,
    images,
    company_profile: {
      source: 'plugin_config',
      resolved: false,
      required_at_publish: true,
      fields: {
        brand: '{{company.brand}}',
        origin: '{{company.origin}}',
        manufacturer_batch: '{{company.manufacturer_batch}}',
        company_name: '{{company.name}}'
      },
      template: 'output/company-profile.template.json',
      note: 'Company information is not generated. The plugin must resolve these placeholders from user settings; do not fill unresolved placeholders.'
    },
    certifications,
    missing,
    reference_listing: isObject(listing.reference_listing) ? listing.reference_listing : null
  };

  const placeholderErrors = checkPlaceholders(draft);
  if (placeholderErrors.length) throw new Error(placeholderErrors.join('; '));

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'product-draft.json'), `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(outDir, 'product-draft.md'), buildMarkdown(draft), 'utf8');
  fs.writeFileSync(path.join(outDir, 'page-field-map.json'), `${JSON.stringify(pageFieldMap(), null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(outDir, 'description-preview.html'), buildPreview(draft), 'utf8');

  console.log(JSON.stringify({
    ok: true,
    root,
    title_length: draft.title_length,
    keywords: draft.keywords.length,
    attributes: Object.keys(draft.attributes).length,
    images: draft.images.length,
    missing: draft.missing.length,
    outputs: [
      'output/product-draft.json',
      'output/product-draft.md',
      'output/page-field-map.json',
      'output/description-preview.html'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: String((error && error.message) || error) }, null, 2));
  process.exit(1);
}
