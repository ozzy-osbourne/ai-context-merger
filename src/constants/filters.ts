import * as vscode from 'vscode';
import { PathUtils } from '../utils/pathUtils';

/**
 * Default fallback directories and metadata files that are unconditionally excluded from scanning.
 */
export const DEFAULT_IGNORED_DIRECTORIES: readonly string[] = [
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

  // Unity & Game Engine caches, builds, and metadata
  'Library',
  'Temp',
  'Obj',
  'Build',
  'Builds',
  'Logs',
  'UserSettings',
  'MemoryCaptures',
  '**/*.meta',
  '**/*.unitypackage',

  // Test coverage & temporary caches
  'coverage',
  '.nyc_output',
  '.cache',

  // OS system artifacts
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini'
];

/**
 * Backward compatibility alias for default ignored patterns.
 */
export const ALWAYS_IGNORED = new Set(DEFAULT_IGNORED_DIRECTORIES);

/**
 * Internal descriptor storing partitioned exclusion rules for fast evaluation.
 */
export interface ResolvedExclusionRules {
  readonly exactNames: ReadonlySet<string>;
  readonly globs: readonly { readonly pattern: string; readonly regex: RegExp }[];
  readonly allPatterns: readonly string[];
}

// In-memory caches to eliminate synchronous configuration query overhead
let cachedExcludePatterns: readonly string[] | null = null;
let cachedResolvedExclusions: ResolvedExclusionRules | null = null;
let cachedLockFilesSet: ReadonlySet<string> | null = null;
let cachedBinaryExtensionsSet: ReadonlySet<string> | null = null;
let cachedSecretRegexes: readonly RegExp[] | null = null;
let configWatcherInitialized = false;

/**
 * Attaches a configuration change listener to automatically purge filter caches upon settings mutation.
 */
function ensureConfigWatcher(): void {
  if (configWatcherInitialized) {
    return;
  }
  try {
    if (typeof vscode !== 'undefined' && vscode.workspace && typeof vscode.workspace.onDidChangeConfiguration === 'function') {
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('aiContextMerger')) {
          invalidateFilterCaches();
        }
      });
      configWatcherInitialized = true;
    }
  } catch {
    // Ignore in headless test runner
  }
}

/**
 * Invalidates all in-memory filter caches and precompiled glob regular expressions.
 * Must be invoked whenever exclusion settings or patterns are added, removed, or modified.
 */
export function invalidateFilterCaches(): void {
  cachedExcludePatterns = null;
  cachedResolvedExclusions = null;
  cachedLockFilesSet = null;
  cachedBinaryExtensionsSet = null;
  cachedSecretRegexes = null;
  PathUtils.clearGlobCache();
}

/**
 * Resolves active exclusion glob patterns, respecting both Workspace and Global user settings.
 * Supports custom pattern additions as well as explicit removals/negations (via '!' prefix)
 * of default built-in directories and files. Employs caching for blazing fast repeated lookups.
 *
 * @returns Array of active glob patterns.
 */
export function getExcludePatterns(): readonly string[] {
  if (cachedExcludePatterns) {
    return cachedExcludePatterns;
  }

  ensureConfigWatcher();

  try {
    const config = vscode.workspace.getConfiguration('aiContextMerger');
    const inspected = config.inspect<string[]>('excludePatterns');

    const workspacePatterns = inspected?.workspaceValue || [];
    const globalPatterns = inspected?.globalValue || [];
    const customPatterns = Array.from(new Set([...globalPatterns, ...workspacePatterns]));

    const negations = new Set<string>();
    const additions: string[] = [];

    for (const p of customPatterns) {
      const trimmed = p.trim();
      if (trimmed.startsWith('!')) {
        negations.add(trimmed.slice(1).trim().toLowerCase());
      } else if (trimmed.length > 0) {
        additions.push(trimmed);
      }
    }

    // Retain default directories unless explicitly negated by user
    const activeDefaults = DEFAULT_IGNORED_DIRECTORIES.filter(
      (d) => !negations.has(d.toLowerCase())
    );

    cachedExcludePatterns = Array.from(new Set([...activeDefaults, ...additions]));
    return cachedExcludePatterns;
  } catch {
    // Fall back to built-in default if settings are not available in test runner
  }

  cachedExcludePatterns = DEFAULT_IGNORED_DIRECTORIES;
  return cachedExcludePatterns;
}

/**
 * Partitions active exclusion patterns into a fast O(1) Set of exact segment names
 * and an array of precompiled regular expressions for wildcard globs.
 *
 * @returns Cached ResolvedExclusionRules descriptor.
 */
