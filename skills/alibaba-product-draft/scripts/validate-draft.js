#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const args = { root: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') args.root = argv[++i];
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node validate-draft.js --root .');
    return;
  }
  const root = path.resolve(args.root);
  const draftPath = path.join(root, 'output', 'product-draft.json');
  const errors = [];
  const warnings = [];

  if (!fs.existsSync(draftPath)) {
    console.log(JSON.stringify({ ok: false, errors: [`Missing ${draftPath}`], warnings: [] }, null, 2));
    process.exit(1);
  }

  let draft;
  try {
    draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, errors: [`Invalid JSON: ${String((error && error.message) || error)}`], warnings: [] }, null, 2));
    process.exit(1);
  }

  const title = String(draft.title || '');
  if (!title.trim()) errors.push('title is empty');
  if (title.length > 128) errors.push(`title is ${title.length} characters; maximum is 128`);
  if (title.length < 20) warnings.push(`title is only ${title.length} characters; consider a more descriptive title`);
  if (draft.title_length !== title.length) errors.push(`title_length is ${draft.title_length}; expected ${title.length}`);

  if (!Array.isArray(draft.keywords) || !draft.keywords.length) errors.push('keywords must contain at least one phrase');
  else {
    const unique = new Set(draft.keywords.map(item => String(item).trim().toLowerCase()));
    if (unique.size !== draft.keywords.length) warnings.push('keywords contain duplicates');
    for (const keyword of draft.keywords) {
      if (String(keyword).trim().length < 2) errors.push(`keyword is too short: ${JSON.stringify(keyword)}`);
    }
  }

  if (!String(draft.description_html || '').trim()) errors.push('description_html is empty');
  if (!String(draft.description_text || '').trim()) errors.push('description_text is empty');
  if (/<script\b|on\w+\s*=|javascript:/i.test(String(draft.description_html || ''))) {
    errors.push('description_html contains script or inline event handlers');
  }

  if (!isObject(draft.attributes) || !Object.keys(draft.attributes).length) errors.push('attributes must contain at least one field');
  if (!isObject(draft.attribute_sources)) warnings.push('attribute_sources is missing');
  else {
    for (const key of Object.keys(draft.attribute_sources)) {
      if (!(key in draft.attributes)) warnings.push(`attribute_sources has an entry for unknown attribute: ${key}`);
    }
  }

  if (!Array.isArray(draft.images) || !draft.images.length) errors.push('images must contain at least one image');
  else {
    const orders = new Set();
    for (const image of draft.images) {
      const file = String((image && image.file) || '');
      if (!file) {
        errors.push('image entry is missing file');
        continue;
      }
      if (!fs.existsSync(path.resolve(root, file))) errors.push(`image file not found: ${file}`);
      if (!['main', 'gallery', 'detail', 'specification'].includes(image.role)) errors.push(`invalid image role for ${file}: ${image.role}`);
      if (orders.has(image.order)) errors.push(`duplicate image order: ${image.order}`);
      orders.add(image.order);
    }
    if (!draft.images.some(image => image.role === 'main')) warnings.push('no main image is marked');
  }

  if (!Array.isArray(draft.missing)) errors.push('missing must be an array');
  else {
    for (const [index, item] of draft.missing.entries()) {
      if (!isObject(item) || !String(item.field || '').trim()) errors.push(`missing[${index}] has no field`);
      if (isObject(item) && !String(item.reason || '').trim()) warnings.push(`missing[${index}] has no reason`);
      if (isObject(item) && !String(item.action || '').trim()) warnings.push(`missing[${index}] has no action`);
    }
  }

  const allowedPlaceholder = /^\{\{\s*company\.(brand|origin|manufacturer_batch|name|company_name)\s*\}\}$/;
  const text = JSON.stringify(draft);
  for (const match of text.match(/\{\{[^}]+\}\}/g) || []) {
    if (!allowedPlaceholder.test(match)) errors.push(`unsupported placeholder: ${match}`);
  }
  if (/\{\{/.test(String(draft.title || '')) || /\{\{/.test(String(draft.description_html || ''))) {
    errors.push('title or description contains a placeholder');
  }

  if (!isObject(draft.company_profile)) warnings.push('company_profile is missing');
  else if (draft.company_profile.resolved !== false) warnings.push('company_profile.resolved should be false before the plugin resolves it');

  for (const key of ['moq', 'price', 'packaging', 'lead_time', 'certifications', 'category']) {
    if (!isObject(draft[key])) errors.push(`${key} must be an object`);
  }
  if (isObject(draft.moq) && !(Number(draft.moq.value) > 0)) warnings.push('moq.value is not a positive number');
  if (isObject(draft.lead_time) && Number(draft.lead_time.min_days) > Number(draft.lead_time.max_days)) {
    errors.push('lead_time.min_days is greater than max_days');
  }

  console.log(JSON.stringify({
    ok: errors.length === 0,
    title_length: title.length,
    images: Array.isArray(draft.images) ? draft.images.length : 0,
    attributes: isObject(draft.attributes) ? Object.keys(draft.attributes).length : 0,
    missing: Array.isArray(draft.missing) ? draft.missing.length : 0,
    errors,
    warnings
  }, null, 2));
  if (errors.length) process.exit(1);
}

try {
  main();
} catch (error) {
  console.log(JSON.stringify({ ok: false, errors: [String((error && error.message) || error)], warnings: [] }, null, 2));
  process.exit(1);
}
