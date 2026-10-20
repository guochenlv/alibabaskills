# Alibaba Local Bridge

Minimal local-only Edge extension used to inspect and operate the current Alibaba tab from Codex.

## Load

1. Open `edge://extensions` in the Edge profile that is logged in to Alibaba.
2. Enable `Developer mode`.
3. Click `Load unpacked` and select this folder.
4. Refresh the Alibaba publish tab once so the keepalive content script is injected.

The extension connects only to `http://127.0.0.1:8765`.

## Panel

Version 0.7 injects a floating panel on Alibaba pages. It loads the draft and company config through the extension background, so the page itself never calls localhost directly.

## Offline mode

When the local bridge (`node bridge-server.js`) is not running, the extension automatically falls back to the bundled files in `offline/`:

- `offline/product-draft.json`
- `offline/plugin-config.json`

Text fields (title, attributes, company description, FAQ) can still be filled without the bridge. Image upload is disabled in offline mode because the extension has no access to local image files; upload images manually. When the bridge is running again, the extension uses it automatically.

## Package

```powershell
pwsh -NoProfile -File scripts\package-extension.ps1
```

This copies the extension plus the latest `output/product-draft.json` and `output/plugin-config.json` into `dist/alibaba-local-bridge-v<VERSION>\` and zips it to `dist/alibaba-local-bridge-v<VERSION>.zip`. Unzip and load the folder in `edge://extensions` with Developer mode enabled.

- Draft: `output/product-draft.json`
- Company config: `output/plugin-config.json` (company name, company description, FAQs, brand and publish defaults)
- Bridge: `node bridge-server.js` must be running
- Fill mode: only empty fields by default
- Company info: fills `#struct-companyDesc` and creates/fills company FAQ rows on the new publish page
- Lazy editors: Alibaba mounts the company description, FAQ and selling-point editors only after an `appeared` state flips; the background force-mounts them in the page's MAIN world, so no manual scrolling is required
- Images: scans the main-image list, skips existing files, and uploads missing draft images through the debugger API
- Image identity: matches the real `.image-fileName` title first and falls back to the thumbnail URL
- Company gallery: uploads `company_images` from `output/plugin-config.json` into the 公司介绍/公司优势/参展情况/包装运输 albums on the publish page
- Company image import: select an album and multiple PNG/JPG files in the company configuration panel; the images are saved to `images/company/`, added to `company_images`, and then uploaded with the company-gallery button. The local bridge must be running
- Save and publish: never clicked by the panel

Note: the Alibaba company-gallery uploader is flaky. Some images may stay stuck on the page even after the panel reports a timeout. Refreshing the publish page and running the company-gallery upload again is the workaround; the panel never saves or publishes.

After changing extension files, use the reload button on `edge://extensions` and refresh the Alibaba tab once.
