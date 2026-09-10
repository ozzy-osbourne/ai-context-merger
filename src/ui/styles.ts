/**
 * Generates the complete categorized and documented CSS stylesheet string for the controls Webview.
 *
 * @returns CSS styles string.
 */
export function getStyles(): string {
  return `
    /* ==========================================================================
       1. Theme Tokens & Base Reset
       ========================================================================== */
    :root {
      --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      --color-green: #2ea043;
      --color-yellow: #d29922;
      --color-red: #f85149;
    }

    body {
      font-family: var(--font-family);
      padding: 10px;
      color: var(--vscode-foreground);
      background-color: var(--vscode-sideBar-background);
      margin: 0;
      user-select: none;
    }

    /* ==========================================================================
       2. Typography & Section Headers
       ========================================================================== */
    .header-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 12px;
      text-transform: uppercase;
    }

    /* ==========================================================================
       3. Buttons & Action Grids
       ========================================================================== */
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
      transition: background-color 0.2s ease, transform 0.1s ease;
    }

    .btn-primary:hover {
      background-color: var(--vscode-button-hoverBackground);
    }

    .btn-primary:active {
      transform: scale(0.98);
    }

    .btn-primary.btn-copied {
      background-color: var(--color-green) !important;
      color: #ffffff !important;
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

    /* ==========================================================================
       4. AI Task Prompt Card & Presets
       ========================================================================== */
    .prompt-card {
      background-color: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
      border-radius: 6px;
      padding: 8px;
      margin-bottom: 8px;
    }

    .prompt-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      font-weight: 600;
    }

    .prompt-header label {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
    }

    .btn-clear-prompt {
      background: none;
      border: none;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      font-size: 11px;
      padding: 1px 5px;
      border-radius: 3px;
      display: flex;
      align-items: center;
      gap: 3px;
      opacity: 0.8;
      transition: opacity 0.2s, background-color 0.2s;
    }

    .btn-clear-prompt:hover {
      color: var(--vscode-foreground);
      background-color: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.2));
      opacity: 1;
    }

    .prompt-body {
      margin-top: 8px;
    }

    .prompt-textarea {
      width: 100%;
      height: 64px;
      resize: vertical;
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 4px;
      padding: 6px 8px;
      font-family: var(--font-family);
      font-size: 11px;
      box-sizing: border-box;
      outline: none;
    }

    .prompt-textarea:focus {
      border-color: var(--vscode-focusBorder);
    }

    .preset-section-label {
      font-size: 10px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
      margin-top: 6px;
      margin-bottom: 3px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .custom-preset-label {
      margin-top: 8px;
    }

    .preset-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .preset-chip {
      background-color: var(--vscode-badge-background, rgba(128, 128, 128, 0.15));
      color: var(--vscode-badge-foreground, var(--vscode-foreground));
      border: 1px solid var(--vscode-widget-border, transparent);
      border-radius: 12px;
      padding: 2px 7px;
      font-size: 10px;
      cursor: pointer;
      user-select: none;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: background-color 0.15s ease, border-color 0.15s ease;
    }

    button.preset-chip {
      font-family: inherit;
    }

    .preset-chip:hover {
      background-color: var(--vscode-button-secondaryHoverBackground);
    }

    .preset-chip.editing {
      border-color: var(--vscode-focusBorder);
      background-color: var(--vscode-toolbar-activeBackground, rgba(128, 128, 128, 0.25));
    }

    .chip-label-btn {
      background: none;
      border: none;
      color: inherit;
      font: inherit;
      cursor: pointer;
      padding: 0;
      display: inline-flex;
      align-items: center;
      outline: none;
    }

    .chip-actions {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      margin-left: 2px;
    }

    .chip-edit-btn,
    .chip-delete-btn {
      background: none;
      border: none;
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
      padding: 0 2px;
      border-radius: 3px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      opacity: 0.7;
      outline: none;
      transition: opacity 0.15s ease, color 0.15s ease, background-color 0.15s ease;
    }

    .chip-edit-btn:hover {
      opacity: 1;
      color: var(--vscode-foreground);
      background-color: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.2));
    }

    .chip-delete-btn:hover {
      opacity: 1;
      color: var(--color-red);
      background-color: rgba(255, 0, 0, 0.15);
    }

    .btn-show-add-preset {
      background: none;
      border: 1px dashed var(--vscode-widget-border, rgba(128, 128, 128, 0.4));
      color: var(--vscode-textLink-foreground);
      font-size: 10px;
      padding: 4px 6px;
      border-radius: 4px;
      margin-top: 7px;
      cursor: pointer;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      transition: background-color 0.2s, border-color 0.2s;
    }

    .btn-show-add-preset:hover {
      background-color: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.15));
      border-color: var(--vscode-focusBorder);
    }

    .inline-add-form {
      margin-top: 8px;
      background-color: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
      border-radius: 4px;
      padding: 6px;
    }

    .inline-add-title {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 5px;
      font-weight: 600;
    }

    .inline-add-row {
      display: flex;
      gap: 4px;
      align-items: center;
    }

    .inline-add-input {
      flex: 1;
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 3px;
      padding: 4px 6px;
      font-size: 11px;
      outline: none;
      min-width: 0;
    }

    .inline-add-input:focus {
      border-color: var(--vscode-focusBorder);
    }

    .btn-inline-save {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 3px;
      padding: 4px 8px;
      font-size: 11px;
      cursor: pointer;
      white-space: nowrap;
    }

    .btn-inline-save:hover {
      background-color: var(--vscode-button-hoverBackground);
    }

    .btn-inline-cancel {
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      border-radius: 3px;
      padding: 4px 8px;
      font-size: 11px;
      cursor: pointer;
      white-space: nowrap;
    }

    .btn-inline-cancel:hover {
      background-color: var(--vscode-button-secondaryHoverBackground);
    }

    /* ==========================================================================
       5. Git Diff Controls Card
       ========================================================================== */
    .git-diff-card {
      background-color: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
      border-radius: 6px;
      padding: 8px 10px;
      margin-top: 8px;
    }

    .git-diff-header-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }

    .git-diff-header-label input {
      cursor: pointer;
      margin: 0;
    }

    .git-diff-suboptions {
      margin-top: 6px;
      padding-left: 20px;
      display: flex;
      flex-direction: column;
      gap: 5px;
      border-left: 2px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
      margin-left: 6px;
    }

    .git-diff-suboption {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      cursor: pointer;
      color: var(--vscode-descriptionForeground);
      transition: color 0.2s ease;
    }

    .git-diff-suboption:hover {
      color: var(--vscode-foreground);
    }

    .git-diff-suboption input {
      cursor: pointer;
      margin: 0;
    }

    /* ==========================================================================
       6. Context Statistics & Budget Progress Bar
       ========================================================================== */
    .stats-card {
      background-color: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
      border-radius: 6px;
      padding: 8px 10px;
      margin-top: 10px;
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
      margin-bottom: 6px;
    }

    .progress-bar-fill {
      height: 100%;
      width: 0%;
      background-color: var(--color-green);
      transition: width 0.3s ease, background-color 0.3s ease;
    }

    .progress-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }

    .warning-overflow {
      color: var(--color-red);
      font-weight: 700;
      font-size: 11px;
      display: flex;
      align-items: center;
      gap: 3px;
      white-space: nowrap;
    }

    .progress-footer-right {
      display: flex;
      align-items: center;
      gap: 5px;
      margin-left: auto;
    }

    .progress-percent {
      font-weight: 700;
      color: var(--vscode-foreground);
      font-size: 11px;
    }

    .progress-of {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }

    .token-select-wrapper {
      position: relative;
      display: inline-flex;
      align-items: center;
    }

    .token-limit-select {
      background-color: var(--vscode-dropdown-background, var(--vscode-editor-background));
      color: var(--vscode-descriptionForeground);
      border: 1px solid var(--vscode-dropdown-border, rgba(128, 128, 128, 0.3));
      border-radius: 4px;
      padding: 1px 18px 1px 6px;
      font-family: var(--font-family);
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      outline: none;
      appearance: none;
      -webkit-appearance: none;
      line-height: 18px;
      height: 22px;
      min-width: 52px;
      box-sizing: border-box;
      transition: border-color 0.2s, color 0.2s;
    }

    .token-limit-select option {
      background-color: var(--vscode-dropdown-background, #252526);
      color: var(--vscode-dropdown-foreground, var(--vscode-foreground));
    }

    .token-limit-select:hover {
      color: var(--vscode-foreground);
      border-color: var(--vscode-focusBorder);
    }

    .token-limit-select:focus {
      color: var(--vscode-foreground);
      border-color: var(--vscode-focusBorder);
    }

    .select-chevron {
      position: absolute;
      right: 6px;
      font-size: 9px;
      color: var(--vscode-descriptionForeground);
      pointer-events: none;
    }

    /* ==========================================================================
       7. Exclusion Filters
       ========================================================================== */
    .filter-section {
      margin-top: 8px;
      background-color: var(--vscode-editor-background);
      border-radius: 4px;
      padding: 6px 8px;
      font-size: 11px;
    }

    .filter-title {
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .filter-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 10px;
    }

    .filter-item {
      display: flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      font-size: 11px;
      white-space: nowrap;
    }

    .filter-item input {
      cursor: pointer;
      margin: 0;
    }

    /* ==========================================================================
       8. Search Input & Utilities
       ========================================================================== */
    .search-container {
      margin-top: 8px;
      position: relative;
      display: flex;
      align-items: center;
    }

    .search-input {
      width: 100%;
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      padding: 6px 26px 6px 24px;
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
      font-size: 11px;
      opacity: 0.6;
      pointer-events: none;
    }

    .btn-clear-search {
      position: absolute;
      right: 6px;
      background: none;
      border: none;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      font-size: 11px;
      padding: 2px 4px;
      border-radius: 3px;
      opacity: 0.7;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
    }

    .btn-clear-search:hover {
      color: var(--vscode-foreground);
      background-color: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.2));
      opacity: 1;
    }

    .hidden {
      display: none !important;
    }
  `;
}