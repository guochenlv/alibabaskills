const BASE = 'http://127.0.0.1:8765';
const TOKEN = 'local-alibaba-bridge-2026';
const IMAGE_MAX = 6;
const IMAGE_FILE = /^[A-Za-z0-9._-]+\.(png|jpe?g)$/i;
const PUBLISH_PAGE = /^https:\/\/post\.alibaba\.com\/product\/publish/i;

let polling = false;
let attachedTabId = null;

const OFFLINE_ASSETS = {
  '/draft': 'offline/product-draft.json',
  '/config': 'offline/plugin-config.json'
};

async function api(path, options = {}) {
  const url = `${BASE}${path}?token=${encodeURIComponent(TOKEN)}`;
  try {
    const res = await fetch(url, options);
    if (res.status === 204) return null;
    if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
    return await res.json();
  } catch (error) {
    if (options && options.method) throw error;
    if (OFFLINE_ASSETS[path]) {
      try {
        const res = await fetch(chrome.runtime.getURL(OFFLINE_ASSETS[path]));
        if (res.ok) return await res.json();
      } catch (offlineError) {}
      throw error;
    }
    if (path === '/image-upload-plan') return { ok: true, max_images: 6, images: [] };
    if (path === '/company-image-upload-plan') return { ok: true, albums: [], images: [] };
    throw error;
  }
}

async function findTab() {
  const tabs = await chrome.tabs.query({ url: ['https://*.alibaba.com/*'] });
  const publish = tabs.find(t => t.url && t.url.includes('post.alibaba.com/product/publish'));
  if (publish) return publish;
  if (tabs.length) return tabs[0];
  throw new Error('No Alibaba tab found');
}

async function ensureDebugger(tabId) {
  if (attachedTabId === tabId) return;
  if (attachedTabId != null) {
    try { await chrome.debugger.detach({ tabId: attachedTabId }); } catch {}
    attachedTabId = null;
  }
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (e) {
    const msg = String(e);
    if (!msg.includes('Another debugger') && !msg.includes('already attached')) throw e;
  }
  attachedTabId = tabId;
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

function remoteValue(res) {
  if (!res) return undefined;
  if (res.exceptionDetails) {
    const detail = res.exceptionDetails.exception && res.exceptionDetails.exception.description;
    throw new Error(detail || res.exceptionDetails.text || 'page evaluation failed');
  }
  return res.result ? res.result.value : undefined;
}

async function evalValue(tabId, expression) {
  return remoteValue(await send(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  }));
}

async function evalObjectId(tabId, expression) {
  const res = await send(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: false,
    awaitPromise: true
  });
  if (res.exceptionDetails) throw new Error('page evaluation failed');
  return res.result && res.result.objectId;
}

const SCAN_IMAGES = `(() => {
  const items = Array.from(document.querySelectorAll('.image-upload-list li.image-upload-list-item'));
  const hashes = [];
  const push = raw => {
    let text = String(raw == null ? '' : raw).trim();
    if (!text) return;
    text = text.split('/').pop() || '';
    try { text = decodeURIComponent(text); } catch (e) {}
    text = text.replace(/_\\d+x\\d+(\\.[a-z0-9]+)?$/i, '').replace(/\\.(jpe?g|png|webp)$/i, '');
    if (text) hashes.push(text.toLowerCase());
  };
  for (const li of items) {
    const nameEl = li.querySelector('.image-fileName');
    if (nameEl) push(nameEl.getAttribute('title') || nameEl.textContent);
    const el = li.querySelector('.image-upload-list-item-thumbnail div') || li.querySelector('[style*="background-image"]');
    const bg = el ? getComputedStyle(el).backgroundImage : '';
    const match = bg.match(/url\\(["']?([^"')]+)["']?\\)/);
    if (match) push(match[1]);
  }
  return {
    count: items.length,
    hashes: Array.from(new Set(hashes)),
    placeholder: !!document.querySelector('#image-placeholder'),
    max: ${IMAGE_MAX}
  };
})()`;

