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
 * Провайдер сайдбара с интеграцией Git, подсчетом токенов и кастомным UI
 */
export class ContextMergerSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aiContextMergerView';
    private _view?: vscode.WebviewView;

    // Хранилище абсолютных нормализованных путей выбранных файлов
    public selectedFiles: Set<string> = new Set<string>();

    // Список служебных папок и файлов, которые игнорируются при сканировании
    private ignoredNames = new Set([
        'node_modules',
        '.git',
        '.vscode',
        'dist',
        'out',
        'build',
        '.next',
        'package-lock.json',
        'yarn.lock',
        'pnpm-lock.yaml'
    ]);

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

        // Обработка сообщений из Webview интерфейса
        webviewView.webview.onDidReceiveMessage(async (message) => {
            console.log(`[AI Context Merger] Получено действие из UI: "${message.type}"`, message);

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
                case 'collapseAll':
                    console.log('[AI Context Merger] Действие: Свернуть все папки дерева');
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

    /**
     * Получение карты статусов файлов из встроенного расширения Git в VS Code
     */
    private async getGitStatusMap(): Promise<Map<string, GitFileStatus>> {
        const statusMap = new Map<string, GitFileStatus>();

        try {
            const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
            if (!gitExtension) return statusMap;

            const gitApi = gitExtension.getAPI(1);
            if (!gitApi || gitApi.repositories.length === 0) return statusMap;

            const repo = gitApi.repositories[0];

            // Измененные отслеживаемые файлы (Working Tree)
            for (const change of repo.state.workingTreeChanges) {
                const normPath = path.normalize(change.uri.fsPath);
                statusMap.set(normPath, 'modified');
            }

            // Новые неотслеживаемые файлы (Untracked)
            for (const change of repo.state.untrackedChanges) {
                const normPath = path.normalize(change.uri.fsPath);
                statusMap.set(normPath, 'untracked');
            }

            // Индексированные файлы (Staged)
            for (const change of repo.state.indexChanges) {
                const normPath = path.normalize(change.uri.fsPath);
                if (!statusMap.has(normPath)) {
                    statusMap.set(normPath, 'modified');
                }
            }
        } catch (error) {
            console.warn('[AI Context Merger] Не удалось получить данные Git:', error);
        }

        return statusMap;
    }

    /**
     * Выбор только измененных и новых файлов по данным Git
     */
    public async selectModifiedGitFiles() {
        console.log('[AI Context Merger] Выполняется выбор измененных файлов (Git Diff)...');
        const gitStatuses = await this.getGitStatusMap();

        this.selectedFiles.clear();
        for (const [filePath, status] of gitStatuses.entries()) {
            if (status === 'modified' || status === 'untracked') {
                this.selectedFiles.add(filePath);
            }
        }

        vscode.window.showInformationMessage(`Выбрано измененных файлов: ${this.selectedFiles.size}`);
        await this.refresh();
    }

    // =========================================================================
    // СКАНИРОВАНИЕ И СБОРКА ДЕРЕВА
    // =========================================================================

    public async refresh() {
        if (!this._view) return;

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            this._view.webview.postMessage({
                type: 'setData',
                tree: [],
                stats: { count: 0, tokens: 0, percentage: 0 },
                selectedFiles: []
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
            selectedFiles: Array.from(this.selectedFiles)
        });
    }

    public clearSelection() {
        console.log('[AI Context Merger] Сброс всех выбранных файлов.');
        this.selectedFiles.clear();
        this.refresh();
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
                .filter(entry => !this.ignoredNames.has(entry.name) && !entry.name.startsWith('.'))
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

    // =========================================================================
    // ВЫДЕЛЕНИЕ ФАЙЛОВ И ПАПОК
    // =========================================================================

    private handleFileToggle(filePath: string, checked: boolean) {
        const normalized = path.normalize(filePath);
        if (checked) {
            this.selectedFiles.add(normalized);
        } else {
            this.selectedFiles.delete(normalized);
        }
        console.log(`[AI Context Merger] Файл ${checked ? 'выбран' : 'снят'}: ${normalized}`);
        this.updateStatsOnly();
    }

    private async handleFolderToggle(folderPath: string, checked: boolean) {
        const normalized = path.normalize(folderPath);
        console.log(`[AI Context Merger] Массовое переключение папки (${checked ? 'выбрать' : 'снять'}): ${normalized}`);
        await this.toggleFolderRecursive(normalized, checked);
        this.refresh();
    }

    private async toggleFolderRecursive(dirPath: string, checked: boolean) {
        try {
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                if (this.ignoredNames.has(entry.name) || entry.name.startsWith('.')) continue;

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
    // РАСЧЕТ МЕТРИК И СБОРКА ТЕКСТА
    // =========================================================================

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

    public async buildBundleMarkdown(): Promise<string> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const rootPath = workspaceFolders ? path.normalize(workspaceFolders[0].uri.fsPath) : '';

        const outputParts: string[] = [];

        for (const filePath of Array.from(this.selectedFiles).sort()) {
            const relativePath = path.relative(rootPath, filePath).replace(/\\/g, '/');
            try {
                const content = await fs.promises.readFile(filePath, 'utf-8');
                outputParts.push(`file path: ${relativePath}\nfile content:\n${content}\n---`);
            } catch (err) {
                outputParts.push(`file path: ${relativePath}\nfile content:\n<Ошибка чтения файла: ${err}>\n---`);
            }
        }

        return outputParts.join('\n\n');
    }

    public async copyContextToClipboard() {
        console.log('[AI Context Merger] Копирование сформированного контекста в буфер...');
        if (this.selectedFiles.size === 0) {
            vscode.window.showWarningMessage('Не выбрано ни одного файла для копирования.');
            return;
        }
        const markdown = await this.buildBundleMarkdown();
        await vscode.env.clipboard.writeText(markdown);
        vscode.window.showInformationMessage(`Скопирован контекст: ${this.selectedFiles.size} файлов!`);
    }

    public async exportContextToFile() {
        console.log('[AI Context Merger] Открытие системного диалога для экспорта в файл...');
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
        vscode.window.showInformationMessage(`Файл успешно сохранен: ${path.basename(uri.fsPath)}`);
    }

    public async previewContext() {
        console.log('[AI Context Merger] Генерация предпросмотра во вкладке Beside...');
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

        /* Большая кнопка копирования */
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

        /* 2-колоночные кнопки действий */
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

        /* Статистика и прогресс-бар */
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

        /* Поиск */
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

        /* Дерево */
        .tree-container {
            margin-top: 8px;
            max-height: calc(100vh - 330px);
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

        /* Git подсветка */
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

    <!-- Ряд 1: Главная кнопка -->
    <button class="btn-primary" id="btnCopy">
        <span>📋</span> СКОПИРОВАТЬ КОНТЕКСТ
    </button>

    <!-- Ряд 2: Превью и Экспорт -->
    <div class="btn-grid-2">
        <button class="btn-secondary" id="btnPreview">👁️ Превью .md</button>
        <button class="btn-secondary" id="btnExport">💾 Экспорт в .md</button>
    </div>

    <!-- Ряд 3: Дополнительные инструменты -->
    <div class="btn-grid-2">
        <button class="btn-secondary" id="btnClear">🧹 Снять всё</button>
        <button class="btn-secondary" id="btnCollapse">📁 Свернуть всё</button>
    </div>
    <div class="btn-grid-2" style="margin-top: 6px;">
        <button class="btn-secondary" id="btnRefresh">🔄 Обновить</button>
        <button class="btn-secondary" id="btnGit">🌿 Измененные (Git)</button>
    </div>

    <!-- Статистика -->
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

    <!-- Поиск -->
    <div class="search-container">
        <span class="search-icon">🔍</span>
        <input type="text" id="searchInput" class="search-input" placeholder="Быстрый поиск файлов..." />
    </div>

    <!-- Дерево файлов -->
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
            vscode.postMessage({ type: 'collapseAll' });
        });

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

        // Обновление цвета шкалы в зависимости от процента
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

                // Цветовая подсветка Git
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

        // Проверка частичного/полного выбора для чекбоксов папок
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