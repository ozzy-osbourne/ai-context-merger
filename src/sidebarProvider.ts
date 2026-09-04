import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Структура узла файлового дерева для передачи в Webview
 */
interface FileNode {
    name: string;
    path: string;
    isDirectory: boolean;
    children?: FileNode[];
}

/**
 * Провайдер веб-вью сайдбара с кастомным интерфейсом,
 * статистикой токенов и управлением контекстом.
 */
export class ContextMergerSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aiContextMergerView';
    private _view?: vscode.WebviewView;

    // Множество абсолютных путей выбранных файлов
    public selectedFiles: Set<string> = new Set<string>();

    // Служебные папки и файлы, исключаемые из сканирования
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

        // Первичная отрисовка HTML каркаса
        webviewView.webview.html = this.getHtmlContent(webviewView.webview);

        // Обработка сообщений из интерфейса Webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
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
                case 'refresh':
                    await this.refresh();
                    break;
                case 'requestInitialData':
                    await this.refresh();
                    break;
            }
        });
    }

    /**
     * Сканирование файловой системы и синхронизация дерева с Webview
     */
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

        const rootPath = workspaceFolders[0].uri.fsPath;
        const tree = await this.scanDirectory(rootPath);
        const stats = await this.calculateStats();

        this._view.webview.postMessage({
            type: 'setData',
            tree: [tree],
            stats,
            selectedFiles: Array.from(this.selectedFiles)
        });
    }

    /**
     * Сброс всех выбранных файлов
     */
    public clearSelection() {
        this.selectedFiles.clear();
        this.refresh();
    }

    /**
     * Рекурсивное построение дерева файлов
     * @param dirPath Путь к сканируемой директории
     */
    private async scanDirectory(dirPath: string): Promise<FileNode> {
        const name = path.basename(dirPath);
        const node: FileNode = {
            name,
            path: dirPath,
            isDirectory: true,
            children: []
        };

        try {
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

            const sortedEntries = entries
                .filter(entry => !this.ignoredNames.has(entry.name) && !entry.name.startsWith('.'))
                .sort((a, b) => {
                    if (a.isDirectory() === b.isDirectory()) {
                        return a.name.localeCompare(b.name);
                    }
                    return a.isDirectory() ? -1 : 1;
                });

            for (const entry of sortedEntries) {
                const fullPath = path.join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    const childFolder = await this.scanDirectory(fullPath);
                    node.children?.push(childFolder);
                } else {
                    node.children?.push({
                        name: entry.name,
                        path: fullPath,
                        isDirectory: false
                    });
                }
            }
        } catch {
            // Игнорируем директории без прав на чтение
        }

        return node;
    }

    /**
     * Переключение состояния отдельного файла
     */
    private async handleFileToggle(filePath: string, checked: boolean) {
        if (checked) {
            this.selectedFiles.add(filePath);
        } else {
            this.selectedFiles.delete(filePath);
        }
        this.updateStatsOnly();
    }

    /**
     * Рекурсивное переключение всех файлов внутри выбранной папки
     */
    private async handleFolderToggle(folderPath: string, checked: boolean) {
        await this.toggleFolderRecursive(folderPath, checked);
        this.refresh();
    }

    private async toggleFolderRecursive(dirPath: string, checked: boolean) {
        try {
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                if (this.ignoredNames.has(entry.name) || entry.name.startsWith('.')) continue;

                const fullPath = path.join(dirPath, entry.name);
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

    /**
     * Подсчет объема контекста:
     * Оценка токенов рассчитывается по правилу ~4 символов на 1 токен (эвристика для исходного кода)
     * Максимальный контекст принят за 200 000 токенов (стандарт Claude 3.5 Sonnet / GPT-4o)
     */
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

    /**
     * Сборка итогового Markdown-документа по заданному формату
     */
    public async buildBundleMarkdown(): Promise<string> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const rootPath = workspaceFolders ? workspaceFolders[0].uri.fsPath : '';

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
        vscode.window.showInformationMessage(`Файл успешно сохранен: ${path.basename(uri.fsPath)}`);
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

    /**
     * Генерация HTML интерфейса Webview со стилизацией под текущую тему редактора
     */
    private getHtmlContent(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        :root {
            --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
        }
        body {
            font-family: var(--font-family);
            padding: 10px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-sideBar-background);
            margin: 0;
            user-select: none;
        }

        /* Заголовок модуля */
        .header-title {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 1px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 12px;
            text-transform: uppercase;
        }

        /* Большая главная кнопка копирования */
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
            transition: opacity 0.15s;
        }
        .btn-primary:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        /* Двухколоночный ряд второстепенных действий */
        .action-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
            margin-top: 6px;
        }
        .btn-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 6px 10px;
            font-size: 11px;
            border-radius: 4px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }
        .btn-secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        /* Информационный блок статистики и прогресс-бар */
        .stats-card {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
            border-radius: 6px;
            padding: 8px 10px;
            margin-top: 14px;
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
            background-color: var(--vscode-progressBar-background, #007acc);
            transition: width 0.3s ease;
        }
        .progress-caption {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            text-align: right;
        }

        /* Строка поиска */
        .search-container {
            margin-top: 12px;
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

        /* Дерево файлов */
        .tree-container {
            margin-top: 10px;
            max-height: calc(100vh - 280px);
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
    </style>
</head>
<body>

    <div class="header-title">AI Context Merger</div>

    <!-- Главные действия -->
    <button class="btn-primary" id="btnCopy">
        <span>📋</span> СКОПИРОВАТЬ КОНТЕКСТ
    </button>

    <div class="action-grid">
        <button class="btn-secondary" id="btnExport">💾 Экспорт в .md</button>
        <button class="btn-secondary" id="btnPreview">👁️ Превью</button>
    </div>

    <!-- Панель метрик и прогресс токенов -->
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

    <!-- Поисковая строка -->
    <div class="search-container">
        <span class="search-icon">🔍</span>
        <input type="text" id="searchInput" class="search-input" placeholder="Быстрый поиск файлов..." />
    </div>

    <!-- Область отрисовки дерева проекта -->
    <div class="tree-container" id="treeView"></div>

    <script>
        const vscode = acquireVsCodeApi();

        let rawTreeData = [];
        let selectedFilesSet = new Set();

        // Слушатель событий от бэкенда расширения
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
            }
        });

        // Навешивание обработчиков на кнопки действий
        document.getElementById('btnCopy').addEventListener('click', () => {
            vscode.postMessage({ type: 'copyContext' });
        });
        document.getElementById('btnExport').addEventListener('click', () => {
            vscode.postMessage({ type: 'exportFile' });
        });
        document.getElementById('btnPreview').addEventListener('click', () => {
            vscode.postMessage({ type: 'previewContext' });
        });

        // Фильтрация элементов дерева при вводе в поиск
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
            document.getElementById('progressBar').style.width = stats.percentage + '%';
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

            const row = document.createElement('div');
            row.className = 'tree-row';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = selectedFilesSet.has(node.path);

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
            } else {
                const icon = document.createElement('span');
                icon.className = 'node-icon';
                icon.innerText = '📄';

                const title = document.createElement('span');
                title.innerText = node.name;

                row.appendChild(checkbox);
                row.appendChild(icon);
                row.appendChild(title);
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

        // Запрос начальных данных при инициализации
        vscode.postMessage({ type: 'requestInitialData' });
    </script>
</body>
</html>`;
    }
}