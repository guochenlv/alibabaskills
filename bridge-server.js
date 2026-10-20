const http = require('node:http');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.BRIDGE_PORT || 8765);
const TOKEN = process.env.BRIDGE_TOKEN || 'local-alibaba-bridge-2026';
const LOG = path.join(__dirname, 'bridge.log');

let pendingPoll = null;
const queue = [];
const waiting = new Map();

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
  fs.appendFileSync(LOG, line);
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Max-Age', '600');
}

function json(res, status, body) {
  cors(res);
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data)
  });
  res.end(data);
}

function noContent(res) {
  cors(res);
  res.writeHead(204);
  res.end();
}

function sendFile(res, file, contentType) {
  try {
    const data = fs.readFileSync(file);
    cors(res);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length,
      'Cache-Control': 'no-store'
    });
    res.end(data);
  } catch (e) {
    json(res, 404, { ok: false, error: `not found: ${path.basename(file)}` });
  }
}

function tokenOk(url) {
  return url.searchParams.get('token') === TOKEN;
}

function resolvePoll(cmd) {
  if (!pendingPoll) return;
  const { res, timer } = pendingPoll;
  pendingPoll = null;
  clearTimeout(timer);
  json(res, 200, cmd);
}

function enqueue(cmd) {
  queue.push(cmd);
  if (pendingPoll) resolvePoll(queue.shift());
}

function complete(id, payload) {
  const waiter = waiting.get(id);
  if (!waiter) return;
  waiting.delete(id);
  clearTimeout(waiter.timer);
  json(waiter.res, 200, payload);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }
  if (!tokenOk(url)) {
    json(res, 401, { ok: false, error: 'bad token' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/status') {
    json(res, 200, {
      ok: true,
      port: PORT,
      pending: !!pendingPoll,
      queued: queue.length,
      waiting: waiting.size,
      time: new Date().toISOString()
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/poll') {
    if (pendingPoll) {
      const old = pendingPoll;
      pendingPoll = null;
      clearTimeout(old.timer);
      noContent(old.res);
    }
    if (queue.length) {
      json(res, 200, queue.shift());
      return;
    }
    const timer = setTimeout(() => {
      if (pendingPoll && pendingPoll.res === res) pendingPoll = null;
      noContent(res);
    }, 25000);
    pendingPoll = { res, timer };
    log('poll connected');
    return;
  }

  if (req.method === 'POST' && url.pathname === '/result') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 20_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        complete(payload.id, payload);
        json(res, 200, { ok: true });
      } catch (e) {
        json(res, 400, { ok: false, error: String(e) });
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/exec') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5_000_000) req.destroy();
    });
    req.on('end', () => {
      let cmd;
      try {
        cmd = JSON.parse(body || '{}');
      } catch (e) {
        json(res, 400, { ok: false, error: 'bad json' });
        return;
      }
      const id = cmd.id || randomUUID();
      cmd.id = id;
      const timeoutMs = Math.min(Number(cmd.timeoutMs || 30000), 600000);
      const timer = setTimeout(() => {
        waiting.delete(id);
        json(res, 504, { ok: false, id, error: 'timeout waiting for extension' });
      }, timeoutMs);
      waiting.set(id, { res, timer });
      log('exec', id, cmd.type, cmd.method || '');
      enqueue(cmd);
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/draft') {
    sendFile(res, path.join(__dirname, 'output', 'product-draft.json'), 'application/json; charset=utf-8');
    return;
  }

  if (req.method === 'GET' && url.pathname === '/config') {
    const live = path.join(__dirname, 'output', 'plugin-config.json');
    const fallback = path.join(__dirname, 'output', 'company-profile.template.json');
    sendFile(res, fs.existsSync(live) ? live : fallback, 'application/json; charset=utf-8');
    return;
  }

  if (req.method === 'POST' && url.pathname === '/config') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        const cfg = JSON.parse(body || '{}');
        if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('config must be an object');
        fs.writeFileSync(path.join(__dirname, 'output', 'plugin-config.json'), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
        json(res, 200, { ok: true });
      } catch (e) {
        json(res, 400, { ok: false, error: String(e) });
      }
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/image') {
    const name = url.searchParams.get('name') || '';
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      json(res, 400, { ok: false, error: 'bad image name' });
      return;
    }
    const file = path.join(__dirname, 'images', name);
    const ext = path.extname(name).toLowerCase();
    const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
    sendFile(res, file, types[ext] || 'application/octet-stream');
    return;
  }

  if (req.method === 'GET' && url.pathname === '/image-upload-plan') {
    let draft;
    try {
      draft = JSON.parse(fs.readFileSync(path.join(__dirname, 'output', 'product-draft.json'), 'utf8'));
    } catch (e) {
      json(res, 500, { ok: false, error: 'draft not readable' });
      return;
    }
    const imagesDir = path.resolve(__dirname, 'images');
    const images = [];
    for (const image of (Array.isArray(draft.images) ? draft.images : [])) {
      const name = path.basename(String((image && image.file) || ''));
      if (!/^[A-Za-z0-9._-]+\.(png|jpe?g)$/i.test(name)) continue;
      const file = path.resolve(imagesDir, name);
      if (path.dirname(file) !== imagesDir || !fs.existsSync(file)) continue;
      images.push({
        name,
        path: file,
        role: (image && image.role) || '',
        order: (image && image.order) || images.length + 1,
        note: (image && image.note) || ''
      });
    }
    json(res, 200, { ok: true, max_images: 6, images });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/company-image-upload-plan') {
    let cfg = {};
    try {
      cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'output', 'plugin-config.json'), 'utf8'));
    } catch (e) {}
    const imagesRoot = path.resolve(__dirname, 'images');
    const images = [];
    for (const item of (Array.isArray(cfg.company_images) ? cfg.company_images : [])) {
      const rel = String((item && item.file) || '').replace(/\\/g, '/').replace(/^\.\//, '');
      if (!rel || path.isAbsolute(rel) || rel.split('/').includes('..')) continue;
      const file = path.resolve(__dirname, rel);
      if (!file.startsWith(imagesRoot + path.sep)) continue;
      if (!/\.(png|jpe?g)$/i.test(file) || !fs.existsSync(file)) continue;
      images.push({
        name: path.basename(file),
        path: file,
        album: String((item && item.album) || ''),
        album_en: String((item && item.album_en) || ''),
        order: (item && item.order) || images.length + 1
      });
    }
    const albums = [];
    for (const image of images) {
      let album = albums.find(entry => entry.album === image.album);
      if (!album) {
        album = { album: image.album, album_en: image.album_en, count: 0 };
        albums.push(album);
      }
      album.count++;
    }
    json(res, 200, { ok: true, albums, images });
    return;
  }

  json(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  log(`bridge listening on 127.0.0.1:${PORT}`);
  console.log(`bridge listening on http://127.0.0.1:${PORT}`);
});
