// Служебные папки и системные файлы, которые исключаются всегда (наивысший приоритет)
export const ALWAYS_IGNORED = new Set([
    // Служебные каталоги систем контроля версий и IDE
    '.git',
    '.vscode',
    '.idea',

    // Менеджеры пакетов и сборка JS / TS / Web
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

    // Окружение, кэш и байткод Python
    '__pycache__',
    '.pytest_cache',
    '.mypy_cache',
    '.tox',
    '.venv',
    'venv',
    'env',

    // Сборка и кэш Rust, Java, Kotlin, Gradle
    'target',
    '.gradle',

    // Отчеты покрытия тестами и временный кэш
    'coverage',
    '.nyc_output',
    '.cache',

    // Системный мусор операционных систем
    '.DS_Store',
    'Thumbs.db'
]);

// Список известных Lock-файлов пакетных менеджеров
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
    // Байткод и скомпилированные скрипты (Python, Ren'Py, Java, .NET)
    '.rpyc', '.rpym', '.rpymc', '.rpyb', '.rpa', '.save', '.pyc', '.pyo', '.pyd', '.class',

    // Исполняемые файлы, динамические библиотеки и бинарные объекты
    '.exe', '.dll', '.so', '.dylib', '.wasm', '.o', '.obj', '.bin', '.hex',

    // Графика и растровые/векторные изображения
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg', '.bmp', '.tiff', '.psd', '.ai',

    // Аудио и видеоматериалы
    '.mp3', '.wav', '.ogg', '.flac', '.aac', '.mp4', '.avi', '.webm', '.mkv', '.mov', '.wmv',

    // Архивы, образы и пакеты дистрибуции
    '.zip', '.tar', '.gz', '.tgz', '.rar', '.7z', '.bz2', '.xz', '.jar', '.war', '.apk', '.ipa',

    // Документы, таблицы и шрифты
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.ttf', '.otf', '.woff', '.woff2', '.eot',

    // Базы данных и файлы кэша
    '.sqlite', '.sqlite3', '.db', '.dat', '.cache'
]);

export const MAX_CONTEXT_TOKENS = 200000;