async function waitFor(tabId, expression, timeoutMs, intervalMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await evalValue(tabId, expression);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, intervalMs || 400));
  }
  return null;
}

async function uploadImages(tabId, requestedNames) {
  const tab = await chrome.tabs.get(tabId);
  if (!PUBLISH_PAGE.test(tab.url || '')) throw new Error('not_a_publish_page');

  const plan = await api('/image-upload-plan');
  const allowed = ((plan && plan.images) || []).filter(image => IMAGE_FILE.test(image.name));
  const byName = new Map(allowed.map(image => [image.name.toLowerCase(), image]));
  const requested = Array.isArray(requestedNames) && requestedNames.length
    ? requestedNames.map(name => String(name))
    : allowed.map(image => image.name);

  const selected = [];
  const result = {
    ok: true,
    tabId,
    max: IMAGE_MAX,
    uploaded: [],
    skipped: [],
    failed: []
  };
  for (const name of requested) {
    const image = byName.get(name.toLowerCase());
    if (image) selected.push(image);
    else result.failed.push({ name, ok: false, error: 'not_allowed' });
  }

  await ensureDebugger(tabId);
  let scan = await evalValue(tabId, SCAN_IMAGES);
  result.before = scan.count;
  const present = new Set(scan.hashes.map(hash => hash.toLowerCase()));

  for (const image of selected) {
    const key = image.name.replace(/\.[^.]+$/, '').toLowerCase();
    if (present.has(key)) {
      result.skipped.push({ name: image.name, reason: 'already_present' });
      continue;
    }

    scan = await evalValue(tabId, SCAN_IMAGES);
    if (!scan.placeholder || scan.count >= IMAGE_MAX) {
      result.failed.push({
        name: image.name,
        ok: false,
        error: scan.placeholder ? 'image_limit_reached' : 'no_upload_slot'
      });
      continue;
    }

    try {
      const before = scan.count;
      await evalValue(tabId, `(() => {
        const placeholder = document.querySelector('#image-placeholder');
        if (!placeholder) return false;
        placeholder.scrollIntoView({ block: 'center', inline: 'center' });
        return true;
      })()`);
      await new Promise(resolve => setTimeout(resolve, 350));

      const point = await evalValue(tabId, `(() => {
        const placeholder = document.querySelector('#image-placeholder');
        if (!placeholder) return null;
        const rect = placeholder.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      })()`);
      if (!point) throw new Error('placeholder_not_visible');

      await send(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0
      });
      const menuReady = await waitFor(tabId, `(() => {
        return Array.from(document.querySelectorAll('.sc-images-upload-dropdown')).some(dropdown => {
          const rect = dropdown.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && !!dropdown.querySelector('input[type=file]');
        });
      })()`, 5000, 250);
      if (!menuReady) throw new Error('upload_menu_not_found');

      const objectId = await evalObjectId(tabId, `(() => {
        const visible = Array.from(document.querySelectorAll('.sc-images-upload-dropdown')).find(dropdown => {
          const rect = dropdown.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        return visible ? visible.querySelector('input[type=file]') : null;
      })()`);
      if (!objectId) throw new Error('file_input_not_found');
      await send(tabId, 'DOM.setFileInputFiles', { files: [image.path], objectId });

      const after = await waitFor(tabId, `(() => {
        const count = document.querySelectorAll('.image-upload-list li.image-upload-list-item').length;
        return count > ${before} ? count : 0;
      })()`, 45000, 500);
      if (!after) throw new Error('upload_timeout');

      present.add(key);
      result.uploaded.push({ name: image.name, ok: true, before, after });
    } catch (error) {
      result.failed.push({ name: image.name, ok: false, error: String((error && error.message) || error) });
    } finally {
      try {
        await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: 8, y: 8, button: 'none', buttons: 0 });
      } catch (error) {}
    }
  }

  const finalScan = await evalValue(tabId, SCAN_IMAGES);
  result.after = finalScan.count;
  result.placeholder = finalScan.placeholder;
  return result;
}

