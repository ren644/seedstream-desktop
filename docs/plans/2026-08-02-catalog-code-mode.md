# Catalog Code Recognition Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an opt-in local catalog-code recognition mode that expands bounded query variants and promotes exact title matches without changing configured search sources.

**Architecture:** A pure shared module parses and normalizes catalog codes for both renderer previews and main-process validation. `SearchService` accepts the existing string request or a structured mode request, executes at most three variants per enabled source, deduplicates the combined results, and annotates exact matches for rendering.

**Tech Stack:** Electron 43, Node.js ESM, vanilla HTML/CSS/JavaScript, `node:test`, electron-builder.

---

### Task 1: Shared catalog-code parser

**Files:**
- Create: `src/shared/catalog-code.mjs`
- Create: `test/catalog-code.test.mjs`

**Step 1: Write the failing parser tests**

Cover `SSIS-123`, `SSIS123`, full-width digits, `FC2 PPV 1234567`, `259LUXU1234`, invalid prose, URL, magnet, pure digits, and the three-variant maximum.

**Step 2: Run the focused test and verify it fails**

Run: `node --test test/catalog-code.test.mjs`

Expected: FAIL because `src/shared/catalog-code.mjs` does not exist.

**Step 3: Implement the minimal pure parser**

Export `parseCatalogCode`, `catalogCodePreview`, and `catalogCodeMatchLevel`. Normalize with NFKC, restrict accepted characters and length, build a canonical form, and return at most three unique query variants.

**Step 4: Run the focused test and verify it passes**

Run: `node --test test/catalog-code.test.mjs`

Expected: all parser tests PASS.

### Task 2: Search request contract and result ranking

**Files:**
- Modify: `src/core/search-contract.mjs`
- Modify: `src/core/search-results.mjs`
- Modify: `test/search-contract.test.mjs`
- Modify: `test/search-providers.test.mjs`

**Step 1: Write failing contract and ranking tests**

Assert that legacy string input produces standard mode, structured catalog mode returns canonical query variants, invalid mode is rejected, and exact catalog matches rank before high-availability loose results.

**Step 2: Run focused tests and verify they fail**

Run: `node --test test/search-contract.test.mjs test/search-providers.test.mjs`

Expected: FAIL on missing structured request and catalog ranking behavior.

**Step 3: Implement request normalization and match-aware ranking**

Add `normalizeSearchRequest(input)` while retaining `normalizeSearchQuery(value)`. Extend `rankSearchResults(input, options)` to attach `catalogMatch` and compare match level before availability when a catalog code is present.

**Step 4: Run focused tests and verify they pass**

Run: `node --test test/search-contract.test.mjs test/search-providers.test.mjs`

Expected: all focused tests PASS.

### Task 3: Bounded multi-variant service search

**Files:**
- Modify: `src/core/search-service.mjs`
- Modify: `test/search-service.test.mjs`

**Step 1: Write the failing service test**

Use a local Torznab fixture to record the query strings, return overlapping results, and assert three bounded variants, one merged result set, the canonical response fields, and exact-match promotion.

**Step 2: Run the service test and verify it fails**

Run: `node --test test/search-service.test.mjs`

Expected: FAIL because catalog requests are not accepted.

**Step 3: Implement variant execution and response metadata**

Normalize the request in `SearchService.search`, execute the generated variants for each source, flatten results, retain per-source failure isolation, rank by catalog match, and expose only `mode`, `catalogCode`, and a boolean `catalogMatch` to the renderer.

**Step 4: Run the service test and verify it passes**

Run: `node --test test/search-service.test.mjs`

Expected: all service tests PASS.

### Task 4: Recognition-mode interface

**Files:**
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/styles.css`
- Modify: `src/renderer/app.js`
- Modify: `src/renderer/search-ui.mjs`
- Modify: `test/renderer-helpers.test.mjs`

**Step 1: Write failing renderer-helper tests**

Assert preview states for recognized, unrecognized and disabled input, plus recommended sorting that promotes `catalogMatch` results.

**Step 2: Run the renderer test and verify it fails**

Run: `node --test test/renderer-helpers.test.mjs`

Expected: FAIL because recognition preview helpers do not exist.

**Step 3: Implement the opt-in UI**

Add a compact industrial-style toggle and live status line below the aggregate input. Send a structured search request when enabled, map invalid-code errors to Chinese, show a “番号精确” chip on exact results, and keep all existing tabs and keyboard behavior intact.

**Step 4: Run the renderer test and verify it passes**

Run: `node --test test/renderer-helpers.test.mjs`

Expected: all renderer-helper tests PASS.

### Task 5: Release documentation and regression verification

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `README.md`
- Modify: `help/SeedStream-使用指南.html`
- Modify: `scripts/smoke-test.mjs`
- Create: `docs/releases/v0.2.1.md`

**Step 1: Bump the application version to 0.2.1**

Update package metadata, lockfile metadata, and the smoke-test version assertion.

**Step 2: Document the recognition mode**

Add neutral instructions that explain the toggle, supported formats, exact-match ordering, and the fact that results depend on configured sources.

**Step 3: Run all automated verification**

Run: `pnpm test && pnpm smoke`

Expected: all tests PASS and smoke reports a successful loopback playback check and Electron launch.

**Step 4: Inspect the real Electron interface**

Launch a clean test profile, open the search center, toggle recognition mode, verify valid and invalid previews, submit a local fixture-backed search if available, and confirm no layout regression at the normal window size.

### Task 6: Package, install and publish

**Files:**
- Generated: `dist/SeedStream-0.2.1-mac-arm64.dmg`
- Generated: `dist/SeedStream-0.2.1-mac-arm64.zip`
- Generated: `dist/SeedStream-0.2.1-windows-x64-setup.exe`
- Generated: `dist/SeedStream-0.2.1-windows-x64-portable.exe`
- Generated: `dist/SHA256SUMS.txt`

**Step 1: Build macOS and Windows artifacts**

Run: `pnpm pack:mac && pnpm pack:win`

Expected: all four versioned artifacts and checksums exist.

**Step 2: Install and launch the macOS build**

Back up the installed 0.2.0 app, replace it with the 0.2.1 packaged app, launch it, and verify the displayed version and recognition-mode controls.

**Step 3: Commit and publish the release**

Commit the implementation, push the feature commit to `main`, tag `v0.2.1`, create the GitHub release with the release notes and artifacts, and verify the public URLs.

**Step 4: Update the Feishu tool catalog**

Update the existing SeedStream record to v0.2.1 with the latest release and repository links, then read the record back to verify the change.

