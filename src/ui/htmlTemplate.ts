import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { getStyles } from './styles';
import { getScripts } from './scripts';

/**
 * Generates a cryptographically strong random nonce for CSP authentication.
 *
 * @returns Base64-encoded nonce token.
 */
function getNonce(): string {
    return crypto.randomBytes(16).toString('base64');
}

/**
 * Generates the complete HTML document for the sidebar Webview.
 *
 * @param webview - The VS Code Webview instance.
 * @returns Fully assembled HTML string.
 */
export function getHtmlTemplate(webview: vscode.Webview): string {
    const nonce = getNonce();
    const styles = getStyles();
    const scripts = getScripts();

    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
    <style>${styles}</style>
</head>
<body>

    <div class="header-title">AI Context Merger</div>

    <div class="prompt-card">
        <div class="prompt-header">
            <label>
                <input type="checkbox" id="promptToggle">
                <span>✍️ Инструкция для ИИ</span>
            </label>
            <button type="button" class="btn-clear-prompt hidden" id="btnClearPrompt" title="Очистить текст инструкции">✕ Стереть</button>
        </div>
        <div class="prompt-body hidden" id="promptBody">
            <textarea
                id="promptInput"
                class="prompt-textarea"
                placeholder="Опишите вашу задачу здесь"
            ></textarea>
            <div class="preset-chips">
                <button type="button" class="preset-chip" data-preset="🔍 Баги">🔍 Баги</button>
                <button type="button" class="preset-chip" data-preset="⚡ Рефакторинг">⚡ Рефакторинг</button>
                <button type="button" class="preset-chip" data-preset="📝 Тесты">📝 Тесты</button>
                <button type="button" class="preset-chip" data-preset="📖 Документация">📖 Документация</button>
            </div>
        </div>
    </div>

    <button class="btn-primary" id="btnCopy">
        <span>📋</span> СКОПИРОВАТЬ КОНТЕКСТ
    </button>

    <div class="btn-grid-2">
        <button class="btn-secondary" id="btnPreview">👁️ Превью .md</button>
        <button class="btn-secondary" id="btnExport">💾 Экспорт в .md</button>
    </div>

    <div class="btn-grid-2">
        <button class="btn-secondary" id="btnSelectAll">✅ Выбрать всё</button>
        <button class="btn-secondary" id="btnClear">🧹 Снять всё</button>
    </div>

    <div class="btn-grid-2">
        <button class="btn-secondary" id="btnExpandAll">📂 Развернуть всё</button>
        <button class="btn-secondary" id="btnCollapse">📁 Свернуть всё</button>
    </div>

    <div class="btn-grid-2">
        <button class="btn-secondary" id="btnRefresh">🔄 Обновить</button>
        <button class="btn-secondary" id="btnGit">🌿 Измененные (Git)</button>
    </div>

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
            <span><strong id="statCount" class="stats-metric">0</strong> файлов | <strong id="statTokens" class="stats-metric">~0</strong> токенов</span>
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

    <script nonce="${nonce}">${scripts}</script>
</body>
</html>`;
}