async function mountCompanyEditors(tabId) {
  const tab = tabId ? await chrome.tabs.get(tabId) : await findTab();
  if (!PUBLISH_PAGE.test(tab.url || '')) throw new Error('not_a_publish_page:' + (tab.url || 'empty'));
  const [entry] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: () => {
      const mount = selector => {
        const node = document.querySelector(selector);
        if (!node) return false;
        if (node.querySelector('textarea, input, [contenteditable="true"]')) return true;
        const key = Object.keys(node).find(name => name.startsWith('__reactFiber$'));
        if (!key) return false;
        let fiber = node[key];
        for (let depth = 0; depth < 40 && fiber; depth++) {
          const instance = fiber.stateNode;
          if (instance && instance.state && instance.state.appeared === false && typeof instance.setState === 'function') {
            instance.setState({ appeared: true });
            return true;
          }
          fiber = fiber.return;
        }
        return false;
      };
      const desc = mount('#struct-companyDesc .info-content > div');
      const faq = mount('#struct-companyFaqDesc .company-faq-desc');
      const textDesc = mount('#struct-textDesc .info-content > div');
      return {
        desc,
        faq,
        textDesc,
        descReady: !!document.querySelector('#struct-companyDesc textarea'),
        faqRows: document.querySelectorAll('#struct-companyFaqDesc input[placeholder="请输入问题"]').length,
        textDescReady: !!document.querySelector('#struct-textDesc [contenteditable="true"]')
      };
    }
  });
  return entry ? entry.result : null;
}

function findCompanyAlbumJs(name) {
  return `(() => {
    const norm = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const name = ${JSON.stringify(name)};
    return Array.from(document.querySelectorAll('#companyImage .gallery-item-container')).find(el => {
      const cn = el.querySelector('.gallery-item-header-cn-name');
      const en = el.querySelector('.gallery-item-header-en-name');
      return norm(cn && cn.textContent) === name || norm(en && en.textContent) === name;
    }) || null;
  })()`;
}

async function uploadCompanyFileViaChooser(tabId, album, filePath) {
  await ensureDebugger(tabId);
  await send(tabId, 'Page.setInterceptFileChooserDialog', { enabled: true });

  const chooser = new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.debugger.onEvent.removeListener(onEvent);
      reject(new Error('file_chooser_timeout'));
    }, 12000);
    function onEvent(source, method, params) {
      if (source.tabId !== tabId || method !== 'Page.fileChooserOpened') return;
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.debugger.onEvent.removeListener(onEvent);
      resolve(params);
    }
    chrome.debugger.onEvent.addListener(onEvent);
  });

  try {
    const point = await evalValue(tabId, `(() => {
      const el = ${findCompanyAlbumJs(album)};
      const btn = el && el.querySelector('.upload-button-container .image-upload-content, .upload-button-container .image-upload-wrapper');
      if (!btn) return null;
      const rect = btn.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    if (!point) throw new Error('upload_button_not_found');
    await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0 });
    await new Promise(resolve => setTimeout(resolve, 500));

    const click = await evalValue(tabId, `(() => {
      const el = ${findCompanyAlbumJs(album)};
      const popup = el && el.querySelector('.upload-popup-container');
      if (!popup || getComputedStyle(popup).display === 'none') return null;
      const item = Array.from(popup.querySelectorAll('.upload-style-item')).find(node => (node.innerText || '').includes('本地上传'));
      if (!item) return null;
      const rect = item.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    if (!click) throw new Error('upload_menu_item_not_found');
    await send(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: click.x, y: click.y, button: 'left', buttons: 1, clickCount: 1 });
    await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: click.x, y: click.y, button: 'left', buttons: 0, clickCount: 1 });

    const opened = await chooser;
    if (!opened || !opened.backendNodeId) throw new Error('no_backend_node');
    await send(tabId, 'DOM.setFileInputFiles', { files: [filePath], backendNodeId: opened.backendNodeId });
    return true;
  } finally {
    try { await send(tabId, 'Page.setInterceptFileChooserDialog', { enabled: false }); } catch (error) {}
    try { await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: 8, y: 8, button: 'none', buttons: 0 }); } catch (error) {}
  }
}

