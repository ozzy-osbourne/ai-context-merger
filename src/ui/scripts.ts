import { PROMPT_PRESETS } from '../constants/presets';

/**
 * Generates the client-side JavaScript for the controls Webview.
 *
 * @returns Client JavaScript code string.
 */
export function getScripts(): string {
  const presetsJson = JSON.stringify(PROMPT_PRESETS);

  return `
    /**
     * Acquisition of the VS Code Webview messaging and state API.
     */
    const vscode = acquireVsCodeApi();

    /**
     * Task instruction prompt presets dictionary.
     * @type {Record<string, string>}
     */
    const PRESET_TEXTS = ${presetsJson};

    /**
     * Session cache restored across Webview re-renders.
     * @type {{ promptEnabled?: boolean, promptText?: string }}
     */
    const previousState = vscode.getState() || {};

    const promptToggle = document.getElementById('promptToggle');
    const promptBody = document.getElementById('promptBody');
    const promptInput = document.getElementById('promptInput');
    const btnClearPrompt = document.getElementById('btnClearPrompt');
    const btnSelectAll = document.getElementById('btnSelectAll');
    const searchInput = document.getElementById('searchInput');

    // Restore cached state immediately to eliminate UI flicker
    promptToggle.checked = Boolean(previousState.promptEnabled);
    promptInput.value = previousState.promptText || '';
    if (promptToggle.checked) {
      promptBody.classList.remove('hidden');
    }

    /**
     * Active search query string.
     * @type {string}
     */
    let currentSearchQuery = '';

    /**
     * Timer handle for debouncing search input events.
     * @type {number | undefined}
     */
    let searchDebounceTimer;

    /**
     * Persists current UI state into the Webview session storage.
     * @returns {void}
     */
    function saveState() {
      vscode.setState({
        promptEnabled: promptToggle.checked,
        promptText: promptInput.value
      });
    }

    /**
     * Toggles visibility of the instruction clear button based on text length.
     * @returns {void}
     */
    function updateClearPromptButtonVisibility() {
      const hasText = promptInput.value.trim().length > 0;
      if (promptToggle.checked && hasText) {
        btnClearPrompt.classList.remove('hidden');
      } else {
        btnClearPrompt.classList.add('hidden');
      }
    }

    /**
     * Synchronizes current prompt settings with the VS Code extension host.
     * @returns {void}
     */
    function syncPromptWithExtension() {
      updateClearPromptButtonVisibility();
      saveState();
      vscode.postMessage({
        type: 'updatePrompt',
        enabled: promptToggle.checked,
        text: promptInput.value
      });
    }

    updateClearPromptButtonVisibility();

    promptToggle.addEventListener('change', () => {
      if (promptToggle.checked) {
        promptBody.classList.remove('hidden');
      } else {
        promptBody.classList.add('hidden');
      }
      syncPromptWithExtension();
    });

    promptInput.addEventListener('input', () => {
      syncPromptWithExtension();
    });

    btnClearPrompt.addEventListener('click', (e) => {
      e.stopPropagation();
      promptInput.value = '';
      promptInput.focus();
      syncPromptWithExtension();
    });

    document.querySelectorAll('.preset-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = chip.getAttribute('data-preset');
        if (PRESET_TEXTS[key]) {
          promptInput.value = PRESET_TEXTS[key];
          syncPromptWithExtension();
        }
      });
    });

    /**
     * Handles IPC messages dispatched from the extension backend.
     * @param {MessageEvent} event - Incoming postMessage payload event.
     * @returns {void}
     */
    window.addEventListener('message', event => {
      const message = event.data;
      if (!message || typeof message.type !== 'string') return;

      if (message.type === 'setData') {
        if (message.stats) updateStatsUI(message.stats);
        if (message.filters) {
          document.getElementById('filterGit').checked = Boolean(message.filters.hideGitIgnored);
          document.getElementById('filterLock').checked = Boolean(message.filters.hideLockFiles);
          document.getElementById('filterBinary').checked = Boolean(message.filters.hideBinaryFiles);
        }
        if (message.promptSettings) {
          promptToggle.checked = Boolean(message.promptSettings.enabled);
          promptInput.value = message.promptSettings.text || '';
          if (promptToggle.checked) {
            promptBody.classList.remove('hidden');
          } else {
            promptBody.classList.add('hidden');
          }
          updateClearPromptButtonVisibility();
          saveState();
        }
      } else if (message.type === 'updateStats') {
        if (message.stats) updateStatsUI(message.stats);
      } else if (message.type === 'searchResults') {
        if (message.query) {
          btnSelectAll.innerText = '✅ Выбрать найденное (' + message.count + ')';
        } else {
          btnSelectAll.innerText = '✅ Выбрать всё';
        }
      }
    });

    document.getElementById('btnCopy').addEventListener('click', () => vscode.postMessage({ type: 'copyContext' }));
    document.getElementById('btnPreview').addEventListener('click', () => vscode.postMessage({ type: 'previewContext' }));
    document.getElementById('btnExport').addEventListener('click', () => vscode.postMessage({ type: 'exportFile' }));
    document.getElementById('btnClear').addEventListener('click', () => vscode.postMessage({ type: 'clearSelection' }));
    document.getElementById('btnExpandAll').addEventListener('click', () => vscode.postMessage({ type: 'expandAll' }));
    document.getElementById('btnCollapse').addEventListener('click', () => vscode.postMessage({ type: 'collapseAll' }));
    document.getElementById('btnRefresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    document.getElementById('btnGit').addEventListener('click', () => vscode.postMessage({ type: 'selectModified' }));

    btnSelectAll.addEventListener('click', () => {
      if (currentSearchQuery) {
        vscode.postMessage({ type: 'selectFound', query: currentSearchQuery });
      } else {
        vscode.postMessage({ type: 'selectAll' });
      }
    });

    /**
     * Broadcasts updated exclusion filter toggles to the extension backend.
     * @returns {void}
     */
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

    searchInput.addEventListener('input', (e) => {
      currentSearchQuery = e.target.value.trim();
      if (!currentSearchQuery) {
        btnSelectAll.innerText = '✅ Выбрать всё';
      }

      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        vscode.postMessage({
          type: 'updateSearch',
          query: currentSearchQuery
        });
      }, 300);
    });

    /**
     * Renders numeric metrics and updates the token budget progress bar fill color.
     * @param {{ count: number, tokens: number, percentage: number }} stats - Calculated context statistics.
     * @returns {void}
     */
    function updateStatsUI(stats) {
      document.getElementById('statCount').innerText = stats.count;
      document.getElementById('statTokens').innerText = '~' + stats.tokens.toLocaleString();

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

    vscode.postMessage({ type: 'requestInitialData' });
  `;
}