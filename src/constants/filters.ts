/**
 * Directories and metadata files that are unconditionally excluded from scanning.
 */
export const ALWAYS_IGNORED: ReadonlySet<string> = new Set([
  // VCS and IDE metadata
  '.git',
  '.vscode',
  '.idea',

  // Package managers & Web build artifacts
  'node_modules',
  'dist',
  'out',
  'build',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.astro',
  '.turbo',
  '.parcel-cache',

  // Python environments and caches
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.tox',
  '.venv',
  'venv',
  'env',

  // Compiled languages & build tools (Rust, Java, Gradle)
  'target',
  '.gradle',

  // Test coverage & temporary caches
  'coverage',
  '.nyc_output',
  '.cache',

  // OS system artifacts
  '.DS_Store',
  'Thumbs.db'
]);

/**
 * Known package manager lockfile names.
 */
export const LOCK_FILE_NAMES: ReadonlySet<string> = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Cargo.lock',
  'composer.lock',
  'poetry.lock',
  'Pipfile.lock',
  'bun.lockb'
]);

/**
 * File extensions recognized as binary, compiled, or non-text media.
 */
export const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  // Bytecode and compiled scripts
  '.rpyc', '.rpym', '.rpymc', '.rpyb', '.rpa', '.save', '.pyc', '.pyo', '.pyd', '.class',

  // Executables, binaries, and shared libraries
  '.exe', '.dll', '.so', '.dylib', '.wasm', '.o', '.obj', '.bin', '.hex',

  // Images and graphic media
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg', '.bmp', '.tiff', '.psd', '.ai',

  // Audio and video media
  '.mp3', '.wav', '.ogg', '.flac', '.aac', '.mp4', '.avi', '.webm', '.mkv', '.mov', '.wmv',

  // Archives and distribution packages
  '.zip', '.tar', '.gz', '.tgz', '.rar', '.7z', '.bz2', '.xz', '.jar', '.war', '.apk', '.ipa',

  // Documents, spreadsheets, and fonts
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',

  // Databases and cache stores
  '.sqlite', '.sqlite3', '.db', '.dat', '.cache'
]);

/**
 * Maximum token budget threshold for context estimation.
 */
export const MAX_CONTEXT_TOKENS = 200000;