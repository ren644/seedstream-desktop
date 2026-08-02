# SeedStream Search Center Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Add private aggregated torrent search, isolated web capture, and magnet-link import to SeedStream on macOS and Windows.

**Architecture:** Keep all network access and secrets in Electron's main process. A provider-based `SearchService` normalizes Internet Archive and Torznab results, while a sandboxed search window captures user-initiated magnet and `.torrent` navigation and reuses the existing torrent import pipeline.

**Tech Stack:** Electron 43, Node.js 22, vanilla HTML/CSS/JavaScript, WebTorrent, Node test runner, fast-xml-parser.

---

### Task 1: Search contracts and validation

**Files:**
- Create: `src/core/search-contract.mjs`
- Modify: `src/ipc-contract.mjs`
- Test: `test/search-contract.test.mjs`
- Test: `test/ipc-contract.test.mjs`

**Steps:**

1. Write failing tests for query trimming/limits, HTTP(S) endpoint validation, magnet URI validation, provider configuration normalization, and search result import tokens.
2. Run `node --test test/search-contract.test.mjs test/ipc-contract.test.mjs` and confirm the new exports are missing.
3. Implement pure validators and add search IPC channel names.
4. Run the focused tests and confirm they pass.
5. Commit with `test: define search center contracts`.

### Task 2: Provider parsing, deduplication, and ranking

**Files:**
- Create: `src/core/search-providers.mjs`
- Create: `src/core/search-results.mjs`
- Test: `test/search-providers.test.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Steps:**

1. Add `fast-xml-parser` and write fixtures in tests for Torznab RSS and Internet Archive JSON.
2. Write failing tests for normalized fields, info-hash extraction, duplicate merging, deterministic ranking, and partial provider errors.
3. Implement `parseTorznabFeed`, `mapArchiveResults`, `mergeSearchResults`, and `rankSearchResults` without network access.
4. Run `node --test test/search-providers.test.mjs`.
5. Commit with `feat: normalize aggregated search results`.

### Task 3: Search configuration and network service

**Files:**
- Create: `src/core/search-config-store.mjs`
- Create: `src/core/search-service.mjs`
- Test: `test/search-service.test.mjs`

**Steps:**

1. Write failing tests using a local HTTP server for Archive-style JSON, Torznab XML, timeout, oversized response, invalid content type, and one-provider failure.
2. Implement encrypted-at-rest provider configuration via injected encryption helpers so tests stay platform-independent.
3. Implement provider fan-out with `AbortSignal.timeout(15000)`, byte limits, source health reporting, and result-token creation that never exposes API keys to the renderer.
4. Run the focused test and verify partial results survive individual failures.
5. Commit with `feat: add private search provider service`.

### Task 4: Magnet and remote torrent import

**Files:**
- Modify: `src/core/torrent-engine.mjs`
- Modify: `src/core/task-store.mjs`
- Modify: `src/main.mjs`
- Test: `test/torrent-engine.test.mjs`
- Test: `test/storage.test.mjs`

**Steps:**

1. Write failing tests for magnet import, duplicate magnets, persisted magnet tasks, and remote torrent buffer import.
2. Extend `TorrentEngine` to parse a validated magnet URI and obtain metadata through WebTorrent while preserving the current task policy.
3. Persist a sanitized magnet source without storing tracker credentials or search-provider secrets.
4. Add main-process handlers that import only result tokens issued by `SearchService`.
5. Run the focused tests, then commit with `feat: import magnets and remote search results`.

### Task 5: Sandboxed web capture

**Files:**
- Create: `src/core/search-browser.mjs`
- Modify: `src/main.mjs`
- Test: `test/search-browser.test.mjs`

**Steps:**

1. Write tests for allowed HTTP navigation, blocked `file:`/`javascript:` navigation, magnet capture, `.torrent` download classification, popup handling, and temporary-file cleanup.
2. Implement the isolated BrowserWindow/session with no preload, no Node integration, sandboxing, popup redirection into the same controlled window, and event callbacks to the main process.
3. Use the isolated session for authenticated `.torrent` fetches, enforcing the same byte and timeout limits.
4. Add clear-browsing-data support and shutdown cleanup.
5. Run the focused tests and commit with `feat: add isolated search browser capture`.

### Task 6: Renderer bridge and search-center interface

**Files:**
- Modify: `src/preload.cjs`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/app.js`
- Modify: `src/renderer/styles.css`
- Test: `test/renderer-helpers.test.mjs`
- Test: `test/ipc-contract.test.mjs`

**Steps:**

1. Add bridge-contract tests and pure renderer tests for result labels, source health, sort choices, magnet input state, and button availability.
2. Add a top-bar “搜索资源” entry and an industrial-console drawer with 聚合搜索、网页捕获、磁力链接、搜索源设置 tabs.
3. Implement loading, empty, partial-failure, error and success states; keep keyboard focus trapped while the drawer is open and restore focus on close.
4. Display source, size, nodes, date and a cautious speed-likelihood label. Import creates a task but never auto-starts transfer.
5. Run renderer/IPC tests and `pnpm smoke`, visually inspect the full UI, then commit with `feat: integrate private torrent search center`.

### Task 7: Documentation, version, and full verification

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `help/SeedStream-使用指南.html`
- Modify: `help/首次打开说明.txt`
- Create: `docs/releases/v0.2.0.md`
- Modify: `scripts/smoke-test.mjs`

**Steps:**

1. Update user guidance for search sources, API-key privacy, web capture, magnet links and rights confirmation.
2. Bump the application to `0.2.0` and update smoke expectations.
3. Run `pnpm test`, `pnpm smoke`, `pnpm pack:mac`, and `pnpm pack:win` where the host supports the target.
4. Install or launch the macOS artifact with isolated user data and verify search drawer, Archive query, magnet import, web capture, playback handoff, browsing-data cleanup, window maximize and video fullscreen.
5. Commit with `release: prepare SeedStream v0.2.0`.

### Task 8: Publish and workspace catalog update

**Files:**
- No source files unless release verification finds a defect.

**Steps:**

1. Confirm the branch contains none of the canceled fullscreen-design commits and that the working tree is clean.
2. Push the tested commits to GitHub `main`, tag `v0.2.0`, create the release, and upload macOS/Windows artifacts, checksums and guides.
3. Verify every public release URL and asset.
4. Update the existing SeedStream record in 飞书「金三工作台 → 工具库」to `v0.2.0`, including the new search description and release link.
5. Read the Feishu record back and report the GitHub and Feishu links.
