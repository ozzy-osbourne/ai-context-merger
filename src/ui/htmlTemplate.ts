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
    <html lang="en">

    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
      <style>${styles}</style>
    </head>

    <body>

      <div class="top-header">
        <div class="header-title" id="lblHeaderTitle">AI Context Merger</div>
        <div class="header-actions">
          <div class="language-select-wrapper" title="Select Interface Language">
            <span class="language-globe">🌐</span>
            <select id="languageSelect" class="language-select">
              <option value="auto">AUTO</option>
              <option value="en">EN</option>
              <option value="ru">RU</option>
              <option value="zh-cn">ZH</option>
              <option value="es">ES</option>
              <option value="pt-br">PT</option>
              <option value="ja">JA</option>
              <option value="de">DE</option>
            </select>
            <span class="select-chevron">▾</span>
          </div>
          <button type="button" class="btn-top-refresh" id="btnRefreshTop" title="Refresh">
            <span>🔄</span>
          </button>
        </div>
      </div>

      <div class="prompt-card">
        <div class="prompt-header">
          <label id="lblPromptToggleWrap" title="Enable AI Instructions">
            <input type="checkbox" id="promptToggle">
            <span id="lblPromptTitle">✍️ AI Instructions</span>
          </label>
          <button type="button" class="btn-clear-prompt hidden" id="btnClearPrompt" title="Clear">✕ Clear</button>
        </div>
        <div class="prompt-body hidden" id="promptBody">
          <textarea id="promptInput" class="prompt-textarea" placeholder="Describe your task here..." maxlength="10000"></textarea>
          
          <div class="preset-section-label" id="lblBasePresets">Presets:</div>
          <div class="preset-chips" id="baseChipsContainer">
            <!-- Dynamic standard preset chips rendered securely via IPC -->
          </div>

          <div class="preset-section-label custom-preset-label" id="lblCustomPresets">Custom:</div>
          <div class="preset-chips" id="customChipsContainer">
            <!-- Dynamic custom chips rendered securely via IPC -->
          </div>

          <button type="button" class="btn-show-add-preset" id="btnShowAddPreset" title="Save current text as preset">
            <span>+</span> <span id="lblSaveCurrentAsPreset">Save current text as preset</span>
          </button>

          <div class="inline-add-form hidden" id="inlineAddForm">
            <div class="inline-add-title" id="inlineFormTitle">💾 Save current text as preset:</div>
            <div class="inline-add-row">
              <input type="text" id="customPresetNameInput" class="inline-add-input" placeholder="Icon + Name" maxlength="32" />
              <button type="button" class="btn-inline-save" id="btnSavePreset">Save</button>
              <button type="button" class="btn-inline-cancel" id="btnCancelPreset">Cancel</button>
            </div>
          </div>
        </div>
      </div>

      <div class="format-card">
        <div class="format-title"><span id="lblFormatIcon">📄</span> <span id="lblFormatTitle">Output Format:</span></div>
        <div class="format-options">
          <label class="format-option" id="lblFormatMarkdownWrap" title="Markdown format">
            <input type="radio" name="outputFormat" id="formatMarkdown" value="markdown" checked>
            <span class="format-label">Markdown</span>
          </label>
          <label class="format-option" id="lblFormatXmlWrap" title="XML format">
            <input type="radio" name="outputFormat" id="formatXml" value="xml">
            <span class="format-label">XML (Claude)</span>
          </label>
        </div>
      </div>

      <button class="btn-primary" id="btnCopy" title="Copy Context">
        <span>📋</span> <span id="lblBtnCopy">COPY CONTEXT</span>
      </button>

      <div class="btn-grid-2">
        <button class="btn-secondary" id="btnPreview" title="Preview">👁️ Preview .md</button>
        <button class="btn-secondary" id="btnExport" title="Export">💾 Export to .md</button>
      </div>

      <div class="btn-grid-2">
        <button class="btn-secondary" id="btnOpenTabs" title="Open Tabs">📑 Open Tabs</button>
        <button class="btn-secondary" id="btnGit" title="Changed (Git)">🌿 Changed (Git)</button>
      </div>

      <div class="btn-grid-2">
        <button class="btn-secondary" id="btnSelectAll" title="Select All">✅ Select All</button>
        <button class="btn-secondary" id="btnClear" title="Clear All">🧹 Clear All</button>
      </div>

      <div class="btn-grid-2">
        <button class="btn-secondary" id="btnExpandAll" title="Expand Level">📂 Expand Level</button>
        <button class="btn-secondary" id="btnCollapse" title="Collapse All">📁 Collapse All</button>
      </div>

      <div class="addons-card">
        <div class="addon-block">
          <label class="addon-header-label" id="lblProjectStructureWrap" title="Attach project structure">
            <input type="checkbox" id="projectStructureToggle" checked>
            <span id="lblProjectStructure">📁 Attach project structure</span>
          </label>
        </div>

        <div class="addons-card-divider"></div>

        <div class="addon-block">
          <label class="addon-header-label" id="lblGitDiffWrap" title="Attach Git Diff">
            <input type="checkbox" id="gitDiffToggle">
            <span id="lblGitDiff">🌿 Attach Git Diff</span>
          </label>
          <div class="addon-suboptions hidden" id="gitDiffSuboptions">
            <label class="addon-suboption" id="lblDiffOnlyWrap" title="Diff Only">
              <input type="checkbox" id="diffOnlyToggle">
              <span id="lblDiffOnly">Diff Only (no files)</span>
            </label>
            <label class="addon-suboption" id="lblUnlimitedDiffWrap" title="Unlimited Diff">
              <input type="checkbox" id="unlimitedDiffToggle">
              <span id="lblUnlimitedDiff">Unlimited Diff</span>
            </label>
          </div>
        </div>

        <div class="addons-card-divider"></div>

        <div class="addon-block">
          <label class="addon-header-label" id="lblDiagnosticsWrap" title="Attach diagnostics">
            <input type="checkbox" id="diagnosticsToggle">
            <span id="lblDiagnostics">⚠️ Attach diagnostics</span>
          </label>
          <div class="addon-suboptions hidden" id="diagnosticsSuboptions">
            <label class="addon-suboption" id="lblDiagCompilerWrap" title="Compiler errors">
              <input type="checkbox" id="diagnosticsCompilerToggle" checked>
              <span id="diagnosticsCompilerLabel">Compiler errors (0)</span>
            </label>
            <label class="addon-suboption" id="lblDiagLinterWrap" title="Linter errors">
              <input type="checkbox" id="diagnosticsLinterToggle">
              <span id="diagnosticsLinterLabel">Linter errors (0)</span>
            </label>
          </div>
        </div>
      </div>

      <div class="filter-section">
        <div class="filter-title"><span id="lblFilterIcon">⚙️</span> <span id="lblFilterTitle">Exclusion Filters:</span></div>
        <div class="filter-row">
          <label class="filter-item" id="lblFilterGitWrap" title=".gitignore">
            <input type="checkbox" id="filterGit" checked> <span id="lblFilterGit">.gitignore</span>
          </label>
          <label class="filter-item" id="lblFilterSecretsWrap" title="Keys & .env">
            <input type="checkbox" id="filterSecrets" checked> <span id="lblFilterSecrets">Keys & .env</span>
          </label>
          <label class="filter-item" id="lblFilterMinifiedWrap" title="Build & .map">
            <input type="checkbox" id="filterMinified" checked> <span id="lblFilterMinified">Build & .map</span>
          </label>
          <label class="filter-item" id="lblFilterLockWrap" title="Lock files">
            <input type="checkbox" id="filterLock" checked> <span id="lblFilterLock">Lock files</span>
          </label>
          <label class="filter-item" id="lblFilterBinaryWrap" title="Media & Binaries">
            <input type="checkbox" id="filterBinary" checked> <span id="lblFilterBinary">Media & Binaries</span>
          </label>
        </div>
      </div>

      <div class="stats-card">
        <div class="stats-header">
          <span class="stats-title" id="lblStatsTitle">📊 Statistics:</span>
          <div class="stats-values">
            <span class="stats-value-row"><strong id="statCount" class="stats-metric">0</strong> <span id="lblStatFiles">files</span></span>
            <span class="stats-value-row"><strong id="statTokens" class="stats-metric">~0</strong> <span id="lblStatTokens">tokens</span></span>
          </div>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar-fill" id="progressBar"></div>
        </div>
        <div class="progress-footer">
          <span class="warning-overflow hidden" id="tokenOverflowWarning">⚠️ Context limit exceeded!</span>
          <div class="progress-footer-right">
            <span class="progress-percent" id="progressPercent">0%</span>
            <span class="progress-of" id="lblProgressOf">of</span>
            <div class="token-select-wrapper">
              <select id="tokenLimitSelect" class="token-limit-select" title="Select model context window limit">
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
        <input type="text" id="searchInput" class="search-input" placeholder="Quick file search..." title="Filter files in tree by name" />
        <button type="button" class="btn-clear-search hidden" id="btnClearSearch" title="Clear search query">✕</button>
      </div>

      <script nonce="${nonce}">${scripts}</script>
    </body>

    </html>
  `;
}