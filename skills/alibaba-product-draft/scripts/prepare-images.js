#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const IMAGE_EXT = /\.(avif|webp|jpe?g|png)$/i;

function parseArgs(argv) {
  const args = { root: process.cwd(), max: 1024, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') args.root = argv[++i];
    else if (arg === '--input') args.input = argv[++i];
    else if (arg === '--output') args.output = argv[++i];
    else if (arg === '--max') args.max = Number(argv[++i]);
    else if (arg === '--manifest') args.manifest = argv[++i];
    else if (arg === '--force') args.force = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function fail(error, message, hint, code) {
  console.log(JSON.stringify({ ok: false, error, message, hint }, null, 2));
  process.exit(code || 1);
}

function loadSharp(root) {
  const candidates = [
    'sharp',
    path.join(root, 'node_modules', 'sharp'),
    path.join(process.cwd(), 'node_modules', 'sharp')
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {}
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node prepare-images.js --root . [--input 产品] [--output images] [--max 1024] [--force]');
    return;
  }
  if (!Number.isFinite(args.max) || args.max < 256) throw new Error('--max must be at least 256');

  const root = path.resolve(args.root);
  const inputDir = path.resolve(root, args.input || '产品');
  const outputDir = path.resolve(root, args.output || 'images');
  const manifestPath = path.resolve(root, args.manifest || path.join('output', 'image-manifest.json'));

  if (!fs.existsSync(inputDir)) fail('input_missing', `Input directory not found: ${inputDir}`);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });

  const sharp = loadSharp(root);
  if (!sharp) {
    fail(
      'sharp_missing',
      'sharp is required to convert AVIF/WebP images.',
      'Run "npm install sharp" in the project root, then rerun this script.'
    );
  }

  const files = fs.readdirSync(inputDir).filter(name => IMAGE_EXT.test(name)).sort();
  if (!files.length) fail('no_images', `No supported images found in ${inputDir}`);

  const manifest = [];
  for (const name of files) {
    const source = path.join(inputDir, name);
    const base = name.replace(/\.[^.]+$/, '');
    const destination = path.join(outputDir, `${base}.png`);
    const sourceStat = fs.statSync(source);
    const relative = path.relative(root, destination).replace(/\\/g, '/');
    const original = path.relative(root, source).replace(/\\/g, '/');

    if (!args.force && fs.existsSync(destination)) {
      const destinationStat = fs.statSync(destination);
      if (destinationStat.mtimeMs >= sourceStat.mtimeMs) {
        const meta = await sharp(destination).metadata();
        manifest.push({
          original,
          file: relative,
          width: meta.width,
          height: meta.height,
          bytes: destinationStat.size,
          status: 'cached'
        });
        continue;
      }
    }

    try {
      const info = await sharp(source)
        .rotate()
        .resize({ width: args.max, withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toFile(destination);
      manifest.push({
        original,
        file: relative,
        width: info.width,
        height: info.height,
        bytes: info.size,
        status: 'converted'
      });
    } catch (error) {
      manifest.push({
        original,
        file: relative,
        status: 'failed',
        error: String((error && error.message) || error)
      });
    }
  }

  fs.writeFileSync(manifestPath, `${JSON.stringify({ schema_version: '1.0', max_width: args.max, images: manifest }, null, 2)}\n`, 'utf8');

  const failed = manifest.filter(item => item.status === 'failed');
  console.log(JSON.stringify({
    ok: failed.length === 0,
    root,
    input: inputDir,
    output: outputDir,
    converted: manifest.filter(item => item.status === 'converted').length,
    cached: manifest.filter(item => item.status === 'cached').length,
    failed: failed.length,
    manifest: path.relative(root, manifestPath).replace(/\\/g, '/')
  }, null, 2));
  if (failed.length) process.exit(1);
}

main().catch(error => fail('prepare_failed', String((error && error.message) || error)));
