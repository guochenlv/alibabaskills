# Repository Guidelines

## Project Structure & Module Organization

- `skills/alibaba-product-draft/`: Codex skill that converts product images into `output/product-draft.json`, including schemas and image/build/validation scripts.
- `edge-bridge/`: Manifest V3 Edge extension. `background.js` handles bridge/debugger access; `content.js` and `panel.js` provide the fill panel; `offline/` stores fallback data.
- `bridge-server.js`: local-only HTTP bridge on `127.0.0.1:8765`.
- `scripts/`: draft build wrapper plus PowerShell packagers for the skill and extension.
- `产品/`, `images/`, `output/`, and `dist/`: runtime inputs and generated artifacts, intentionally ignored by Git.

## Build, Test, and Development Commands

Requires Node.js 18+ and PowerShell 7. Install `sharp` with `npm install`.

```powershell
node skills\alibaba-product-draft\scripts\prepare-images.js --root .
node skills\alibaba-product-draft\scripts\build-draft.js --root .
node skills\alibaba-product-draft\scripts\validate-draft.js --root .
node bridge-server.js
pwsh -NoProfile -File scripts\package-extension.ps1
pwsh -NoProfile -File scripts\package-skill.ps1
```

Preparation writes normalized PNGs to `images/`; build creates drafts in `output/`; validation checks required fields, title length, image references, and unsafe HTML. Load `edge-bridge/` through `edge://extensions`, and package ZIP files into `dist/`.

## Coding Style & Naming Conventions

- Use two-space indentation, semicolons, single quotes, and strict-mode CommonJS (`'use strict';`) in Node and extension JavaScript.
- Use `camelCase` for variables/functions, `kebab-case` for script filenames, and `snake_case` for JSON fields.
- Keep scripts dependency-light and Windows-compatible; preserve PowerShell safety checks around `dist/`.
- No formatter or linter is configured. Match surrounding code and rely on `validate-draft.js` for draft integrity.

## Testing Guidelines

There is no automated test framework or coverage target. After changing draft logic, run the full prepare/build/validate sequence and confirm `ok: true`. For extension changes, reload it, refresh the Alibaba tab, and test with the bridge running and stopped. Verify that only empty fields are filled and the panel never clicks Save or Publish.

## Commit & Pull Request Guidelines

Use short, imperative, sentence-case subjects such as `Add selling points fill...`; omit Conventional Commit prefixes and keep commits focused. Pull requests should describe the behavior change, list validation/manual checks, link related issues, and screenshot visible panel changes. Never commit product images, generated drafts, logs, credentials, or `dist/`.

## Security & Operational Constraints

Do not automate login, captchas, category selection, saving, or publishing. Keep the bridge on localhost, never embed secrets or company data in generated copy, and retain `{{company.*}}` placeholders for the panel. Put unknown or business-sensitive facts in `missing`.