async function ensureCompanyAlbumSelected(tabId, album, albumEn) {
  return await evalValue(tabId, `(() => {
    const norm = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const name = ${JSON.stringify(album)};
    const en = ${JSON.stringify(albumEn)};
    const node = document.querySelector('#companyImage .gallery-names-checkbox-group');
    if (!node) return { ok: false, error: 'no_gallery_group' };
    const key = Object.keys(node).find(k => k.startsWith('__reactFiber$'));
    let fiber = node[key], instance = null, props = null;
    for (let depth = 0; depth < 25 && fiber; depth++) {
      if (fiber.type && fiber.type.name === 'ImageGallery') { instance = fiber.stateNode; props = fiber.memoizedProps; break; }
      fiber = fiber.return;
    }
    if (!instance || !props) return { ok: false, error: 'no_gallery_instance' };
    const dataSource = props.dataSource || [];
    const target = dataSource.find(item => norm(item.cnName) === name || (en && norm(item.enName) === en));
    if (!target) return { ok: false, error: 'album_not_found' };
    const checked = (instance.state.checkedValues || []).slice();
    if (!checked.includes(target.value)) {
      checked.push(target.value);
      instance.confirmCheckedChange(checked, dataSource);
    }
    return { ok: true, id: target.value };
  })()`);
}

async function cleanStuckCompanyUploads(tabId) {
  return await evalValue(tabId, `(() => {
    const node = document.querySelector('#companyImage .gallery-names-checkbox-group');
    if (!node) return { ok: false, error: 'no_gallery_group' };
    const key = Object.keys(node).find(k => k.startsWith('__reactFiber$'));
    let fiber = node[key], instance = null, props = null;
    for (let depth = 0; depth < 25 && fiber; depth++) {
      if (fiber.type && fiber.type.name === 'ImageGallery') { instance = fiber.stateNode; props = fiber.memoizedProps; break; }
      fiber = fiber.return;
    }
    if (!instance || !props) return { ok: false, error: 'no_gallery_instance' };
    let removed = 0;
    const cleaned = (props.value || []).map(group => ({ ...group, imageList: (group.imageList || []).filter(image => {
      if (image.uploadStatus === 'uploading') { removed++; return false; }
      return true;
    })}));
    if (removed) props.change(props.id, { props: { value: cleaned } });
    return { ok: true, removed };
  })()`);
}

async function readCompanyAlbumFiles(tabId, album) {
  const value = await evalValue(tabId, `(() => {
    const node = document.querySelector('#companyImage .gallery-names-checkbox-group');
    if (!node) return [];
    const key = Object.keys(node).find(k => k.startsWith('__reactFiber$'));
    let fiber = node[key], instance = null;
    for (let depth = 0; depth < 25 && fiber; depth++) {
      if (fiber.type && fiber.type.name === 'ImageGallery') { instance = fiber.stateNode; break; }
      fiber = fiber.return;
    }
    if (!instance) return [];
    const name = ${JSON.stringify(album)};
    const norm = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const group = (instance.state.valueList || []).find(g => norm(g.cnName) === name);
    if (!group) return [];
    return (group.imageList || []).filter(i => i.fileName).map(i => String(i.fileName).toLowerCase());
  })()`);
  return Array.isArray(value) ? value : [];
}

async function uploadCompanyImages(tabId) {
  return await uploadCompanyImagesLegacy(tabId);
}

