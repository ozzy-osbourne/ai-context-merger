import * as vscode from 'vscode';

/**
 * Провайдер кастомного HTML-интерфейса в боковой панели VS Code
 */
export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aiContextMergerView';
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    /**
     * Инициализация веб-панели при её открытии пользователем
     */
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        // Разрешаем выполнение скриптов внутри веб-панели
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        // Загружаем HTML-разметку
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Обработка сообщений (кликов по кнопкам) из HTML-интерфейса в код расширения
        webviewView.webview.onDidReceiveMessage((data) => {
            switch (data.type) {
                case 'copy':
                    vscode.commands.executeCommand('ai-context-merger.copyToClipboard');
                    break;
                case 'export':
                    vscode.commands.executeCommand('ai-context-merger.exportToFile');
                    break;
                case 'preview':
                    vscode.commands.executeCommand('ai-context-merger.preview');
                    break;
                case 'clear':
                    vscode.commands.executeCommand('ai-context-merger.clearSelection');
                    break;
                case 'refresh':
                    vscode.commands.executeCommand('ai-context-merger.refresh');
                    break;
            }
        });
    }

    /**
     * Генерация HTML и CSS стилей интерфейса
     */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Context Merger</title>
    <style>
        /* ==========================================================================
           Базовые стили с использованием нативных системных переменных VS Code
           ========================================================================== */
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-sideBar-background);
            padding: 12px;
            user-select: none;
        }

        .container {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        /* Заголовок панели */
        .header-title {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 1px;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
        }

        /* ==========================================================================
           Кнопки управления
           ========================================================================== */
        button {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            width: 100%;
            padding: 8px 12px;
            font-size: 12px;
            font-weight: 600;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            transition: opacity 0.15s ease, transform 0.05s ease;
        }

        button:active {
            transform: scale(0.98);
        }

        /* Главная большая кнопка копирования */
        .btn-primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            padding: 10px;
            font-size: 13px;
        }

        .btn-primary:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        /* Вторичные компактные кнопки */
        .btn-secondary-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
        }

        .btn-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            padding: 6px;
            font-size: 11px;
        }

        .btn-secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .btn-icon-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
        }

        /* ==========================================================================
           Карточка статистики и прогресс-бар токенов
           ========================================================================== */
        .stats-card {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
            border-radius: 6px;
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .stats-header {
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            font-weight: 600;
        }

        .stats-highlight {
            color: var(--vscode-textLink-foreground);
        }

        /* Индикатор заполненности контекста LLM */
        .progress-container {
            width: 100%;
            height: 6px;
            background-color: var(--vscode-editorWidget-background, rgba(128, 128, 128, 0.1));
            border-radius: 3px;
            overflow: hidden;
        }

        .progress-bar {
            height: 100%;
            width: 2%; /* Статичное начальное значение */
            background-color: var(--vscode-progressBar-background, #007acc);
            border-radius: 3px;
            transition: width 0.3s ease;
        }

        .progress-subtext {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            text-align: right;
        }

        /* ==========================================================================
           Поле поиска
           ========================================================================== */
        .search-box {
            position: relative;
            width: 100%;
        }

        .search-input {
            width: 100%;
            padding: 6px 8px 6px 26px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, transparent);
            border-radius: 4px;
            font-size: 12px;
            outline: none;
        }

        .search-input:focus {
            border-color: var(--vscode-focusBorder);
        }

        .search-icon {
            position: absolute;
            left: 8px;
            top: 50%;
            transform: translateY(-50%);
            font-size: 11px;
            opacity: 0.6;
        }

        /* ==========================================================================
           Дерево файлов (статичный макет для демонстрации верстки)
           ========================================================================== */
        .tree-container {
            display: flex;
            flex-direction: column;
            gap: 2px;
            margin-top: 4px;
        }

        .tree-item {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 6px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        }

        .tree-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .tree-item.nested {
            margin-left: 18px;
        }

        .custom-checkbox {
            cursor: pointer;
            accent-color: var(--vscode-button-background);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header-title">AI Context Merger</div>

        <!-- 1. Главная акцентная кнопка -->
        <button class="btn-primary" onclick="sendMessage('copy')">
            <span>📋</span> СКОПИРОВАТЬ КОНТЕКСТ
        </button>

        <!-- 2. Ряд вспомогательных действий -->
        <div class="btn-secondary-row">
            <button class="btn-secondary" onclick="sendMessage('export')">
                <span>💾</span> Экспорт в .md
            </button>
            <button class="btn-secondary" onclick="sendMessage('preview')">
                <span>👁️</span> Превью
            </button>
        </div>

        <div class="btn-icon-row">
            <button class="btn-secondary" onclick="sendMessage('clear')">
                <span>🧹</span> Снять все
            </button>
            <button class="btn-secondary" onclick="sendMessage('refresh')">
                <span>🔄</span> Обновить
            </button>
        </div>

        <!-- 3. Карточка статистики -->
        <div class="stats-card">
            <div class="stats-header">
                <span>📊 Выбрано: <span class="stats-highlight" id="files-count">3 файла</span></span>
                <span class="stats-highlight" id="tokens-count">1,420 токенов</span>
            </div>
            <div class="progress-container">
                <div class="progress-bar" id="progress-fill" style="width: 2%;"></div>
            </div>
            <div class="progress-subtext" id="progress-text">~2% от окна 200k токенов</div>
        </div>

        <!-- 4. Поле быстрого поиска -->
        <div class="search-box">
            <span class="search-icon">🔍</span>
            <input type="text" class="search-input" placeholder="Быстрый поиск файлов...">
        </div>

        <!-- 5. Дерево файлов (Демонстрационная верстка) -->
        <div class="tree-container">
            <div class="tree-item">
                <input type="checkbox" class="custom-checkbox" checked>
                <span>📁</span>
                <strong>story</strong>
            </div>
            <div class="tree-item nested">
                <input type="checkbox" class="custom-checkbox" checked>
                <span>📄</span>
                <span>definitions.rpy</span>
            </div>
            <div class="tree-item nested">
                <input type="checkbox" class="custom-checkbox" checked>
                <span>📄</span>
                <span>gui.rpy</span>
            </div>
            <div class="tree-item nested">
                <input type="checkbox" class="custom-checkbox">
                <span>📄</span>
                <span>screens.rpy</span>
            </div>
        </div>
    </div>

    <script>
        // Инициализация API VS Code внутри Webview
        const vscode = acquireVsCodeApi();

        /**
         * Отправка команды из Webview в TypeScript расширение
         */
        function sendMessage(type) {
            vscode.postMessage({ type });
        }
    </script>
</body>
</html>`;
    }
}