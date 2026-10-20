#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const codexHome = process.env.CODEX_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '', '.codex');
const candidates = [
  process.env.ALIBABA_DRAFT_SKILL,
  path.join(codexHome, 'skills', 'alibaba-product-draft'),
  path.join(root, 'skills', 'alibaba-product-draft')
].filter(Boolean);

const skillDir = candidates.find(dir => fs.existsSync(path.join(dir, 'scripts', 'build-draft.js')));
if (!skillDir) {
  console.error('alibaba-product-draft skill not found.');
  console.error('Install it at ~/.codex/skills/alibaba-product-draft or set ALIBABA_DRAFT_SKILL.');
  process.exit(1);
}

const result = spawnSync(process.execPath, [
  path.join(skillDir, 'scripts', 'build-draft.js'),
  '--root', root,
  ...process.argv.slice(2)
], { stdio: 'inherit' });

process.exit(result.status == null ? 1 : result.status);