async function uploadCompanyImagesLegacy(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!PUBLISH_PAGE.test(tab.url || '')) throw new Error('not_a_publish_page');
  const plan = await api('/company-image-upload-plan');
  const images = ((plan && plan.images) || []).filter(image => image && image.path && image.album);
  const result = { ok: true, tabId, uploaded: [], skipped: [], failed: [], albums: {} };
  if (!images.length) return result;

  const groups = [];
  for (const image of images) {
    let group = groups.find(entry => entry.album === image.album);
    if (!group) {
      group = { album: image.album, albumEn: image.album_en || '', items: [] };
      groups.push(group);
    }
    group.items.push(image);
  }

  await ensureDebugger(tabId);
  await cleanStuckCompanyUploads(tabId);
  for (const group of groups) {
    const stats = result.albums[group.album] = { before: 0, after: 0, uploaded: 0, failed: 0 };
    try {
      const selected = await ensureCompanyAlbumSelected(tabId, group.album, group.albumEn);
      if (!selected || !selected.ok) throw new Error((selected && selected.error) || 'album_select_failed');
      const ready = await waitFor(tabId, `!!(${findCompanyAlbumJs(group.album)})`, 8000, 300);
      if (!ready) throw new Error('album_container_not_found');

      const countExpr = `(() => { const el = ${findCompanyAlbumJs(group.album)}; return el ? el.querySelectorAll('.gallery-item-images img:not(.upload-style-item-icon)').length : 0; })()`;
      const existing = await readCompanyAlbumFiles(tabId, group.album);
      stats.before = existing.length;
      const missing = group.items.filter(image => !existing.includes(image.name.toLowerCase()));
      if (!missing.length) {
        result.skipped.push({ album: group.album, reason: 'album_already_filled' });
        stats.after = stats.before;
        continue;
      }

      for (const image of missing) {
        const before = Number(await evalValue(tabId, countExpr)) || 0;
        try {
          const objectId = await evalObjectId(tabId, `(() => { const el = ${findCompanyAlbumJs(group.album)}; return el ? el.querySelector('input[type=file]') : null; })()`);
          if (!objectId) throw new Error('file_input_not_found');
          await send(tabId, 'DOM.setFileInputFiles', { files: [image.path], objectId });
          const after = await waitFor(tabId, `(() => { const count = ${countExpr}; return count > ${before} ? count : 0; })()`, 180000, 2000);
          if (!after) throw new Error('upload_timeout');
          result.uploaded.push({ album: group.album, name: image.name });
          stats.uploaded++;
        } catch (error) {
          result.failed.push({ album: group.album, name: image.name, error: String((error && error.message) || error) });
          stats.failed++;
        }
      }
      stats.after = Number(await evalValue(tabId, countExpr)) || 0;
    } catch (error) {
      result.failed.push({ album: group.album, error: String((error && error.message) || error) });
    }
  }
  return result;
}

async function send(tabId, method, params) {
  const timeoutMs = method === 'Page.reload' ? 10000 : 20000;
  try {
    return await withTimeout(chrome.debugger.sendCommand({ tabId }, method, params || {}), timeoutMs, method);
  } catch (e) {
    if (String(e).includes('not attached')) {
      attachedTabId = null;
      await ensureDebugger(tabId);
      return await withTimeout(chrome.debugger.sendCommand({ tabId }, method, params || {}), timeoutMs, method);
    }
    throw e;
  }
}

