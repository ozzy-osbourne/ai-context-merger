// Служебные папки, которые всегда исключаются
export const ALWAYS_IGNORED = new Set([
    'node_modules',
    '.git',
    '.vscode',
    'dist',
    'out',
    'build',
    '.next',
    '__pycache__',
    '.pytest_cache',
    '.mypy_cache',
    '.tox',
    '.venv',
    'venv',
    'target'
]);

// Список известных Lock-файлов
export const LOCK_FILE_NAMES = new Set([
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'Cargo.lock',
    'composer.lock',
    'poetry.lock',
    'Pipfile.lock',
    'bun.lockb'
]);

// Расширения бинарных, скомпилированных файлов, медиа и баз данных
export const BINARY_EXTENSIONS = new Set([
    // Скомпилированный байткод (Python, Ren'Py, Java, .NET)
    '.rpyc', '.rpym', '.rpymc', '.rpyb', '.rpa', '.save', '.pyc', '.pyo', '.pyd', '.class',

    // Исполняемые файлы, библиотеки и объекты
    '.exe', '.dll', '.so', '.dylib', '.wasm', '.o', '.obj', '.bin', '.hex',

    // Изображения
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg', '.bmp', '.tiff', '.psd', '.ai',

    // Аудио и видео
    '.mp3', '.wav', '.ogg', '.flac', '.aac', '.mp4', '.avi', '.webm', '.mkv', '.mov', '.wmv',

    // Архивы и пакеты
    '.zip', '.tar', '.gz', '.tgz', '.rar', '.7z', '.bz2', '.xz', '.jar', '.war', '.apk', '.ipa',

    // Документы и шрифты
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.ttf', '.otf', '.woff', '.woff2', '.eot',

    // Базы данных и кэш
    '.sqlite', '.sqlite3', '.db', '.dat', '.cache'
]);

export const MAX_CONTEXT_TOKENS = 200000;