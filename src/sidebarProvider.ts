import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Статус файла в системе контроля версий Git
 */
export type GitFileStatus = 'modified' | 'untracked' | 'none';

/**
 * Структура узла файлового дерева для рендеринга в Webview
 */
export interface FileNode {
    name: string;
    path: string;
    isDirectory: boolean;
    gitStatus: GitFileStatus;
    hasModifiedChildren?: boolean;
    children?: FileNode[];
}

/**
 * Настройки активных фильтров отображения
 */
interface FilterSettings {
    hideGitIgnored: boolean;
    hideLockFiles: boolean;
    hideBinaryFiles: boolean;
}

/**
 * Провайдер сайдбара с расширенным форматированием Markdown,
 * фильтрами отображения и интеграцией с Git.
 */
export class ContextMergerSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aiContextMergerView';
    private _view?: vscode.WebviewView;

    // Множество выбранных файлов
    public selectedFiles: Set<string> = new Set<string>();

    // Текущие фильтры
    private filters: FilterSettings = {
        hideGitIgnored: true,
        hideLockFiles: true,
        hideBinaryFiles: true
    };

    // Служебные папки, которые всегда исключаются
    private alwaysIgnored = new Set(['node_modules', '.git', '.vscode', 'dist', 'out', 'build', '.next']);

    // Список известных Lock-файлов
    private lockFileNames = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock', 'composer.lock', 'poetry.lock']);

    // Список расширений бинарных файлов и медиа
    private binaryExtensions = new Set([
        '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg',
        '.mp3', '.wav', '.ogg', '.mp4', '.avi', '.webm',
        '.pdf', '.zip', '.tar', '.gz', '.rar', '.7z',
        '.exe', '.dll', '.so', '.dylib', '.wasm',
        '.ttf', '.woff', '.woff2', '.eot'
    ]);

    // Таблица соответствия расширений тегам подсветки синтаксиса в Markdown
    private languageMap: Record<string, string> = {
        '.ts': 'typescript',
        '.tsx': 'tsx',
        '.js': 'javascript',
        '.jsx': 'jsx',
        '.mjs': 'javascript',
        '.cjs': 'javascript',
        '.py': 'python',
        '.rpy': 'python', // Скрипты движка Ren'Py базируются на Python
        '.json': 'json',
        '.html': 'html',
        '.htm': 'html',
        '.css': 'css',
        '.scss': 'scss',
        '.sass': 'sass',
        '.less': 'less',
        '.rs': 'rust',
        '.go': 'go',
        '.c': 'c',
        '.cpp': 'cpp',
        '.h': 'c',
        '.hpp': 'cpp',
        '.cs': 'csharp',
        '.java': 'java',
        '.kt': 'kotlin',
        '.kts': 'kotlin',
        '.php': 'php',
        '.rb': 'ruby',
        '.sh': 'bash',
        '.bash': 'bash',
        '.zsh': 'bash',
        '.yaml': 'yaml',
        '.yml': 'yaml',
        '.sql': 'sql',
        '.md': 'markdown',
        '.markdown': 'markdown',
        '.vue': 'vue',
        '.svelte': 'svelte',
        '.toml': 'toml',
        '.xml': 'xml',
        '.dockerfile': 'dockerfile'
    };

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this.getHtmlContent();

        // Слушатель сообщений от веб-интерфейса
        webviewView.webview.onDidReceiveMessage(async (message) => {
            console.log(`[AI Context Merger] UI Action: "${message.type}"`, message);

            switch (message.type) {
                case 'toggleFile':
                    this.handleFileToggle(message.filePath, message.checked);
                    break;
                case 'toggleFolder':
                    await this.handleFolderToggle(message.folderPath, message.checked);
                    break;
                case 'copyContext':
                    await this.copyContextToClipboard();
                    break;
                case 'exportFile':
                    await this.exportContextToFile();
                    break;
                case 'previewContext':
                    await this.previewContext();
                    break;
                case 'clearSelection':
                    this.clearSelection();
                    break;
                case 'selectModified':
                    await this.selectModifiedGitFiles();
                    break;
                case 'updateFilters':
                    this.filters = message.filters;
                    await this.refresh();
                    break;
                case 'refresh':
                    await this.refresh();
                    break;
                case 'requestInitialData':
                    await this.refresh();
                    break;
            }
        });
    }

    // =========================================================================
    // БЛОК ИНТЕГРАЦИИ С GIT
    // =========================================================================

    private async getGitStatusMap(): Promise<Map<string, GitFileStatus>> {
        const statusMap = new Map<string, GitFileStatus>();
        try {
            const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
            if (!gitExtension) return statusMap;

            const gitApi = gitExtension.getAPI(1);
            if (!gitApi || gitApi.repositories.length === 0) return statusMap;

            const repo = gitApi.repositories[0];

            for (const change of repo.state.workingTreeChanges) {
                statusMap.set(path.normalize(change.uri.fsPath), 'modified');
            }
            for (const change of repo.state.untrackedChanges) {
                statusMap.set(path.normalize(change.uri.fsPath), 'untracked');
            }
            for (const change of repo.state.indexChanges) {
                const normPath = path.normalize(change.uri.fsPath);
                if (!statusMap.has(normPath)) {
                    statusMap.set(normPath, 'modified');
                }
            }
        } catch (error) {
            console.warn('[AI Context Merger] Ошибка получения статуса Git:', error);
        }
        return statusMap;
    }

    public async selectModifiedGitFiles() {
        console.log('[AI Context Merger] Выбор измененных файлов...');
        const gitStatuses = await this.getGitStatusMap();

        this.selectedFiles.clear();
        for (const [filePath, status] of gitStatuses.entries()) {
            if (status === 'modified' || status === 'untracked') {
                this.selectedFiles.add(filePath);
            }
        }

        vscode.window.showInformationMessage(`Выбрано файлов Git Diff: ${this.selectedFiles.size}`);
        await this.refresh();
    }

    // =========================================================================
    // СКАНИРОВАНИЕ И ФИЛЬТРАЦИЯ
    // =========================================================================

    public async refresh() {
        if (!this._view) return;

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            this._view.webview.postMessage({
                type: 'setData',
                tree: [],
                stats: { count: 0, tokens: 0, percentage: 0 },
                selectedFiles: [],
                filters: this.filters
            });
            return;
        }

        const rootPath = path.normalize(workspaceFolders[0].uri.fsPath);
        const gitStatusMap = await this.getGitStatusMap();
        const tree = await this.scanDirectory(rootPath, gitStatusMap);
        const stats = await this.calculateStats();

        this._view.webview.postMessage({
            type: 'setData',
            tree: [tree],
            stats,
            selectedFiles: Array.from(this.selectedFiles),
            filters: this.filters
        });
    }

    public clearSelection() {
        this.selectedFiles.clear();
        this.refresh();
    }

    /**
     * Проверка, должен ли файл быть пропущен согласно активным фильтрам
     */
    private shouldFilterItem(name: string, isDirectory: boolean): boolean {
        if (this.alwaysIgnored.has(name)) return true;

        if (!isDirectory) {
            const ext = path.extname(name).toLowerCase();
            if (this.filters.hideLockFiles && this.lockFileNames.has(name)) {
                return true;
            }
            if (this.filters.hideBinaryFiles && this.binaryExtensions.has(ext)) {
                return true;
            }
        }
        return false;
    }

    private async scanDirectory(dirPath: string, gitStatusMap: Map<string, GitFileStatus>): Promise<FileNode> {
        const normalizedDirPath = path.normalize(dirPath);
        const name = path.basename(normalizedDirPath);
        const node: FileNode = {
            name,
            path: normalizedDirPath,
            isDirectory: true,
            gitStatus: 'none',
            hasModifiedChildren: false,
            children: []
        };

        try {
            const entries = await fs.promises.readdir(normalizedDirPath, { withFileTypes: true });

            const sortedEntries = entries
                .filter(entry => !this.shouldFilterItem(entry.name, entry.isDirectory()))
                .sort((a, b) => {
                    if (a.isDirectory() === b.isDirectory()) {
                        return a.name.localeCompare(b.name);
                    }
                    return a.isDirectory() ? -1 : 1;
                });

            for (const entry of sortedEntries) {
                const fullPath = path.normalize(path.join(normalizedDirPath, entry.name));
                if (entry.isDirectory()) {
                    const childFolder = await this.scanDirectory(fullPath, gitStatusMap);
                    if (childFolder.hasModifiedChildren || childFolder.gitStatus !== 'none') {
                        node.hasModifiedChildren = true;
                    }
                    node.children?.push(childFolder);
                } else {
                    const fileStatus = gitStatusMap.get(fullPath) || 'none';
                    if (fileStatus !== 'none') {
                        node.hasModifiedChildren = true;
                    }
                    node.children?.push({
                        name: entry.name,
                        path: fullPath,
                        isDirectory: false,
                        gitStatus: fileStatus
                    });
                }
            }
        } catch {}

        return node;
    }

    private handleFileToggle(filePath: string, checked: boolean) {
        const normalized = path.normalize(filePath);
        if (checked) {
            this.selectedFiles.add(normalized);
        } else {
            this.selectedFiles.delete(normalized);
        }
        this.updateStatsOnly();
    }

    private async handleFolderToggle(folderPath: string, checked: boolean) {
        const normalized = path.normalize(folderPath);
        await this.toggleFolderRecursive(normalized, checked);
        this.refresh();
    }

    private async toggleFolderRecursive(dirPath: string, checked: boolean) {
        try {
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                if (this.shouldFilterItem(entry.name, entry.isDirectory())) continue;

                const fullPath = path.normalize(path.join(dirPath, entry.name));
                if (entry.isDirectory()) {
                    await this.toggleFolderRecursive(fullPath, checked);
                } else {
                    if (checked) {
                        this.selectedFiles.add(fullPath);
                    } else {
                        this.selectedFiles.delete(fullPath);
                    }
                }
            }
        } catch {}
    }

    // =========================================================================
    // СБОРКА И ФОРМАТИРОВАНИЕ MARKDOWN
    // =========================================================================

    /**
     * Определение тега подсветки Markdown по расширению файла
     */
    private getLanguageTag(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        return this.languageMap[ext] || 'text';
    }

    /**
     * Сборка итогового Markdown документа по заданному формату:
     * ## File path: <path>
     * 
     * ## File content:
     * ```<lang>
     * <code>
     * ```
     * 
     * 
     * ---
     */
    public async buildBundleMarkdown(): Promise<string> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const rootPath = workspaceFolders ? path.normalize(workspaceFolders[0].uri.fsPath) : '';

        const outputBlocks: string[] = [];

        for (const filePath of Array.from(this.selectedFiles).sort()) {
            const relativePath = path.relative(rootPath, filePath).replace(/\\/g, '/');
            const ext = path.extname(filePath).toLowerCase();
            const isBinary = this.binaryExtensions.has(ext);

            let contentBlock = '';

            if (isBinary) {
                try {
                    const stat = await fs.promises.stat(filePath);
                    const sizeKb = (stat.size / 1024).toFixed(1);
                    contentBlock = `[Бинарный файл: ${ext.replace('.', '').toUpperCase()} (${sizeKb} KB) — содержимое пропущено для сохранения контекста]`;
                } catch {
                    contentBlock = `[Бинарный файл: ${ext} — пропущен]`;
                }
            } else {
                try {
                    const text = (await fs.promises.readFile(filePath, 'utf-8')).trimEnd();
                    const langTag = this.getLanguageTag(filePath);
                    contentBlock = `\`\`\`${langTag}\n${text}\n\`\`\``;
                } catch (err) {
                    contentBlock = `\`\`\`text\n<Ошибка чтения файла: ${err}>\n\`\`\``;
                }
            }

            // Формируем блок файла строго по заданному шаблону
            const fileSection = `## File path: ${relativePath}\n\n## File content:\n${contentBlock}`;
            outputBlocks.push(fileSection);
        }

        // Соединяем блоки разделителем с двойными пропусками строк
        return outputBlocks.join('\n\n---\n\n');
    }

    private async calculateStats() {
        let totalChars = 0;
        const maxTokens = 200000;

        for (const filePath of this.selectedFiles) {
            try {
                const stat = await fs.promises.stat(filePath);
                totalChars += stat.size;
            } catch {}
        }

        const estimatedTokens = Math.ceil(totalChars / 4);
        const percentage = Math.min(100, Math.round((estimatedTokens / maxTokens) * 100));

        return {
            count: this.selectedFiles.size,
            tokens: estimatedTokens,
            percentage
        };
    }

    private async updateStatsOnly() {
        if (!this._view) return;
        const stats = await this.calculateStats();
        this._view.webview.postMessage({
            type: 'updateStats',
            stats,
            selectedFiles: Array.from(this.selectedFiles)
        });
    }

    public async copyContextToClipboard() {
        if (this.selectedFiles.size === 0) {
            vscode.window.showWarningMessage('Не выбрано ни одного файла для копирования.');
            return;
        }
        const markdown = await this.buildBundleMarkdown();
        await vscode.env.clipboard.writeText(markdown);
        vscode.window.showInformationMessage(`Скопирован контекст: ${this.selectedFiles.size} файлов!`);
    }

    public async exportContextToFile() {
        if (this.selectedFiles.size === 0) {
            vscode.window.showWarningMessage('Не выбрано ни одного файла для экспорта.');
            return;
        }

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('project-context.md'),
            filters: { 'Markdown': ['md'], 'All Files': ['*'] }
        });

        if (!uri) return;

        const markdown = await this.buildBundleMarkdown();
        await fs.promises.writeFile(uri.fsPath, markdown, 'utf-8');
        vscode.window.showInformationMessage(`Файл сохранен: ${path.basename(uri.fsPath)}`);
    }

    public async previewContext() {
        if (this.selectedFiles.size === 0) {
            vscode.window.showWarningMessage('Сначала выберите файлы для предпросмотра.');
            return;
        }
        const markdown = await this.buildBundleMarkdown();
        const doc = await vscode.workspace.openTextDocument({
            content: markdown,
            language: 'markdown'
        });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
    }

    // =========================================================================
    // HTML / CSS ИНТЕРФЕЙС
    // =========================================================================

    private getHtmlContent(): string {
        return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        :root {
            --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
            --color-green: #2ea043;
            --color-yellow: #d29922;
            --color-red: #f85149;
            --git-modified: #e2c08d;
            --git-untracked: #73c991;
        }
        body {
            font-family: var(--font-family);
            padding: 10px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-sideBar-background);
            margin: 0;
            user-select: none;
        }

        .header-title {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 1px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 12px;
            text-transform: uppercase;
        }

        .btn-primary {
            width: 100%;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 10px 14px;
            font-size: 12px;
            font-weight: 700;
            border-radius: 4px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            box-sizing: border-box;
        }
        .btn-primary:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .btn-grid-2 {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
            margin-top: 6px;
        }

        .btn-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 6px 8px;
            font-size: 11px;
            border-radius: 4px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            white-space: nowrap;
        }
        .btn-secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .stats-card {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
            border-radius: 6px;
            padding: 8px 10px;
            margin-top: 12px;
        }
        .stats-header {
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            margin-bottom: 6px;
        }
        .stats-metric {
            font-weight: 600;
            color: var(--vscode-textLink-foreground);
        }
        .progress-bar-container {
            width: 100%;
            height: 6px;
            background-color: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.2));
            border-radius: 3px;
            overflow: hidden;
            margin-bottom: 4px;
        }
        .progress-bar-fill {
            height: 100%;
            width: 0%;
            background-color: var(--color-green);
            transition: width 0.3s ease, background-color 0.3s ease;
        }
        .progress-caption {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            text-align: right;
        }

        /* Блок фильтров */
        .filter-section {
            margin-top: 10px;
            background-color: var(--vscode-editor-background);
            border-radius: 4px;
            padding: 6px 8px;
            font-size: 11px;
        }
        .filter-title {
            font-weight: 600;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 4px;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .filter-row {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }
        .filter-item {
            display: flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
        }
        .filter-item input {
            cursor: pointer;
            margin: 0;
        }

        .search-container {
            margin-top: 10px;
            position: relative;
        }
        .search-input {
            width: 100%;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, transparent);
            padding: 6px 8px 6px 24px;
            font-size: 12px;
            border-radius: 4px;
            box-sizing: border-box;
            outline: none;
        }
        .search-input:focus {
            border-color: var(--vscode-focusBorder);
        }
        .search-icon {
            position: absolute;
            left: 7px;
            top: 6px;
            font-size: 11px;
            opacity: 0.6;
        }

        .tree-container {
            margin-top: 8px;
            max-height: calc(100vh - 380px);
            overflow-y: auto;
        }
        .tree-row {
            display: flex;
            align-items: center;
            padding: 3px 2px;
            font-size: 12px;
            border-radius: 3px;
        }
        .tree-row:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .tree-row input[type="checkbox"] {
            margin-right: 6px;
            cursor: pointer;
        }
        .folder-toggle {
            cursor: pointer;
            margin-right: 4px;
            font-size: 10px;
            width: 12px;
            display: inline-block;
            text-align: center;
        }
        .node-icon {
            margin-right: 6px;
            opacity: 0.8;
        }
        .nested {
            margin-left: 14px;
        }
        .hidden {
            display: none !important;
        }

        .git-modified {
            color: var(--git-modified) !important;
        }
        .git-untracked {
            color: var(--git-untracked) !important;
        }
        .git-badge {
            margin-left: auto;
            font-size: 10px;
            font-weight: 700;
            padding: 0 4px;
            border-radius: 2px;
        }
        .git-badge-m {
            color: var(--git-modified);
        }
        .git-badge-u {
            color: var(--git-untracked);
        }
        .git-folder-dot {
            width: 5px;
            height: 5px;
            border-radius: 50%;
            background-color: var(--git-modified);
            margin-left: auto;
            margin-right: 4px;
        }
    </style>
