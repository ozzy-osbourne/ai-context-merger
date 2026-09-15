import { PROMPT_PRESETS } from '../constants/presets';

/**
 * Generates the complete client-side JavaScript for the controls Webview panel.
 * Coordinates DOM interactions, IPC messaging with the extension host, state persistence,
 * debounced search queries, and user feedback animations.
 *
 * @returns Serialized client JavaScript code string.
 */
export function getScripts(): string {
  const presetsJson = JSON.stringify(PROMPT_PRESETS);

  return `
    /**
     * Acquisition of the native VS Code Webview messaging and state API.
     * Allows posting messages to the extension host and saving session state across tab switches.
     */
    const vscode = acquireVsCodeApi();

    /**
     * Dictionary of default AI task prompt presets injected from extension constants.
     * @type {Record<string, string>}
     */
    const PRESET_TEXTS = ${presetsJson};

    /**
     * Default token budget fallback value when no user preference is configured.
     * @type {string}
     */
    const DEFAULT_TOKEN_LIMIT = '200000';

    /**
     * Whitelist of valid token context window limits supported by the dropdown.
     * @type {readonly string[]}
     */
    const VALID_TOKEN_LIMITS = ['32000', '64000', '128000', '200000', '1000000', '2000000'];

    /**
     * Session state restored from VS Code's internal webview cache across visibility toggles.
     */
    const previousState = vscode.getState() || {};

    // =========================================================================
    // 1. Primary Action & Header DOM Elements
    // =========================================================================
    const btnRefreshTop = document.getElementById('btnRefreshTop');
    const btnCopy = document.getElementById('btnCopy');
    const btnPreview = document.getElementById('btnPreview');
    const btnExport = document.getElementById('btnExport');
    const btnOpenTabs = document.getElementById('btnOpenTabs');
    const btnGit = document.getElementById('btnGit');
    const btnSelectAll = document.getElementById('btnSelectAll');
    const btnClear = document.getElementById('btnClear');
    const btnExpandAll = document.getElementById('btnExpandAll');
    const btnCollapse = document.getElementById('btnCollapse');

    // =========================================================================
    // 2. AI Task Prompt & Presets DOM Elements
    // =========================================================================
    const promptToggle = document.getElementById('promptToggle');
    const promptBody = document.getElementById('promptBody');
    const promptInput = document.getElementById('promptInput');
    const btnClearPrompt = document.getElementById('btnClearPrompt');
    const customChipsContainer = document.getElementById('customChipsContainer');
    const btnShowAddPreset = document.getElementById('btnShowAddPreset');
    const inlineAddForm = document.getElementById('inlineAddForm');
    const inlineFormTitle = document.getElementById('inlineFormTitle');
    const customPresetNameInput = document.getElementById('customPresetNameInput');
    const btnSavePreset = document.getElementById('btnSavePreset');
    const btnCancelPreset = document.getElementById('btnCancelPreset');

    // =========================================================================
    // 3. Format & Context Addons (Project Structure, Git Diff & Diagnostics) DOM Elements
    // =========================================================================
    const formatMarkdown = document.getElementById('formatMarkdown');
    const formatXml = document.getElementById('formatXml');

    const projectStructureToggle = document.getElementById('projectStructureToggle');

    const gitDiffToggle = document.getElementById('gitDiffToggle');
    const gitDiffSuboptions = document.getElementById('gitDiffSuboptions');
    const diffOnlyToggle = document.getElementById('diffOnlyToggle');
    const unlimitedDiffToggle = document.getElementById('unlimitedDiffToggle');

    const diagnosticsToggle = document.getElementById('diagnosticsToggle');
    const diagnosticsSuboptions = document.getElementById('diagnosticsSuboptions');
    const diagnosticsCompilerToggle = document.getElementById('diagnosticsCompilerToggle');
    const diagnosticsCompilerLabel = document.getElementById('diagnosticsCompilerLabel');
    const diagnosticsLinterToggle = document.getElementById('diagnosticsLinterToggle');
    const diagnosticsLinterLabel = document.getElementById('diagnosticsLinterLabel');

    // =========================================================================
    // 4. Statistics, Progress & Search DOM Elements
    // =========================================================================
    const searchInput = document.getElementById('searchInput');
    const btnClearSearch = document.getElementById('btnClearSearch');
    const tokenLimitSelect = document.getElementById('tokenLimitSelect');
    const tokenOverflowWarning = document.getElementById('tokenOverflowWarning');

    // =========================================================================
    // 5. In-Memory Component State
    // =========================================================================
    /**
     * Active user-defined custom presets list.
     * @type {Array<{ id: string, name: string, text: string }>}
     */
    let customPresets = [];

    /**
     * Identifier of the preset currently open in edit mode, or null if creating a new one.
     * @type {string | null}
     */
    let editingPresetId = null;

    /**
     * Temporary backup of the prompt textarea content to restore if preset editing is cancelled.
     * @type {string | null}
     */
    let backupPromptText = null;

    /**
     * Timer handle for resetting copy button success animation.
     * @type {number | undefined}
     */
    let copyFeedbackTimeout;

    /**
     * Timer handle for debouncing live search input events.
     * @type {number | undefined}
     */
    let searchDebounceTimer;

    /**
     * Timer handle for debouncing live prompt input keystroke events.
     * @type {number | undefined}
     */
    let promptDebounceTimer;

    /**
     * Most recent token estimate received from extension backend.
     * @type {number}
     */
    let currentEstimatedTokens = 0;

    // =========================================================================
    // 6. Restoring Session State from Webview Cache
    // =========================================================================
    // Restore prompt toggle and draft text
    promptToggle.checked = Boolean(previousState.promptEnabled);
    promptInput.value = previousState.promptText || '';
    if (promptToggle.checked) {
      promptBody.classList.remove('hidden');
    }

    // Restore Project Structure toggle (defaults to true)
    projectStructureToggle.checked = previousState.includeProjectStructure !== undefined
      ? Boolean(previousState.includeProjectStructure)
      : true;

    // Restore Git Diff toggles
    gitDiffToggle.checked = Boolean(previousState.gitDiffEnabled);
    diffOnlyToggle.checked = Boolean(previousState.diffOnly);
    unlimitedDiffToggle.checked = Boolean(previousState.unlimitedDiff);
    if (gitDiffToggle.checked) {
      gitDiffSuboptions.classList.remove('hidden');
    }

    // Restore Diagnostics toggles (Linter is disabled by default to eliminate log noise)
    diagnosticsToggle.checked = Boolean(previousState.diagnosticsEnabled);
    diagnosticsCompilerToggle.checked = previousState.diagnosticsIncludeCompiler !== undefined
      ? Boolean(previousState.diagnosticsIncludeCompiler)
      : true;
    diagnosticsLinterToggle.checked = previousState.diagnosticsIncludeLinter !== undefined
      ? Boolean(previousState.diagnosticsIncludeLinter)
      : false;

    if (diagnosticsToggle.checked) {
      diagnosticsSuboptions.classList.remove('hidden');
    }

    // Restore output format and adapt action buttons
    let currentFormat = previousState.outputFormat === 'xml' ? 'xml' : 'markdown';
    updateFormatUI(currentFormat);

    // Restore token limit preference with validation
    let restoredLimit = DEFAULT_TOKEN_LIMIT;
    if (previousState.tokenLimit && VALID_TOKEN_LIMITS.includes(String(previousState.tokenLimit))) {
      restoredLimit = String(previousState.tokenLimit);
    }
    tokenLimitSelect.value = restoredLimit;
    if (tokenLimitSelect.selectedIndex === -1) {
      tokenLimitSelect.value = DEFAULT_TOKEN_LIMIT;
    }

    // Restore active search query
    let currentSearchQuery = previousState.searchQuery || '';
    searchInput.value = currentSearchQuery;

    // =========================================================================
    // 7. UI Update & Feedback Functions
    // =========================================================================

    /**
     * Synchronizes radio buttons and adapts button labels to the current output format.
     *
     * @param {'markdown' | 'xml'} format - Target output format.
     * @returns {void}
     */
    function updateFormatUI(format) {
      currentFormat = format;
      const isXml = format === 'xml';

      if (formatMarkdown && formatXml) {
        formatMarkdown.checked = !isXml;
        formatXml.checked = isXml;
      }

      if (btnPreview) {
        btnPreview.innerText = isXml ? '👁️ Превью .xml' : '👁️ Превью .md';
        btnPreview.title = isXml
          ? 'Открыть сгенерированный XML во вкладке рядом для предварительного просмотра'
          : 'Открыть сгенерированный Markdown во вкладке рядом для предварительного просмотра';
      }

      if (btnExport) {
        btnExport.innerText = isXml ? '💾 Экспорт в .xml' : '💾 Экспорт в .md';
        btnExport.title = isXml
          ? 'Сохранить итоговый XML-файл с контекстом на диск'
          : 'Сохранить итоговый Markdown-файл с контекстом на диск';
      }
    }

    /**
     * Triggers copy button success state animation and restores default text after delay.
     *
     * @returns {void}
     */
    function triggerCopySuccess() {
      if (!btnCopy) return;
      btnCopy.disabled = false;
      btnCopy.style.opacity = '1';
      btnCopy.classList.add('btn-copied');
      btnCopy.innerHTML = '<span>✓</span> СКОПИРОВАНО!';

      if (copyFeedbackTimeout) {
        clearTimeout(copyFeedbackTimeout);
      }

      copyFeedbackTimeout = setTimeout(() => {
        btnCopy.classList.remove('btn-copied');
        btnCopy.innerHTML = '<span>📋</span> СКОПИРОВАТЬ КОНТЕКСТ';
      }, 1500);
    }

    /**
     * Resets copy button from loading state back to default if an error occurs.
     *
     * @returns {void}
     */
    function triggerCopyError() {
      if (!btnCopy) return;
      btnCopy.disabled = false;
      btnCopy.style.opacity = '1';
      btnCopy.classList.remove('btn-copied');
      btnCopy.innerHTML = '<span>📋</span> СКОПИРОВАТЬ КОНТЕКСТ';
    }

    /**
     * Persists all current UI controls state into Webview session storage.
     *
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
        includeProjectStructure: projectStructureToggle.checked,
        gitDiffEnabled: gitDiffToggle.checked,
        diffOnly: diffOnlyToggle.checked,
        unlimitedDiff: unlimitedDiffToggle.checked,
        diagnosticsEnabled: diagnosticsToggle.checked,
        diagnosticsIncludeCompiler: diagnosticsCompilerToggle.checked,
        diagnosticsIncludeLinter: diagnosticsLinterToggle.checked,
        outputFormat: currentFormat,
        searchQuery: currentSearchQuery
      });
    }

    /**
     * Toggles visibility of the prompt clear button based on text presence.
     *
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
     * Toggles visibility of the search input clear button based on length.
     *
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
     * Synchronizes active instruction text and enabled state with the extension host.
     * Supports debouncing to prevent excessive disk writes and Git calculations during continuous typing.
     *
     * @param {boolean} [immediate=false] - Whether to bypass debounce and transmit instantly.
     * @returns {void}
     */
    function syncPromptWithExtension(immediate = false) {
      updateClearPromptButtonVisibility();
      saveState();

      if (promptDebounceTimer) {
        clearTimeout(promptDebounceTimer);
        promptDebounceTimer = undefined;
      }

      if (immediate) {
        vscode.postMessage({
          type: 'updatePrompt',
          enabled: promptToggle.checked,
          text: promptInput.value
        });
      } else {
        promptDebounceTimer = setTimeout(() => {
          vscode.postMessage({
            type: 'updatePrompt',
            enabled: promptToggle.checked,
            text: promptInput.value
          });
        }, 300);
      }
    }

    /**
     * Synchronizes active Project Structure inclusion setting with the extension host.
     *
     * @returns {void}
     */
    function syncProjectStructureWithExtension() {
      saveState();
      vscode.postMessage({
        type: 'updateProjectStructure',
        includeProjectStructure: projectStructureToggle.checked
      });
    }

    /**
     * Synchronizes active Git Diff configuration with the extension host.
     *
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
     * Synchronizes active compiler/linter diagnostics settings with the extension host.
     *
     * @returns {void}
     */
    function syncDiagnosticsWithExtension() {
      saveState();
      vscode.postMessage({
        type: 'updateDiagnostics',
        settings: {
          enabled: diagnosticsToggle.checked,
          includeCompiler: diagnosticsCompilerToggle.checked,
          includeLinter: diagnosticsLinterToggle.checked
        }
      });
    }

    /**
     * Synchronizes chosen output format (Markdown or XML) with the extension host.
     *
     * @param {'markdown' | 'xml'} format - Chosen format.
     * @returns {void}
     */
    function syncFormatWithExtension(format) {
      updateFormatUI(format);
      saveState();
      vscode.postMessage({
        type: 'updateOutputFormat',
        format
      });
    }

    /**
     * Renders compiler and linter problem counters on the suboption labels.
     *
     * @param {{ compilerCount: number, linterCount: number }} summary - Aggregated issues summary.
     * @returns {void}
     */
    function renderDiagnosticsUI(summary) {
      const compCount = summary?.compilerCount || 0;
      const lintCount = summary?.linterCount || 0;
      
      diagnosticsCompilerLabel.innerText = 'Ошибки компилятора (' + compCount + ')';
      diagnosticsLinterLabel.innerText = 'Ошибки линтера (' + lintCount + ')';
    }

    /**
     * Updates token progress bar width, percentage label, and overflow warnings.
     *
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

      // Dynamic color thresholding (Green -> Yellow -> Red)
      if (percentage < 33) {
        bar.style.backgroundColor = 'var(--color-green)';
      } else if (percentage < 66) {
        bar.style.backgroundColor = 'var(--color-yellow)';
      } else {
        bar.style.backgroundColor = 'var(--color-red)';
      }

      document.getElementById('progressPercent').innerText = percentage + '%';

      // Show overflow alert if tokens exceed chosen LLM budget
      if (currentEstimatedTokens > maxLimit) {
        tokenOverflowWarning.classList.remove('hidden');
      } else {
        tokenOverflowWarning.classList.add('hidden');
      }
    }

    /**
     * Opens inline preset form in edit mode for a target preset.
     *
     * @param {{ id: string, name: string, text: string }} preset - Target preset object.
     * @returns {void}
     */
    function startEditingPreset(preset) {
      if (editingPresetId === null) {
        backupPromptText = promptInput.value;
      }
      editingPresetId = preset.id;
      promptInput.value = preset.text;
      syncPromptWithExtension(true);

      inlineFormTitle.innerText = '▼ Редактирование пресета:';
      customPresetNameInput.value = preset.name;
      btnShowAddPreset.classList.add('hidden');
      inlineAddForm.classList.remove('hidden');
      customPresetNameInput.focus();

      renderCustomChips(customPresets);
    }

    /**
     * Cancels preset edit mode and restores backed-up prompt draft.
     *
     * @returns {void}
     */
    function cancelEditingPreset() {
      if (editingPresetId !== null && backupPromptText !== null) {
        promptInput.value = backupPromptText;
        backupPromptText = null;
        syncPromptWithExtension(true);
      }
      editingPresetId = null;
      inlineAddForm.classList.add('hidden');
      btnShowAddPreset.classList.remove('hidden');
      customPresetNameInput.value = '';
      inlineFormTitle.innerText = '💾 Сохранить текущий текст как пресет:';
      renderCustomChips(customPresets);
    }

    /**
     * Renders custom preset chips and action buttons into the DOM container.
     *
     * @param {Array<{ id: string, name: string, text: string }>} presets - Custom presets list.
     * @returns {void}
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

        const labelBtn = document.createElement('button');
        labelBtn.type = 'button';
        labelBtn.className = 'chip-label-btn';
        labelBtn.innerText = preset.name;
        labelBtn.title = preset.text;
        labelBtn.addEventListener('click', () => {
          // If another preset was being edited, abort edit mode to prevent accidental overwriting
          if (editingPresetId !== null) {
            cancelEditingPreset();
          }
          promptInput.value = preset.text;
          syncPromptWithExtension(true);
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

    // Initialize button visibility and state
    updateClearPromptButtonVisibility();
    updateClearSearchButtonVisibility();
    saveState();

    if (currentSearchQuery) {
      vscode.postMessage({
        type: 'updateSearch',
        query: currentSearchQuery
      });
    }

    // =========================================================================
    // 8. Event Listeners Registration
    // =========================================================================

    // Output Format Radios
    formatMarkdown.addEventListener('change', () => {
      if (formatMarkdown.checked) syncFormatWithExtension('markdown');
    });

    formatXml.addEventListener('change', () => {
      if (formatXml.checked) syncFormatWithExtension('xml');
    });

    // Prompt Inputs & Toggles
    promptToggle.addEventListener('change', () => {
      if (promptToggle.checked) {
        promptBody.classList.remove('hidden');
      } else {
        promptBody.classList.add('hidden');
      }
      syncPromptWithExtension(true);
    });

    promptInput.addEventListener('input', () => {
      syncPromptWithExtension(false);
    });

    btnClearPrompt.addEventListener('click', (e) => {
      e.stopPropagation();
      promptInput.value = '';
      promptInput.focus();
      syncPromptWithExtension(true);
    });

    // Project Structure Toggle
    projectStructureToggle.addEventListener('change', () => {
      syncProjectStructureWithExtension();
    });

    // Git Diff Options
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

    // Diagnostics Options
    diagnosticsToggle.addEventListener('change', () => {
      if (diagnosticsToggle.checked) {
        diagnosticsSuboptions.classList.remove('hidden');
      } else {
        diagnosticsSuboptions.classList.add('hidden');
      }
      syncDiagnosticsWithExtension();
    });

    diagnosticsCompilerToggle.addEventListener('change', () => {
      syncDiagnosticsWithExtension();
    });

    diagnosticsLinterToggle.addEventListener('change', () => {
      syncDiagnosticsWithExtension();
    });

    // Live Search Input with 300ms debounce
    searchInput.addEventListener('input', (e) => {
      currentSearchQuery = e.target.value.trim();
      saveState();
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

    btnClearSearch.addEventListener('click', (e) => {
      e.stopPropagation();
      searchInput.value = '';
      currentSearchQuery = '';
      saveState();
      updateClearSearchButtonVisibility();
      btnSelectAll.innerText = '✅ Выбрать всё';
      searchInput.focus();

      clearTimeout(searchDebounceTimer);
      vscode.postMessage({
        type: 'updateSearch',
        query: ''
      });
    });

    // Token Limit Dropdown
    tokenLimitSelect.addEventListener('change', () => {
      saveState();
      renderProgressIndicator();
      vscode.postMessage({
        type: 'updateTokenLimit',
        limit: tokenLimitSelect.value
      });
    });

    // Default Prompt Preset Chips
    document.querySelectorAll('.preset-chip[data-preset]').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        // Abort preset editing mode if active when clicking a base chip
        if (editingPresetId !== null) {
          cancelEditingPreset();
        }
        const key = chip.getAttribute('data-preset');
        if (PRESET_TEXTS[key]) {
          promptInput.value = PRESET_TEXTS[key];
          syncPromptWithExtension(true);
        }
      });
    });

    // Custom Preset Inline Form Actions
    btnShowAddPreset.addEventListener('click', () => {
      editingPresetId = null;
      inlineFormTitle.innerText = '💾 Сохранить текущий текст как пресет:';
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
      } else {
        vscode.postMessage({
          type: 'addCustomPreset',
          name,
          text
        });
      }
      // Form is kept open until presetOperationSuccess confirms persistence
    });

    btnRefreshTop.addEventListener('click', () => {
      if (btnRefreshTop.disabled) return;
      btnRefreshTop.disabled = true;
      btnRefreshTop.style.opacity = '0.7';
      setTimeout(() => {
        btnRefreshTop.disabled = false;
        btnRefreshTop.style.opacity = '1';
      }, 500);
      vscode.postMessage({ type: 'refresh' });
    });

    btnCopy.addEventListener('click', () => {
      if (btnCopy.disabled) {
        return;
      }
      btnCopy.disabled = true;
      btnCopy.style.opacity = '0.7';
      btnCopy.innerHTML = '<span>⏳</span> СБОРКА КОНТЕКСТА...';
      vscode.postMessage({ type: 'copyContext' });
    });

    btnPreview.addEventListener('click', () => vscode.postMessage({ type: 'previewContext' }));
    btnExport.addEventListener('click', () => vscode.postMessage({ type: 'exportFile' }));
    btnOpenTabs.addEventListener('click', () => vscode.postMessage({ type: 'selectOpenTabs' }));
    btnGit.addEventListener('click', () => vscode.postMessage({ type: 'selectModified' }));
    btnClear.addEventListener('click', () => vscode.postMessage({ type: 'clearSelection' }));
    btnExpandAll.addEventListener('click', () => vscode.postMessage({ type: 'expandAll' }));
    btnCollapse.addEventListener('click', () => vscode.postMessage({ type: 'collapseAll' }));

    btnSelectAll.addEventListener('click', () => {
      if (currentSearchQuery) {
        vscode.postMessage({ type: 'selectFound', query: currentSearchQuery });
      } else {
        vscode.postMessage({ type: 'selectAll' });
      }
    });

    /**
     * Broadcasts updated file exclusion filters to the extension host.
     *
     * @returns {void}
     */
    function notifyFilterChange() {
      vscode.postMessage({
        type: 'updateFilters',
        filters: {
          hideGitIgnored: document.getElementById('filterGit').checked,
          hideSecrets: document.getElementById('filterSecrets').checked,
          hideMinified: document.getElementById('filterMinified').checked,
          hideLockFiles: document.getElementById('filterLock').checked,
          hideBinaryFiles: document.getElementById('filterBinary').checked
        }
      });
    }

    document.getElementById('filterGit').addEventListener('change', notifyFilterChange);
    document.getElementById('filterSecrets').addEventListener('change', notifyFilterChange);
    document.getElementById('filterMinified').addEventListener('change', notifyFilterChange);
    document.getElementById('filterLock').addEventListener('change', notifyFilterChange);
    document.getElementById('filterBinary').addEventListener('change', notifyFilterChange);

    // =========================================================================
    // 9. Inbound IPC Message Dispatcher (Extension -> Webview)
    // =========================================================================
    window.addEventListener('message', event => {
      const message = event.data;
      if (!message || typeof message.type !== 'string') return;

      if (message.type === 'setData') {
        if (message.stats) updateStatsUI(message.stats);

        if (message.outputFormat) {
          currentFormat = message.outputFormat;
          updateFormatUI(currentFormat);
        }

        if (message.tokenLimit && VALID_TOKEN_LIMITS.includes(String(message.tokenLimit))) {
          tokenLimitSelect.value = String(message.tokenLimit);
        }

        if (message.includeProjectStructure !== undefined) {
          projectStructureToggle.checked = Boolean(message.includeProjectStructure);
        }

        if (message.filters) {
          document.getElementById('filterGit').checked = Boolean(message.filters.hideGitIgnored);
          document.getElementById('filterSecrets').checked = Boolean(message.filters.hideSecrets);
          document.getElementById('filterMinified').checked = Boolean(message.filters.hideMinified);
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

        if (message.diagnosticsSettings) {
          diagnosticsToggle.checked = Boolean(message.diagnosticsSettings.enabled);
          diagnosticsCompilerToggle.checked = Boolean(message.diagnosticsSettings.includeCompiler);
          diagnosticsLinterToggle.checked = Boolean(message.diagnosticsSettings.includeLinter);
          if (diagnosticsToggle.checked) {
            diagnosticsSuboptions.classList.remove('hidden');
          } else {
            diagnosticsSuboptions.classList.add('hidden');
          }
        }

        if (message.diagnosticsSummary) {
          renderDiagnosticsUI(message.diagnosticsSummary);
        }

        if (message.customPresets) {
          renderCustomChips(message.customPresets);
        }

        saveState();
        renderProgressIndicator();
      } else if (message.type === 'updateStats') {
        if (message.stats) updateStatsUI(message.stats);
      } else if (message.type === 'updateDiagnosticsSummary') {
        if (message.summary) renderDiagnosticsUI(message.summary);
      } else if (message.type === 'updateCustomPresets') {
        if (message.customPresets) {
          renderCustomChips(message.customPresets);
        }
      } else if (message.type === 'presetOperationSuccess') {
        backupPromptText = null;
        cancelEditingPreset();
      } else if (message.type === 'searchResults') {
        if (message.query) {
          btnSelectAll.innerText = '✅ Выбрать найденное (' + message.count + ')';
        } else {
          btnSelectAll.innerText = '✅ Выбрать всё';
        }
      } else if (message.type === 'copySuccess') {
        triggerCopySuccess();
      } else if (message.type === 'copyError') {
        triggerCopyError();
      }
    });

    /**
     * Updates numeric file and token metrics in the stats card and refreshes progress bar.
     *
     * @param {{ count: number, tokens: number, percentage: number }} stats - Calculated context metrics.
     * @returns {void}
     */
    function updateStatsUI(stats) {
      currentEstimatedTokens = stats.tokens || 0;
      document.getElementById('statCount').innerText = stats.count;
      document.getElementById('statTokens').innerText = '~' + currentEstimatedTokens.toLocaleString();
      renderProgressIndicator();
    }

    // Request initial synchronized data from the extension host on startup
    vscode.postMessage({ type: 'requestInitialData' });
  `;
}