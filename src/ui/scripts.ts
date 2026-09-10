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
     * Default token limit fallback value.
     * @type {string}
     */
    const DEFAULT_TOKEN_LIMIT = '200000';

    /**
     * Whitelist of allowable token context window limits.
     * @type {readonly string[]}
     */
    const VALID_TOKEN_LIMITS = ['32000', '64000', '128000', '200000', '1000000', '2000000'];

    /**
     * Session cache restored across Webview re-renders.
     * @type {{ promptEnabled?: boolean, promptText?: string, tokenLimit?: string, gitDiffEnabled?: boolean, diffOnly?: boolean, unlimitedDiff?: boolean }}
     */
    const previousState = vscode.getState() || {};

    const promptToggle = document.getElementById('promptToggle');
    const promptBody = document.getElementById('promptBody');
    const promptInput = document.getElementById('promptInput');
    const btnClearPrompt = document.getElementById('btnClearPrompt');
    const btnSelectAll = document.getElementById('btnSelectAll');
    const searchInput = document.getElementById('searchInput');
    const btnClearSearch = document.getElementById('btnClearSearch');
    const tokenLimitSelect = document.getElementById('tokenLimitSelect');
    const tokenOverflowWarning = document.getElementById('tokenOverflowWarning');

    const gitDiffToggle = document.getElementById('gitDiffToggle');
    const gitDiffSuboptions = document.getElementById('gitDiffSuboptions');
    const diffOnlyToggle = document.getElementById('diffOnlyToggle');
    const unlimitedDiffToggle = document.getElementById('unlimitedDiffToggle');

    // Preset Controls
    const customChipsContainer = document.getElementById('customChipsContainer');
    const btnShowAddPreset = document.getElementById('btnShowAddPreset');
    const inlineAddForm = document.getElementById('inlineAddForm');
    const inlineFormTitle = document.getElementById('inlineFormTitle');
    const customPresetNameInput = document.getElementById('customPresetNameInput');
    const btnSavePreset = document.getElementById('btnSavePreset');
    const btnCancelPreset = document.getElementById('btnCancelPreset');

    /**
     * Current user custom presets array in memory.
     * @type {Array<{ id: string, name: string, text: string }>}
     */
    let customPresets = [];

    /**
     * ID of the preset currently in edit mode, or null if creating a new one.
     * @type {string | null}
     */
    let editingPresetId = null;

    /**
     * Stored draft prompt text to restore when cancelling preset editing.
     * @type {string | null}
     */
    let backupPromptText = null;

    // Restore prompt toggle and text from state
    promptToggle.checked = Boolean(previousState.promptEnabled);
    promptInput.value = previousState.promptText || '';
    if (promptToggle.checked) {
      promptBody.classList.remove('hidden');
    }

    // Restore Git Diff toggles from state
    gitDiffToggle.checked = Boolean(previousState.gitDiffEnabled);
    diffOnlyToggle.checked = Boolean(previousState.diffOnly);
    unlimitedDiffToggle.checked = Boolean(previousState.unlimitedDiff);
    if (gitDiffToggle.checked) {
      gitDiffSuboptions.classList.remove('hidden');
    }

    // Safely restore token limit with fallback validation
    let restoredLimit = DEFAULT_TOKEN_LIMIT;
    if (previousState.tokenLimit && VALID_TOKEN_LIMITS.includes(String(previousState.tokenLimit))) {
      restoredLimit = String(previousState.tokenLimit);
    }
    tokenLimitSelect.value = restoredLimit;
    if (tokenLimitSelect.selectedIndex === -1) {
      tokenLimitSelect.value = DEFAULT_TOKEN_LIMIT;
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
     * Most recent token estimate received from the extension backend.
     * @type {number}
     */
    let currentEstimatedTokens = 0;

    /**
     * Persists current UI state into the Webview session storage.
     * @returns {void}
     */
    function saveState() {
      const activeLimit = VALID_TOKEN_LIMITS.includes(tokenLimitSelect.value)
        ? tokenLimitSelect.value
        : DEFAULT_TOKEN_LIMIT;

      vscode.setState({
        promptEnabled: promptToggle.checked,
        promptText: promptInput.value,
        tokenLimit: activeLimit,
        gitDiffEnabled: gitDiffToggle.checked,
        diffOnly: diffOnlyToggle.checked,
        unlimitedDiff: unlimitedDiffToggle.checked
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
     * Toggles visibility of the search clear button based on text input length.
     * @returns {void}
     */
    function updateClearSearchButtonVisibility() {
      if (searchInput.value.length > 0) {
        btnClearSearch.classList.remove('hidden');
      } else {
        btnClearSearch.classList.add('hidden');
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

    /**
     * Synchronizes current Git Diff settings with the VS Code extension host.
     * @returns {void}
     */
    function syncGitDiffWithExtension() {
      saveState();
      vscode.postMessage({
        type: 'updateGitDiff',
        settings: {
          includeGitDiff: gitDiffToggle.checked,
          diffOnly: diffOnlyToggle.checked,
          unlimitedDiff: unlimitedDiffToggle.checked
        }
      });
    }

    /**
     * Recalculates progress bar width, percentage caption, warning colors, and overflow alerts.
     * @returns {void}
     */
    function renderProgressIndicator() {
      if (!VALID_TOKEN_LIMITS.includes(tokenLimitSelect.value) || tokenLimitSelect.selectedIndex === -1) {
        tokenLimitSelect.value = DEFAULT_TOKEN_LIMIT;
      }

      const maxLimit = parseInt(tokenLimitSelect.value, 10) || 200000;
      const percentage = Math.min(100, Math.round((currentEstimatedTokens / maxLimit) * 100));

      const bar = document.getElementById('progressBar');
      bar.style.width = percentage + '%';

      if (percentage < 33) {
        bar.style.backgroundColor = 'var(--color-green)';
      } else if (percentage < 66) {
        bar.style.backgroundColor = 'var(--color-yellow)';
      } else {
        bar.style.backgroundColor = 'var(--color-red)';
      }

      document.getElementById('progressPercent').innerText = percentage + '%';

      if (currentEstimatedTokens > maxLimit) {
        tokenOverflowWarning.classList.remove('hidden');
      } else {
        tokenOverflowWarning.classList.add('hidden');
      }
    }

    /**
     * Switches inline form into edit mode for a target preset.
     * @param {{ id: string, name: string, text: string }} preset
     */
    function startEditingPreset(preset) {
      if (editingPresetId === null) {
        backupPromptText = promptInput.value;
      }
      editingPresetId = preset.id;
      promptInput.value = preset.text;
      syncPromptWithExtension();

      inlineFormTitle.innerText = '▼ Редактирование пресета:';
      customPresetNameInput.value = preset.name;
      btnShowAddPreset.classList.add('hidden');
      inlineAddForm.classList.remove('hidden');
      customPresetNameInput.focus();

      renderCustomChips(customPresets);
    }

    /**
     * Cancels edit mode and resets the inline preset form.
     */
    function cancelEditingPreset() {
      if (editingPresetId !== null && backupPromptText !== null) {
        promptInput.value = backupPromptText;
        backupPromptText = null;
        syncPromptWithExtension();
      }
      editingPresetId = null;
      inlineAddForm.classList.add('hidden');
      btnShowAddPreset.classList.remove('hidden');
      customPresetNameInput.value = '';
      inlineFormTitle.innerText = '▼ Сохранить текущий текст как пресет:';
      renderCustomChips(customPresets);
    }

    /**
     * Renders custom presets chips into DOM.
     * @param {Array<{ id: string, name: string, text: string }>} presets
     */
    function renderCustomChips(presets) {
      customPresets = presets || [];
      customChipsContainer.innerHTML = '';

      if (customPresets.length === 0) {
        const emptyHint = document.createElement('span');
        emptyHint.style.fontSize = '10px';
        emptyHint.style.color = 'var(--vscode-descriptionForeground)';
        emptyHint.innerText = 'Нет сохраненных пресетов';
        customChipsContainer.appendChild(emptyHint);
        return;
      }

      customPresets.forEach(preset => {
        const chip = document.createElement('div');
        chip.className = 'preset-chip' + (editingPresetId === preset.id ? ' editing' : '');

        // Use preset button
        const labelBtn = document.createElement('button');
        labelBtn.type = 'button';
        labelBtn.className = 'chip-label-btn';
        labelBtn.innerText = preset.name;
        labelBtn.title = preset.text;
        labelBtn.addEventListener('click', () => {
          promptInput.value = preset.text;
          syncPromptWithExtension();
        });
        chip.appendChild(labelBtn);

        const actions = document.createElement('span');
        actions.className = 'chip-actions';

        // Edit button
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'chip-edit-btn';
        editBtn.innerText = '✏️';
        editBtn.title = 'Редактировать этот пресет';
        editBtn.setAttribute('aria-label', 'Редактировать пресет ' + preset.name);
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          startEditingPreset(preset);
        });
        actions.appendChild(editBtn);

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'chip-delete-btn';
        deleteBtn.innerText = '✕';
        deleteBtn.title = 'Удалить этот пресет';
        deleteBtn.setAttribute('aria-label', 'Удалить пресет ' + preset.name);
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (editingPresetId === preset.id) {
            cancelEditingPreset();
          }
          vscode.postMessage({
            type: 'deleteCustomPreset',
            id: preset.id
          });
        });
        actions.appendChild(deleteBtn);

        chip.appendChild(actions);
        customChipsContainer.appendChild(chip);
      });
    }

    updateClearPromptButtonVisibility();
    updateClearSearchButtonVisibility();
    saveState();

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

    gitDiffToggle.addEventListener('change', () => {
      if (gitDiffToggle.checked) {
        gitDiffSuboptions.classList.remove('hidden');
      } else {
        gitDiffSuboptions.classList.add('hidden');
      }
      syncGitDiffWithExtension();
    });

    diffOnlyToggle.addEventListener('change', () => {
      syncGitDiffWithExtension();
    });

    unlimitedDiffToggle.addEventListener('change', () => {
      syncGitDiffWithExtension();
    });

    btnClearPrompt.addEventListener('click', (e) => {
      e.stopPropagation();
      promptInput.value = '';
      promptInput.focus();
      syncPromptWithExtension();
    });

    btnClearSearch.addEventListener('click', (e) => {
      e.stopPropagation();
      searchInput.value = '';
      currentSearchQuery = '';
      updateClearSearchButtonVisibility();
      btnSelectAll.innerText = '✅ Выбрать всё';
      searchInput.focus();

      clearTimeout(searchDebounceTimer);
      vscode.postMessage({
        type: 'updateSearch',
        query: ''
      });
    });

    tokenLimitSelect.addEventListener('change', () => {
      saveState();
      renderProgressIndicator();
    });

    document.querySelectorAll('.preset-chip[data-preset]').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = chip.getAttribute('data-preset');
        if (PRESET_TEXTS[key]) {
          promptInput.value = PRESET_TEXTS[key];
          syncPromptWithExtension();
        }
      });
    });

    // Custom Preset Inline Form Listeners
    btnShowAddPreset.addEventListener('click', () => {
      editingPresetId = null;
      inlineFormTitle.innerText = '▼ Сохранить текущий текст как пресет:';
      btnShowAddPreset.classList.add('hidden');
      inlineAddForm.classList.remove('hidden');
      customPresetNameInput.value = '';
      customPresetNameInput.focus();
      renderCustomChips(customPresets);
    });

    btnCancelPreset.addEventListener('click', () => {
      cancelEditingPreset();
    });

    btnSavePreset.addEventListener('click', () => {
      const name = customPresetNameInput.value.trim();
      const text = promptInput.value.trim();

      if (!name) {
        customPresetNameInput.focus();
        return;
      }
      if (!text) {
        promptInput.focus();
        return;
      }

      if (editingPresetId) {
        vscode.postMessage({
          type: 'editCustomPreset',
          id: editingPresetId,
          name,
          text
        });
        backupPromptText = null;
      } else {
        vscode.postMessage({
          type: 'addCustomPreset',
          name,
          text
        });
      }

      cancelEditingPreset();
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
        }
        if (message.gitDiffSettings) {
          gitDiffToggle.checked = Boolean(message.gitDiffSettings.includeGitDiff);
          diffOnlyToggle.checked = Boolean(message.gitDiffSettings.diffOnly);
          unlimitedDiffToggle.checked = Boolean(message.gitDiffSettings.unlimitedDiff);
          if (gitDiffToggle.checked) {
            gitDiffSuboptions.classList.remove('hidden');
          } else {
            gitDiffSuboptions.classList.add('hidden');
          }
        }
        if (message.customPresets) {
          renderCustomChips(message.customPresets);
        }
        saveState();
      } else if (message.type === 'updateStats') {
        if (message.stats) updateStatsUI(message.stats);
      } else if (message.type === 'updateCustomPresets') {
        if (message.customPresets) {
          renderCustomChips(message.customPresets);
        }
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
      updateClearSearchButtonVisibility();

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
     * Renders numeric metrics and triggers dynamic token progress recalculation.
     * @param {{ count: number, tokens: number, percentage: number }} stats - Calculated context statistics.
     * @returns {void}
     */
    function updateStatsUI(stats) {
      currentEstimatedTokens = stats.tokens || 0;
      document.getElementById('statCount').innerText = stats.count;
      document.getElementById('statTokens').innerText = '~' + currentEstimatedTokens.toLocaleString();
      renderProgressIndicator();
    }

    vscode.postMessage({ type: 'requestInitialData' });
  `;
}