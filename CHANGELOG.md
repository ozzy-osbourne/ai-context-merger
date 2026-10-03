# Change Log

All notable changes to the **AI Context Merger** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-10-03

### Added
- **1-Click Tree & Extension Hiding:**
  - `aiContextMerger.hideExtension`: Instantly hide all files sharing the target file's extension with a confirmation prompt and quick Undo action.
  - `aiContextMerger.hidePath`: Hide a specific file or folder path directly from the Project Files tree or editor/explorer context menus.
  - `aiContextMerger.unhidePath`: Restore a hidden file or extension directly from the VS Code Explorer context menu.
- **Interactive Exclusion Pattern Manager:**
  - `aiContextMerger.manageExcludedPatterns`: QuickPick palette allowing you to inspect, search, unhide custom patterns, and remove or restore default engine rules.
- **Glob Pattern Support & Negations:**
  - Migrated legacy directory-only rules to wildcard and glob matching (`aiContextMerger.excludePatterns`) supporting `**`, `*`, and `?`.
  - Added support for pattern negations (`!pattern`), enabling users to selectively re-enable built-in default rules (e.g. `!**/*.meta`) via settings or the QuickPick UI.
  - Automatic scope-aware migration of legacy `ignoredDirectoryPatterns` settings.
- **GameDev & 3D Engine Out-of-the-Box Support:**
  - Built-in exclusions for Unity and game engine metadata/cache folders (`**/*.meta`, `**/*.unitypackage`, `Library`, `Logs`, `UserSettings`, `MemoryCaptures`, etc.).
  - Comprehensive media & binary filter expansion for 3D meshes (`.fbx`, `.blend`, `.obj`, `.gltf`, `.glb`, `.dae`, `.3ds`, `.max`, `.c4d`), textures (`.tga`, `.dds`, `.exr`, `.hdr`, `.raw`), compiled shaders (`.spv`, `.dxbc`, `.dxil`), and audio banks (`.bank`, `.bnk`, `.wem`).
- **Customizable Secret Filtering:**
  - Exposed `aiContextMerger.secretPatterns` in user settings to allow custom regex patterns for sensitive files and credentials.

### Fixed
- Fixed pattern resolution in multi-package workspaces and monorepos by using root-relative path matching instead of greedy recursive prefixes.
- Fixed exclusion manager where selecting default rules failed to remove them due to hardcoded arrays.
- Fixed exclusion manager dialog hiding default rules when at least one custom rule was active.
- Fixed settings migration race condition between global and workspace scopes.

---

## [1.0.0] - 2026-09-18

### Initial Production Release 🎉

First official public release of **AI Context Merger** - a fast, secure, and intuitive tool to assemble workspace files, Git changes, and diagnostics into clean prompts for LLMs (Claude, ChatGPT, DeepSeek, Gemini).

#### Added
- **Dual Output Formats:**
  - Standard **Markdown** with collision-proof dynamic code fences (` ```` `).
  - Official Anthropic **XML** schema with isolated `<![CDATA[...]]>` blocks and entity escaping.
- **Visual Project Structure:**
  - Automatic ASCII folder tree generation with Git status indicators (`[M]`, `[U]`, `[D]`, `[R]`).
- **Interactive File Selection:**
  - Native VS Code TreeView with custom selection counters (`X/Y selected`).
  - **1-Click Open Tabs:** Instantly select all active editor files.
  - **1-Click Git Changes:** Pick modified, untracked, and deleted working tree files.
  - Live debounced search with bulk-selection of matching files.
- **Git Diff & Code Review Mode:**
  - Integrated Git unified diffs with synthetic diffs for newly created untracked files.
  - *Diff Only* toggle: Send only project structure and diffs without full file source code.
  - Truncation limit protection against context bloat with *Unlimited Diff* option.
- **Problems & Diagnostics Integration:**
  - Option to include active compiler errors (TypeScript, rustc, clang, mypy) and linter warnings (ESLint, Biome, Ruff) with line/col references.
- **Token Budget Counter:**
  - Real-time character and token estimation (`~chars / 4`).
  - Adaptive progress bar for 32k, 64k, 128k, 200k, 1M, and 2M context windows with overflow warnings.
- **Built-in & Custom Prompts:**
  - 8 built-in task presets: *Bugs, Refactor, Tests, Docs, Fix, PR Review, Feature, Explain*.
  - Full CRUD support for custom user presets synchronized via VS Code Settings Sync.
- **Security & Smart Filtering:**
  - Automatic exclusion of secrets (`.env`, `*.pem`, `*.key`, `id_rsa`, `credentials.json`).
  - Automatic filtering of lockfiles, source maps (`*.map`), and compiled/binary files.
  - Deep binary magic-bytes detection and mojibake/encoding recovery (Windows-1251, CP866, UTF-16).
  - Symlink loop guard preventing directory traversal attacks.
  - 100% offline execution with zero external network requests and zero telemetry.
- **Full Internationalization (i18n):**
  - Complete native localization for 7 languages: EN, RU, ZH-CN, ES, PT-BR, JA, DE.