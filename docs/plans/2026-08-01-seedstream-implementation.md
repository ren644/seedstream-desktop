# SeedStream Desktop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a secure macOS and Windows Electron desktop app that streams videos from local `.torrent` metadata and performs resumable permanent torrent downloads.

**Architecture:** A sandboxed local renderer calls a narrow preload bridge. The Electron main process owns WebTorrent, storage, persistence, cache cleanup, and a loopback-only range streaming server. A pure state policy keeps ephemeral playback data separate from permanent downloads.

**Tech Stack:** Electron, WebTorrent, parse-torrent, vanilla HTML/CSS/JavaScript, Node test runner, electron-builder.

---

### Task 1: Scaffold and pure domain rules

**Files:**
- Create: `seedstream-desktop/package.json`
- Create: `seedstream-desktop/src/core/media.mjs`
- Create: `seedstream-desktop/src/core/path-safety.mjs`
- Create: `seedstream-desktop/src/core/task-policy.mjs`
- Test: `seedstream-desktop/test/core-rules.test.mjs`

**Steps:**
1. Write failing tests for supported video extensions, safe relative torrent paths, duplicate-safe IDs, and the Ready/Streaming/Downloading/Paused transitions.
2. Run `npm test` and confirm the missing-module failures.
3. Implement only the pure helpers required by the tests.
4. Run `npm test` and confirm all core-rule tests pass.

### Task 2: Atomic persistence and bounded cache cleanup

**Files:**
- Create: `seedstream-desktop/src/core/task-store.mjs`
- Create: `seedstream-desktop/src/core/cache-manager.mjs`
- Test: `seedstream-desktop/test/storage.test.mjs`

**Steps:**
1. Write failing tests proving only persistent/paused tasks survive serialization and cleanup refuses paths outside its owned root.
2. Implement atomic JSON writes with a temporary sibling file and rename.
3. Implement startup cache sweeping and per-task cleanup using resolved-path containment checks.
4. Run the storage tests, including paths containing spaces and Windows-style separators.

### Task 3: Torrent engine and streaming server

**Files:**
- Create: `seedstream-desktop/src/core/torrent-engine.mjs`
- Test: `seedstream-desktop/test/torrent-engine.test.mjs`

**Steps:**
1. Create a tiny legal local fixture torrent during the test and verify metadata import returns its info hash and file list.
2. Add duplicate rejection and unsafe path rejection tests.
3. Implement idle metadata import, ephemeral streaming, permanent downloading, pause-by-remove, resume-by-re-add, and remove-without-file-deletion.
4. Bind WebTorrent's range server to `127.0.0.1` with a random base path and expose a stream URL only for files belonging to an imported task.
5. Test lifecycle behavior with a fake WebTorrent client and run a real local metadata integration test.

### Task 4: Secure Electron shell and cross-platform file opening

**Files:**
- Create: `seedstream-desktop/src/main.mjs`
- Create: `seedstream-desktop/src/preload.cjs`
- Create: `seedstream-desktop/src/ipc-contract.mjs`
- Test: `seedstream-desktop/test/ipc-contract.test.mjs`

**Steps:**
1. Write tests for IPC argument validation and `.torrent` command-line extraction on macOS and Windows paths.
2. Configure `BrowserWindow` with `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, a restrictive CSP, blocked navigation, and blocked popup creation.
3. Expose one preload function per allowed action instead of exposing raw IPC.
4. Handle native file dialogs, macOS `open-file`, Windows `second-instance`, download-folder selection, notifications, and reveal-in-folder.
5. Validate every IPC sender and argument before filesystem or torrent operations.

### Task 5: Minimal desktop UI

**Files:**
- Create: `seedstream-desktop/src/renderer/index.html`
- Create: `seedstream-desktop/src/renderer/styles.css`
- Create: `seedstream-desktop/src/renderer/app.js`
- Test: `seedstream-desktop/test/renderer-helpers.test.mjs`

**Steps:**
1. Write tests for byte, speed, ETA, and status formatting.
2. Implement open/drop zones, task cards, expandable file lists, Play, Download, Pause/Resume, Reveal, and Remove actions.
3. Add an in-window video player with buffering and codec-error states plus an explicit close action that triggers ephemeral cache cleanup.
4. Poll lightweight task snapshots once per second and stop polling when the window unloads.
5. Verify keyboard focus, labels, empty states, long filenames, and narrow window layout.

### Task 6: Packaging, documentation, and end-to-end verification

**Files:**
- Modify: `seedstream-desktop/package.json`
- Create: `seedstream-desktop/README.md`
- Create: `seedstream-desktop/scripts/smoke-test.mjs`

**Steps:**
1. Configure electron-builder for macOS DMG/ZIP and Windows NSIS/portable targets with `.torrent` file associations.
2. Document development, test, packaging, cache, download, codec, signing, and legal-use behavior.
3. Run `npm test`, `npm run smoke`, and `npm run pack:mac` on macOS.
4. Inspect the packaged `.app`, launch it, import a locally generated torrent, open the player, close it, and verify cache removal.
5. Run `npm run pack:win` on a Windows machine or CI runner and repeat the same smoke flow before distributing the EXE.

