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
 * Generates the complete HTML document for the controls Webview panel.
 *
 * @param webview - The VS Code Webview instance.
 * @returns Fully assembled HTML string.
 */
export function getHtmlTemplate(webview: vscode.Webview): string {
  const nonce = getNonce();
  const styles = getStyles();
  const scripts = getScripts();

  return `
    <!DOCTYPE html>
    <html lang="ru">

    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
      <style>${styles}</style>
    </head>

    <body>

      <div class="top-header">
        <div class="header-title">AI Context Merger</div>
        <button type="button" class="btn-top-refresh" id="btnRefreshTop" title="Обновить дерево файлов, статусы Git и ошибки линтера. Выбранные файлы, промпт и настройки интерфейса сохраняются (без сброса состояний).">
          <span>🔄</span> Обновить
        </button>
      </div>

      <div class="prompt-card">
        <div class="prompt-header">
          <label title="Включить или выключить блок дополнительного задания для ИИ">
            <input type="checkbox" id="promptToggle">
            <span>✍️ Инструкция для ИИ</span>
          </label>
          <button type="button" class="btn-clear-prompt hidden" id="btnClearPrompt" title="Очистить текст инструкции">✕ Стереть</button>
        </div>
        <div class="prompt-body hidden" id="promptBody">
          <textarea id="promptInput" class="prompt-textarea" placeholder="Опишите вашу задачу здесь"></textarea>
          
          <div class="preset-section-label">Базовые:</div>
          <div class="preset-chips">
            <button type="button" class="preset-chip" data-preset="🔍 Баги" title="Вставить универсальный шаблон поиска ошибок и крайних случаев">🔍 Баги</button>
            <button type="button" class="preset-chip" data-preset="⚡ Рефакторинг" title="Вставить универсальный шаблон рефакторинга и идиоматичности">⚡ Рефакторинг</button>
            <button type="button" class="preset-chip" data-preset="📝 Тесты" title="Вставить универсальный шаблон модульных тестов">📝 Тесты</button>
            <button type="button" class="preset-chip" data-preset="📖 Документация" title="Вставить универсальный шаблон документации к коду">📖 Документация</button>
          </div>

          <div class="preset-section-label custom-preset-label">Пользовательские:</div>
          <div class="preset-chips" id="customChipsContainer">
            <!-- Custom chips rendered here -->
          </div>

          <button type="button" class="btn-show-add-preset" id="btnShowAddPreset" title="Сохранить введённый выше текст инструкции как постоянный пресет">
            <span>+</span> Сохранить текущий текст как пресет
          </button>

          <div class="inline-add-form hidden" id="inlineAddForm">
            <div class="inline-add-title" id="inlineFormTitle">▼ Сохранить текущий текст как пресет:</div>
            <div class="inline-add-row">
              <input type="text" id="customPresetNameInput" class="inline-add-input" placeholder="Иконка + Название" maxlength="32" />
              <button type="button" class="btn-inline-save" id="btnSavePreset">Сохранить</button>
              <button type="button" class="btn-inline-cancel" id="btnCancelPreset">Отмена</button>
            </div>
          </div>
        </div>
      </div>

      <div class="format-card">
        <div class="format-title"><span>📄</span> Формат вывода:</div>
        <div class="format-options">
          <label class="format-option" title="Формат Markdown: стандартные блоки кода с подсветкой. Оптимально для ChatGPT, Gemini, DeepSeek">
            <input type="radio" name="outputFormat" id="formatMarkdown" value="markdown" checked>
            <span class="format-label">Markdown</span>
          </label>
          <label class="format-option" title="Формат XML: теги с изоляцией кода в CDATA. Официальный стандарт Anthropic">
            <input type="radio" name="outputFormat" id="formatXml" value="xml">
            <span class="format-label">XML (Claude)</span>
          </label>
        </div>
      </div>

      <button class="btn-primary" id="btnCopy" title="Собрать выбранные файлы и скопировать готовый контекст в буфер обмена">
        <span>📋</span> СКОПИРОВАТЬ КОНТЕКСТ
      </button>

      <div class="btn-grid-2">
        <button class="btn-secondary" id="btnPreview" title="Открыть сгенерированный контекст во вкладке рядом для предварительного просмотра">👁️ Превью .md</button>
        <button class="btn-secondary" id="btnExport" title="Сохранить итоговый файл с контекстом на диск">💾 Экспорт в .md</button>
      </div>

      <div class="btn-grid-2">
        <button class="btn-secondary" id="btnOpenTabs" title="Выбрать все доступные файлы, открытые прямо сейчас во вкладках редактора">📑 Открытые вкладки</button>
        <button class="btn-secondary" id="btnGit" title="Выбрать только измененные (Modified), новые (Untracked) и удаленные (Deleted) файлы Git">🌿 Измененные (Git)</button>
      </div>

      <div class="btn-grid-2">
        <button class="btn-secondary" id="btnSelectAll" title="Выбрать все доступные файлы в рабочей области (или найденные при поиске)">✅ Выбрать всё</button>
        <button class="btn-secondary" id="btnClear" title="Снять выделение со всех файлов проекта">🧹 Снять всё</button>
      </div>

      <div class="btn-grid-2">
        <button class="btn-secondary" id="btnExpandAll" title="Развернуть папки дерева файлов на один уровень вглубь">📂 Развернуть уровень</button>
        <button class="btn-secondary" id="btnCollapse" title="Свернуть все папки дерева файлов проекта">📁 Свернуть всё</button>
      </div>

      <!-- Единый контейнер дополнений: Git Diff и Диагностика (ошибки компилятора и линтера) -->
      <div class="addons-card">
        <div class="addon-block">
          <label class="addon-header-label" title="Прикрепить блок git diff изменений выбранных файлов в итоговый контекст">
            <input type="checkbox" id="gitDiffToggle">
            <span>🌿 Прикрепить Git Diff</span>
          </label>
          <div class="addon-suboptions hidden" id="gitDiffSuboptions">
            <label class="addon-suboption" title="Исключить полный код файлов, оставив только дерево проекта и git diff">
              <input type="checkbox" id="diffOnlyToggle">
              <span>Только Diff (без файлов)</span>
            </label>
            <label class="addon-suboption" title="Не обрезать большие диффы (по умолчанию лимит 100 KB на один файл)">
              <input type="checkbox" id="unlimitedDiffToggle">
              <span>Безлимитный Diff</span>
            </label>
          </div>
        </div>

        <div class="addons-card-divider"></div>

        <div class="addon-block">
          <label class="addon-header-label" title="Прикрепить список ошибок компилятора и линтера для выбранных файлов">
            <input type="checkbox" id="diagnosticsToggle">
            <span>⚠️ Прикрепить диагностику</span>
          </label>
          <div class="addon-suboptions hidden" id="diagnosticsSuboptions">
            <label class="addon-suboption" title="Включать ошибки компилятора и проверки типов (TypeScript, rustc, mypy, clang и др.)">
              <input type="checkbox" id="diagnosticsCompilerToggle" checked>
              <span id="diagnosticsCompilerLabel">Ошибки компилятора (0)</span>
            </label>
            <label class="addon-suboption" title="Включать замечания линтера и статических анализаторов (ESLint, Ruff, Clippy, Biome и др.)">
              <input type="checkbox" id="diagnosticsLinterToggle" checked>
              <span id="diagnosticsLinterLabel">Ошибки линтера (0)</span>
            </label>
          </div>
        </div>
      </div>

      <div class="filter-section">
        <div class="filter-title"><span>⚙️</span> Фильтры скрытия:</div>
        <div class="filter-row">
          <label class="filter-item" title="Скрывать файлы и папки, указанные в файлах .gitignore">
            <input type="checkbox" id="filterGit" checked> .gitignore
          </label>
          <label class="filter-item" title="Исключать файлы секретов, ключей, сертификатов и переменных окружения (.env, *.key, *.pem, *.tfvars, id_rsa)">
            <input type="checkbox" id="filterSecrets" checked> Ключи и .env
          </label>
          <label class="filter-item" title="Исключать карты кода и минифицированные бандлы (*.map, *.min.js, *.min.css, *.bundle.js)">
            <input type="checkbox" id="filterMinified" checked> Сборка и .map
          </label>
          <label class="filter-item" title="Исключать служебные lock-файлы зависимостей (package-lock.json, yarn.lock и др.)">
            <input type="checkbox" id="filterLock" checked> Lock-файлы
          </label>
          <label class="filter-item" title="Исключать скомпилированные бинарники, медиа-файлы и шрифты">
            <input type="checkbox" id="filterBinary" checked> Медиа и бинарники
          </label>
        </div>
      </div>

      <div class="stats-card">
        <div class="stats-header">
          <span>📊 Статистика:</span>
          <span><strong id="statCount" class="stats-metric">0</strong> файлов | <strong id="statTokens"
              class="stats-metric">~0</strong> токенов</span>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar-fill" id="progressBar"></div>
        </div>
        <div class="progress-footer">
          <span class="warning-overflow hidden" id="tokenOverflowWarning">⚠️ Контекст переполнен!</span>
          <div class="progress-footer-right">
            <span class="progress-percent" id="progressPercent">0%</span>
            <span class="progress-of">от</span>
            <div class="token-select-wrapper">
              <select id="tokenLimitSelect" class="token-limit-select" title="Выбрать лимит контекстного окна LLM">
                <option value="32000">32k</option>
                <option value="64000">64k</option>
                <option value="128000">128k</option>
                <option value="200000" selected>200k</option>
                <option value="1000000">1M</option>
                <option value="2000000">2M</option>
              </select>
              <span class="select-chevron">▾</span>
            </div>
          </div>
        </div>
      </div>

      <div class="search-container">
        <span class="search-icon">🔍</span>
        <input type="text" id="searchInput" class="search-input" placeholder="Быстрый поиск файлов..." title="Фильтрация файлов в дереве по имени" />
        <button type="button" class="btn-clear-search hidden" id="btnClearSearch" title="Очистить поисковый запрос">✕</button>
      </div>

      <script nonce="${nonce}">${scripts}</script>
    </body>

    </html>
  `;
}