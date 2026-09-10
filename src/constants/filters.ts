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
  '.docusaurus',
  '.vite',
  '.swc',

  // Infrastructure tools & providers
  '.terraform',

  // Python environments and caches
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.venv',
  'venv',
  'env',

  // Compiled languages, package vendors & build tools (Rust, Go, PHP, Java, Gradle, Dart)
  'target',
  'vendor',
  '.gradle',
  '.dart_tool',

  // Unity project caches and builds
  'Library',
  'Temp',
  'Obj',
  'Build',
  'Builds',
  'Logs',
  'UserSettings',
  'MemoryCaptures',

  // Test coverage & temporary caches
  'coverage',
  '.nyc_output',
  '.cache',

  // OS system artifacts
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini'
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
  'bun.lockb',
  'bun.lock',
  'Gemfile.lock',
  'uv.lock',
  'pdm.lock',
  'go.sum',
  'pubspec.lock',
  'Podfile.lock',
  'packages.lock.json',
  'flake.lock'
]);

/**
 * Patterns matching sensitive configuration files, keys, certificates, and credentials.
 */
const SECRET_NAME_PATTERNS: readonly RegExp[] = [
  // Environment variable files (.env, .env.local, .env.production, .envrc, etc., excluding templates/examples)
  /^\.env(?!\.(example|sample|template|dist|test))(\..+)?$/i,
  /^\.envrc$/i,

  // Certificates, private/public keys, keystores, and GPG/PGP keys
  /\.(pem|key|cert|crt|cer|der|csr|p8|p12|pfx|pkcs12|keystore|jks|gpg|asc|sig)$/i,
  /^key\.properties$/i,

  // SSH private and public identity key files
  /^id_(rsa|ed25519|ecdsa|dsa)(_sk)?(\..+)?$/i,

  // Terraform states, backups, and variables files (including JSON format)
  /(\.|\.auto\.)(tfvars|tfstate)(\.backup|\.json)?$/i,

  // API clients environments (Postman, Insomnia) containing active tokens & passwords
  /postman_(environment|globals).*\.json$/i,
  /insomnia.*\.json$/i,

  // Cloud, auth tokens, package managers, and service account secrets
  /^(client_secret|credentials)(\..+)?\.json$/i,
  /^service[-_]account.*\.json$/i,
  /^\.?(npmrc|pypirc|netrc|dockercfg)$/i,
  /^\.yarnrc\.ya?ml$/i,
  /^auth\.json$/i,
  /^\.?htpasswd$/i,
  /^\.git-credentials$/i,
  /^secring\.gpg$/i,
  /^master\.key$/i
];

/**
 * Checks whether a given filename matches known secret, key, or credential patterns.
 *
 * @param fileName - Base name of the file.
 * @returns `true` if the file is recognized as sensitive.
 */
export function isSecretFile(fileName: string): boolean {
  return SECRET_NAME_PATTERNS.some((pattern) => pattern.test(fileName));
}

/**
 * Checks whether a file is a source map or minified/bundled code artifact.
 *
 * @param fileName - Base name of the file.
 * @returns `true` if the file matches source map or minified code patterns.
 */
export function isMinifiedOrSourceMap(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return (
    lower.endsWith('.map') ||
    lower.endsWith('.min.js') ||
    lower.endsWith('.min.mjs') ||
    lower.endsWith('.min.cjs') ||
    lower.endsWith('.min.css') ||
    lower.endsWith('.min.svg') ||
    lower.endsWith('.bundle.js') ||
    lower.endsWith('.bundle.mjs') ||
    lower.endsWith('.bundle.cjs') ||
    lower.endsWith('.bundle.css') ||
    lower.endsWith('.chunk.js') ||
    lower.endsWith('.chunk.css')
  );
}

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

/**
 * Maximum allowable file size in bytes (5 MB). Files exceeding this limit are skipped to preserve context and memory.
 */
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;