</head>
<body>

    <div class="header-title">AI Context Merger</div>

    <button class="btn-primary" id="btnCopy">
        <span>📋</span> СКОПИРОВАТЬ КОНТЕКСТ
    </button>

    <div class="btn-grid-2">
        <button class="btn-secondary" id="btnPreview">👁️ Превью .md</button>
        <button class="btn-secondary" id="btnExport">💾 Экспорт в .md</button>
    </div>

    <div class="btn-grid-2">
        <button class="btn-secondary" id="btnClear">🧹 Снять всё</button>
        <button class="btn-secondary" id="btnCollapse">📁 Свернуть всё</button>
    </div>
    <div class="btn-grid-2" style="margin-top: 6px;">
        <button class="btn-secondary" id="btnRefresh">🔄 Обновить</button>
        <button class="btn-secondary" id="btnGit">🌿 Измененные (Git)</button>
    </div>

    <!-- Блок фильтрации -->
    <div class="filter-section">
        <div class="filter-title"><span>⚙️</span> Фильтры скрытия:</div>
        <div class="filter-row">
            <label class="filter-item">
                <input type="checkbox" id="filterGit" checked> .gitignore
            </label>
            <label class="filter-item">
                <input type="checkbox" id="filterLock" checked> Lock-файлы
            </label>
            <label class="filter-item">
                <input type="checkbox" id="filterBinary" checked> Бинарники
            </label>
        </div>
    </div>

    <div class="stats-card">
        <div class="stats-header">
            <span>📊 Статистика:</span>
            <span><strong id="statCount" class="stats-metric">0</strong> файлов | <strong id="statTokens" class="stats-metric">0</strong> токенов</span>
        </div>
        <div class="progress-bar-container">
            <div class="progress-bar-fill" id="progressBar"></div>
        </div>
        <div class="progress-caption" id="progressCaption">0% от 200k</div>
    </div>

    <div class="search-container">
        <span class="search-icon">🔍</span>
        <input type="text" id="searchInput" class="search-input" placeholder="Быстрый поиск файлов..." />
    </div>

    <div class="tree-container" id="treeView"></div>

    <script>
        const vscode = acquireVsCodeApi();

        let rawTreeData = [];
        let selectedFilesSet = new Set();

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'setData') {
                rawTreeData = message.tree;
                selectedFilesSet = new Set(message.selectedFiles);
                updateStatsUI(message.stats);
                
                if (message.filters) {
                    document.getElementById('filterGit').checked = message.filters.hideGitIgnored;
                    document.getElementById('filterLock').checked = message.filters.hideLockFiles;
                    document.getElementById('filterBinary').checked = message.filters.hideBinaryFiles;
                }
                
                renderTree(rawTreeData, document.getElementById('treeView'));
            } else if (message.type === 'updateStats') {
                selectedFilesSet = new Set(message.selectedFiles);
                updateStatsUI(message.stats);
                syncFolderCheckboxes(document.getElementById('treeView'));
            }
        });

        // Слушатели кнопок
        document.getElementById('btnCopy').addEventListener('click', () => vscode.postMessage({ type: 'copyContext' }));
        document.getElementById('btnPreview').addEventListener('click', () => vscode.postMessage({ type: 'previewContext' }));
        document.getElementById('btnExport').addEventListener('click', () => vscode.postMessage({ type: 'exportFile' }));
        document.getElementById('btnClear').addEventListener('click', () => vscode.postMessage({ type: 'clearSelection' }));
        document.getElementById('btnRefresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
        document.getElementById('btnGit').addEventListener('click', () => vscode.postMessage({ type: 'selectModified' }));
        
        document.getElementById('btnCollapse').addEventListener('click', () => {
            document.querySelectorAll('.nested').forEach(el => el.classList.add('hidden'));
            document.querySelectorAll('.folder-toggle').forEach(el => el.innerText = '▶');
        });

        // Слушатели переключения фильтров
        function notifyFilterChange() {
            vscode.postMessage({
                type: 'updateFilters',
                filters: {
                    hideGitIgnored: document.getElementById('filterGit').checked,
                    hideLockFiles: document.getElementById('filterLock').checked,
                    hideBinaryFiles: document.getElementById('filterBinary').checked
                }
            });
        }
        document.getElementById('filterGit').addEventListener('change', notifyFilterChange);
        document.getElementById('filterLock').addEventListener('change', notifyFilterChange);
        document.getElementById('filterBinary').addEventListener('change', notifyFilterChange);

        // Поиск
        document.getElementById('searchInput').addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            const rows = document.querySelectorAll('.tree-item');
            rows.forEach(row => {
                const name = row.getAttribute('data-name').toLowerCase();
                if (name.includes(query)) {
                    row.classList.remove('hidden');
                } else {
                    row.classList.add('hidden');
                }
            });
        });

        function updateStatsUI(stats) {
            document.getElementById('statCount').innerText = stats.count;
            document.getElementById('statTokens').innerText = stats.tokens.toLocaleString();
            
            const bar = document.getElementById('progressBar');
            bar.style.width = stats.percentage + '%';

            if (stats.percentage < 33) {
                bar.style.backgroundColor = 'var(--color-green)';
            } else if (stats.percentage < 66) {
                bar.style.backgroundColor = 'var(--color-yellow)';
            } else {
                bar.style.backgroundColor = 'var(--color-red)';
            }

            document.getElementById('progressCaption').innerText = stats.percentage + '% от 200k';
        }

        function renderTree(nodes, container) {
            container.innerHTML = '';
            if (!nodes || nodes.length === 0) {
                container.innerHTML = '<div style="padding: 10px; opacity: 0.6; font-size: 11px;">Нет доступных файлов в рабочей области</div>';
                return;
            }
            nodes.forEach(node => {
                container.appendChild(createNodeElement(node));
            });
        }

        function createNodeElement(node) {
            const wrapper = document.createElement('div');
            wrapper.className = 'tree-item';
            wrapper.setAttribute('data-name', node.name);
            wrapper.setAttribute('data-path', node.path);

            const row = document.createElement('div');
            row.className = 'tree-row';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';

            if (node.isDirectory) {
                const toggle = document.createElement('span');
                toggle.className = 'folder-toggle';
                toggle.innerText = '▼';

                const icon = document.createElement('span');
                icon.className = 'node-icon';
                icon.innerText = '📁';

                const title = document.createElement('span');
                title.innerText = node.name;

                row.appendChild(toggle);
                row.appendChild(checkbox);
                row.appendChild(icon);
                row.appendChild(title);

                if (node.hasModifiedChildren) {
                    const dot = document.createElement('span');
                    dot.className = 'git-folder-dot';
                    dot.title = 'Содержит измененные файлы';
                    row.appendChild(dot);
                }

                wrapper.appendChild(row);

                const childrenContainer = document.createElement('div');
                childrenContainer.className = 'nested';
                if (node.children) {
                    node.children.forEach(child => {
                        childrenContainer.appendChild(createNodeElement(child));
                    });
                }
                wrapper.appendChild(childrenContainer);

                toggle.addEventListener('click', () => {
                    const isHidden = childrenContainer.classList.toggle('hidden');
                    toggle.innerText = isHidden ? '▶' : '▼';
                });

                checkbox.addEventListener('change', (e) => {
                    vscode.postMessage({
                        type: 'toggleFolder',
                        folderPath: node.path,
                        checked: e.target.checked
                    });
                });

                updateFolderCheckboxState(checkbox, childrenContainer);
            } else {
                checkbox.checked = selectedFilesSet.has(node.path);

                const icon = document.createElement('span');
                icon.className = 'node-icon';
                icon.innerText = '📄';

                const title = document.createElement('span');
                title.innerText = node.name;

                if (node.gitStatus === 'modified') {
                    title.classList.add('git-modified');
                    const badge = document.createElement('span');
                    badge.className = 'git-badge git-badge-m';
                    badge.innerText = 'M';
                    row.appendChild(checkbox);
                    row.appendChild(icon);
                    row.appendChild(title);
                    row.appendChild(badge);
                } else if (node.gitStatus === 'untracked') {
                    title.classList.add('git-untracked');
                    const badge = document.createElement('span');
                    badge.className = 'git-badge git-badge-u';
                    badge.innerText = 'U';
                    row.appendChild(checkbox);
                    row.appendChild(icon);
                    row.appendChild(title);
                    row.appendChild(badge);
                } else {
                    row.appendChild(checkbox);
                    row.appendChild(icon);
                    row.appendChild(title);
                }

                wrapper.appendChild(row);

                checkbox.addEventListener('change', (e) => {
                    vscode.postMessage({
                        type: 'toggleFile',
                        filePath: node.path,
                        checked: e.target.checked
                    });
                });
            }

            return wrapper;
        }

        function updateFolderCheckboxState(folderCheckbox, childrenContainer) {
            const childCheckboxes = childrenContainer.querySelectorAll('input[type="checkbox"]');
            if (childCheckboxes.length === 0) return;

            let allChecked = true;
            let anyChecked = false;

            childCheckboxes.forEach(cb => {
                if (cb.checked || cb.indeterminate) anyChecked = true;
                if (!cb.checked) allChecked = false;
            });

            folderCheckbox.checked = allChecked;
            folderCheckbox.indeterminate = !allChecked && anyChecked;
        }

        function syncFolderCheckboxes(container) {
            const nestedContainers = container.querySelectorAll('.nested');
            nestedContainers.forEach(nc => {
                const parentRow = nc.previousElementSibling;
                if (parentRow) {
                    const folderCheckbox = parentRow.querySelector('input[type="checkbox"]');
                    if (folderCheckbox) {
                        updateFolderCheckboxState(folderCheckbox, nc);
                    }
                }
            });
        }

        vscode.postMessage({ type: 'requestInitialData' });
    </script>
</body>
</html>`;
    }
}