async function handle(cmd) {
  if (cmd.type === 'ping') {
    return { pong: true, at: Date.now(), version: chrome.runtime.getManifest().version };
  }
  if (cmd.type === 'upload_images') {
    const tab = cmd.tabId ? { id: cmd.tabId } : await findTab();
    return await uploadImages(tab.id, cmd.names);
  }
  if (cmd.type === 'mount_company_editors') {
    return await mountCompanyEditors(cmd.tabId);
  }
  if (cmd.type === 'upload_company_images') {
    const tab = cmd.tabId ? { id: cmd.tabId } : await findTab();
    return await uploadCompanyImages(tab.id);
  }
  if (cmd.type === 'list_tabs') {
    const tabs = await chrome.tabs.query({});
    return tabs.map(t => ({
      id: t.id,
      windowId: t.windowId,
      active: t.active,
      url: t.url,
      title: t.title
    }));
  }
  if (cmd.type === 'cdp') {
    const tab = cmd.tabId ? { id: cmd.tabId } : await findTab();
    await ensureDebugger(tab.id);
    return await send(tab.id, cmd.method, cmd.params);
  }
  if (cmd.type === 'detach') {
    if (attachedTabId != null) {
      try { await chrome.debugger.detach({ tabId: attachedTabId }); } catch {}
      attachedTabId = null;
    }
    return { ok: true };
  }
  if (cmd.type === 'reload_extension') {
    setTimeout(() => chrome.runtime.reload(), 800);
    return { ok: true, reloading: true };
  }
  if (cmd.type === 'reload_tab') {
    const tab = cmd.tabId ? { id: cmd.tabId } : await findTab();
    await chrome.tabs.reload(tab.id);
    return { ok: true, tabId: tab.id };
  }
  throw new Error(`Unknown command type: ${cmd.type}`);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return false;
  if (message.type === 'alibaba_upload_images') {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) {
      sendResponse({ ok: false, error: 'no sender tab' });
      return false;
    }
    uploadImages(tabId, message.names).then(
      data => sendResponse({ ok: true, data }),
      error => sendResponse({ ok: false, error: String((error && error.message) || error) })
    );
    return true;
  }
  if (message.type === 'alibaba_mount_company_editors') {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) {
      sendResponse({ ok: false, error: 'no sender tab' });
      return false;
    }
    mountCompanyEditors(tabId).then(
      data => sendResponse({ ok: true, data }),
      error => sendResponse({ ok: false, error: String((error && error.message) || error) })
    );
    return true;
  }
  if (message.type === 'alibaba_upload_company_images') {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) {
      sendResponse({ ok: false, error: 'no sender tab' });
      return false;
    }
    uploadCompanyImages(tabId).then(
      data => sendResponse({ ok: true, data }),
      error => sendResponse({ ok: false, error: String((error && error.message) || error) })
    );
    return true;
  }
  if (message.type !== 'bridge_fetch') return false;
  const requestPath = String(message.path || '');
  if (!requestPath.startsWith('/')) {
    sendResponse({ ok: false, error: 'bad path' });
    return false;
  }
  api(requestPath, message.options || {}).then(
    data => sendResponse({ ok: true, data }),
    error => sendResponse({ ok: false, error: String((error && error.message) || error) })
  );
  return true;
});

async function pollLoop() {
  for (;;) {
    try {
      const cmd = await api('/poll');
      if (!cmd) continue;
      try {
        const result = await handle(cmd);
        await api('/result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: cmd.id, ok: true, result })
        });
      } catch (e) {
        await api('/result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: cmd.id, ok: false, error: String((e && e.message) || e) })
        });
      }
    } catch (e) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

function startPolling() {
  if (polling) return;
  polling = true;
  pollLoop();
}

chrome.alarms.create('keepalive', { periodInMinutes: 1 });
chrome.runtime.onInstalled.addListener(startPolling);
chrome.runtime.onStartup.addListener(startPolling);
chrome.alarms.onAlarm.addListener(startPolling);
chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'keepalive') startPolling();
});
chrome.tabs.onRemoved.addListener(tabId => {
  if (attachedTabId === tabId) attachedTabId = null;
});
chrome.debugger.onDetach.addListener(source => {
  if (source.tabId === attachedTabId) attachedTabId = null;
});

startPolling();
