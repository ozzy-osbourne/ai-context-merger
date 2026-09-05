// Служебные папки, которые всегда исключаются
export const ALWAYS_IGNORED = new Set([
    'node_modules',
    '.git',
    '.vscode',
    'dist',
    'out',
    'build',
    '.next'
]);

// Список известных Lock-файлов
export const LOCK_FILE_NAMES = new Set([
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'Cargo.lock',
    'composer.lock',
    'poetry.lock'
]);

// Список расширений бинарных файлов и медиа
export const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg',
    '.mp3', '.wav', '.ogg', '.mp4', '.avi', '.webm',
    '.pdf', '.zip', '.tar', '.gz', '.rar', '.7z',
    '.exe', '.dll', '.so', '.dylib', '.wasm',
    '.ttf', '.woff', '.woff2', '.eot'
]);

export const MAX_CONTEXT_TOKENS = 200000;