export function getResolvedExclusionRules(): ResolvedExclusionRules {
  if (cachedResolvedExclusions) {
    return cachedResolvedExclusions;
  }

  const allPatterns = getExcludePatterns();
  const exactNames = new Set<string>();
  const globs: Array<{ pattern: string; regex: RegExp }> = [];

  for (const pattern of allPatterns) {
    const trimmed = pattern.trim();
    if (!trimmed) {
      continue;
    }

    // Bare names without path separators or wildcard characters go to high-speed Set
    if (!trimmed.includes('/') && !trimmed.includes('\\') && !trimmed.includes('*') && !trimmed.includes('?')) {
      exactNames.add(trimmed.toLowerCase());
    } else {
      globs.push({
        pattern: trimmed,
        regex: PathUtils.globToRegex(trimmed)
      });
    }
  }

  cachedResolvedExclusions = {
    exactNames,
    globs,
    allPatterns
  };

  return cachedResolvedExclusions;
}

/**
 * Known default package manager lockfile names.
 */
export const DEFAULT_LOCK_FILE_NAMES: ReadonlySet<string> = new Set([
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
 * Backward compatibility alias for lock files list.
 */
export const LOCK_FILE_NAMES = DEFAULT_LOCK_FILE_NAMES;

/**
 * Resolves active lock file set with memory caching.
 *
 * @returns Set of lock file names.
 */
export function getLockFilesSet(): ReadonlySet<string> {
  if (cachedLockFilesSet) {
    return cachedLockFilesSet;
  }

  ensureConfigWatcher();

  try {
    const config = vscode.workspace.getConfiguration('aiContextMerger');
    const configuredPatterns = config.get<string[]>('lockFilePatterns');
    if (Array.isArray(configuredPatterns) && configuredPatterns.length > 0) {
      cachedLockFilesSet = new Set(configuredPatterns);
      return cachedLockFilesSet;
    }
  } catch {
    // Fall back to built-in default if settings are not available in test runner
  }

  cachedLockFilesSet = DEFAULT_LOCK_FILE_NAMES;
  return cachedLockFilesSet;
}

/**
 * Default patterns matching sensitive configuration files, keys, certificates, and credentials.
 */
export const DEFAULT_SECRET_PATTERNS: readonly string[] = [
  // Environment variable files (.env, .env.local, .env.production, .envrc, etc.)
  '^\\.env(\\..+)?$',
  '^\\.envrc$',

  // Certificates, private/public keys, keystores, and GPG/PGP keys
  '\\.(pem|key|cert|crt|cer|der|csr|p8|p12|pfx|pkcs12|keystore|jks|gpg|asc|sig)$',
  '^key\\.properties$',

  // SSH private and public identity key files
  '^id_(rsa|ed25519|ecdsa|dsa)(_sk)?(\\..+)?$',

  // Terraform states, backups, and variables files (including JSON format)
  '(\\.|\\.auto\\.)(tfvars|tfstate)(\\.backup|\\.json)?$',

  // API clients environments (Postman, Insomnia) containing active tokens & passwords
  'postman_(environment|globals).*\\.json$',
  'insomnia.*\\.json$',

  // Cloud, auth tokens, package managers, and service account secrets
  '^(client_secret|credentials)(\\..+)?\\.json$',
  '^service[-_]account.*\\.json$',
  '^\\.?(npmrc|pypirc|netrc|dockercfg)$',
  '^\\.yarnrc\\.ya?ml$',
  '^auth\\.json$',
  '^\\.?htpasswd$',
  '^\\.git-credentials$',
  '^secring\\.gpg$',
  '^master\\.key$'
];

/**
 * Resolves precompiled secret matching regular expressions from settings with caching.
 *
 * @returns Array of compiled RegExp objects.
 */
function getSecretRegexes(): readonly RegExp[] {
  if (cachedSecretRegexes) {
    return cachedSecretRegexes;
  }

  ensureConfigWatcher();

  let patterns: readonly string[] = DEFAULT_SECRET_PATTERNS;
  try {
    const config = vscode.workspace.getConfiguration('aiContextMerger');
    const configured = config.get<string[]>('secretPatterns');
    if (Array.isArray(configured) && configured.length > 0) {
      patterns = configured;
    }
  } catch {
    // Fall back to default
  }

  const compiled: RegExp[] = [];
  for (const p of patterns) {
    try {
      compiled.push(new RegExp(p, 'i'));
    } catch {
      // Ignore invalid regex syntax
    }
  }

  cachedSecretRegexes = compiled;
  return cachedSecretRegexes;
}

/**
 * Checks whether a given filename matches known secret, key, or credential patterns.
 * Uses cached precompiled regular expressions for high performance.
 *
 * @param fileName - Base name of the file.
 * @returns `true` if the file is recognized as sensitive.
 */
export function isSecretFile(fileName: string): boolean {
  if (/^\.env\.(example|sample|template|dist|test)$/i.test(fileName)) {
    return false;
  }

  const regexes = getSecretRegexes();
  return regexes.some((re) => re.test(fileName));
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
 * Default file extensions recognized as binary, compiled, or non-text media.
 * Includes comprehensive 3D meshes, textures, game audio, and engine assets.
 */
export const DEFAULT_BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  // 3D Models, Rigs & Meshes
  '.fbx', '.obj', '.blend', '.dae', '.3ds', '.max', '.c4d', '.gltf', '.glb',

  // Textures & Graphic Media
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg', '.bmp', '.tiff', '.tif',
  '.tga', '.dds', '.exr', '.hdr', '.psd', '.ai', '.raw',

  // Audio & Sound Banks
  '.mp3', '.wav', '.ogg', '.flac', '.aac', '.aif', '.aiff', '.bank', '.bnk', '.wem',

  // Video Media
  '.mp4', '.avi', '.webm', '.mkv', '.mov', '.wmv',

  // Bytecode, compiled scripts & shaders
  '.rpyc', '.rpym', '.rpymc', '.rpyb', '.rpa', '.save', '.pyc', '.pyo', '.pyd', '.class',
  '.spv', '.dxbc', '.dxil',

  // Executables, binaries, and shared libraries
  '.exe', '.dll', '.so', '.dylib', '.wasm', '.o', '.bin', '.hex',

  // Archives and distribution packages
  '.zip', '.tar', '.gz', '.tgz', '.rar', '.7z', '.bz2', '.xz', '.jar', '.war', '.apk', '.ipa', '.pck',

  // Documents, spreadsheets, and fonts
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.ttf', '.otf', '.woff', '.woff2', '.eot', '.dfont',

  // Databases and cache stores
  '.sqlite', '.sqlite3', '.db', '.dat', '.cache'
]);

/**
 * Backward compatibility alias for binary extensions.
 */
export const BINARY_EXTENSIONS = DEFAULT_BINARY_EXTENSIONS;

/**
 * Resolves active binary extensions set with caching.
 *
 * @returns Set of normalized binary extensions.
 */
export function getBinaryExtensionsSet(): ReadonlySet<string> {
  if (cachedBinaryExtensionsSet) {
    return cachedBinaryExtensionsSet;
  }

  ensureConfigWatcher();

  try {
    const config = vscode.workspace.getConfiguration('aiContextMerger');
    const configuredExtensions = config.get<string[]>('binaryExtensions');
    if (Array.isArray(configuredExtensions) && configuredExtensions.length > 0) {
      cachedBinaryExtensionsSet = new Set(
        configuredExtensions.map((ext) => (ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`))
      );
      return cachedBinaryExtensionsSet;
    }
  } catch {
    // Fall back to built-in default if settings are not available in test runner
  }

  cachedBinaryExtensionsSet = DEFAULT_BINARY_EXTENSIONS;
  return cachedBinaryExtensionsSet;
}

/**
 * High-speed evaluation of whether a path or segment matches active exclusion rules.
 * Uses O(1) Set lookups for bare directory/file names and precompiled RegExp for globs.
 *
 * @param relativePath - Path relative to workspace or segment filename.
 * @returns True if path matches any active exclusion pattern.
 */
export function isPathExcluded(relativePath: string): boolean {
  const { exactNames, globs } = getResolvedExclusionRules();

  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized) {
    return false;
  }

  // Fast-path 1: Single segment or basename check against O(1) Set
  if (!normalized.includes('/')) {
    if (exactNames.has(normalized.toLowerCase())) {
      return true;
    }
  } else {
    // Fast-path 2: Check if any directory segment directly matches an exact ignored folder name
    const segments = normalized.split('/');
    for (const segment of segments) {
      if (segment && exactNames.has(segment.toLowerCase())) {
        return true;
      }
    }
  }

  // Fast-path 3: Check remaining wildcard glob patterns with precompiled regular expressions
  for (const { regex } of globs) {
    if (regex.test(normalized) || regex.test(`/${normalized}`)) {
      return true;
    }
  }

  return false;
}

/**
 * Default fallback maximum token budget threshold for context estimation.
 */
export const MAX_CONTEXT_TOKENS = 200000;

/**
 * Default maximum allowable file size in bytes (5 MB).
 */
export const DEFAULT_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Resolves maximum allowable file size in bytes from user configuration or falls back to default.
 *
 * @returns Max file size threshold in bytes.
 */
export function getMaxFileSizeBytes(): number {
  try {
    const config = vscode.workspace.getConfiguration('aiContextMerger');
    const customMb = config.get<number>('maxFileSizeMB');
    if (typeof customMb === 'number' && customMb > 0) {
      return customMb * 1024 * 1024;
    }
  } catch {
    // Ignore configuration read error in isolated tests
  }
  return DEFAULT_MAX_FILE_SIZE_BYTES;
}

/**
 * Resolves maximum diff size in characters from user configuration or falls back to default (100 KB).
 *
 * @returns Max diff characters threshold.
 */
export function getMaxDiffBytes(): number {
  try {
    const config = vscode.workspace.getConfiguration('aiContextMerger');
    const customKb = config.get<number>('maxDiffSizeKB');
    if (typeof customKb === 'number' && customKb > 0) {
      return customKb * 1024;
    }
  } catch {
    // Ignore configuration read error in isolated tests
  }
  return 100 * 1024;
}