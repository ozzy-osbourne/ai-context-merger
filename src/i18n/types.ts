/**
 * Supported language locales.
 */
export type LocaleKey = 'en' | 'ru' | 'zh-cn' | 'es' | 'pt-br' | 'ja' | 'de';

/**
 * User-configurable language preference.
 */
export type ConfiguredLanguage = 'auto' | LocaleKey;

/**
 * Pluralization categories based on Intl.PluralRules.
 */
export interface PluralForms {
  one: string;
  few?: string;
  many?: string;
  other: string;
}

/**
 * Strongly-typed translation dictionary schema.
 */
export interface TranslationSchema {
  ui: {
    headerTitle: string;
    refreshButtonTitle: string;
    refreshButtonText: string;
    promptTitle: string;
    promptToggleTooltip: string;
    clearPromptButton: string;
    clearPromptButtonTooltip: string;
    promptPlaceholder: string;
    basePresetsLabel: string;
    customPresetsLabel: string;
    noCustomPresets: string;
    saveCurrentAsPreset: string;
    saveCurrentAsPresetTitle: string;
    inlineFormAddTitle: string;
    inlineFormEditTitle: string;
    presetNamePlaceholder: string;
    btnSave: string;
    btnCancel: string;
    formatTitle: string;
    formatMarkdownTitle: string;
    formatXmlTitle: string;
    btnCopy: string;
    btnCopyAssembling: string;
    btnCopySuccess: string;
    btnPreviewMd: string;
    btnPreviewXml: string;
    btnPreviewMdTitle: string;
    btnPreviewXmlTitle: string;
    btnExportMd: string;
    btnExportXml: string;
    btnExportMdTitle: string;
    btnExportXmlTitle: string;
    btnOpenTabs: string;
    btnOpenTabsTitle: string;
    btnGit: string;
    btnGitTitle: string;
    btnSelectAll: string;
    btnSelectAllTitle: string;
    btnSelectFoundPrefix: string;
    btnClearAll: string;
    btnClearAllTitle: string;
    btnExpandAll: string;
    btnExpandAllTitle: string;
    btnCollapseAll: string;
    btnCollapseAllTitle: string;
    attachProjectStructure: string;
    attachProjectStructureTitle: string;
    attachGitDiff: string;
    attachGitDiffTitle: string;
    diffOnly: string;
    diffOnlyTitle: string;
    unlimitedDiff: string;
    unlimitedDiffTitle: string;
    attachDiagnostics: string;
    attachDiagnosticsTitle: string;
    diagnosticsCompiler: string;
    diagnosticsCompilerTitle: string;
    diagnosticsLinter: string;
    diagnosticsLinterTitle: string;
    filtersTitle: string;
    filterGit: string;
    filterGitTitle: string;
    filterSecrets: string;
    filterSecretsTitle: string;
    filterMinified: string;
    filterMinifiedTitle: string;
    filterLock: string;
    filterLockTitle: string;
    filterBinary: string;
    filterBinaryTitle: string;
    statsTitle: string;
    filesMetricSuffix: string;
    tokensMetricPrefix: string;
    tokensMetricSuffix: string;
    progressOf: string;
    tokenOverflowWarning: string;
    tokenLimitTitle: string;
    searchPlaceholder: string;
    searchTitle: string;
    clearSearchTooltip: string;
    editPresetTooltip: string;
    deletePresetTooltip: string;
  };
  tree: {
    emptySearch: string;
    emptySearchDescription: (query: string) => string;
    nothingSelected: string;
    nothingSelectedDescription: string;
    emptyCombinedDescription: (query: string) => string;
    folderEmpty: string;
    folderFiltered: string;
    selectedPlural: PluralForms;
  };
  messages: {
    noFilesSelectedCopy: string;
    assemblingContext: (count: number) => string;
    contextCopied: (format: string, count: number) => string;
    placeholdersWarning: (count: number) => string;
    copyError: string;
    noFilesSelectedExport: string;
    fileSaved: (fileName: string) => string;
    fileSaveError: string;
    noFilesSelectedPreview: string;
    previewError: string;
    selectionCleared: string;
    noAvailableFiles: string;
    filesAddedToContext: (added: number, total: number) => string;
    noFilesWereInContext: string;
    filesRemovedFromContext: (count: number) => string;
    noChangesInGit: string;
    gitDiffCopied: (count: number) => string;
    gitDiffError: string;
    fileCopiedDeletedGit: (fileName: string) => string;
    fileCopied: (fileName: string) => string;
    fileEmptyOrUnreadable: (fileName: string) => string;
    fileCopyError: string;
    workspaceNotOpened: string;
    openTabsSelected: (count: number) => string;
    noAvailableFilesInOpenTabs: string;
    noModifiedGitFiles: string;
    modifiedGitFilesSelected: (count: number) => string;
    noFilesMatchedSearch: (query: string) => string;
    filesSelectedCount: (count: number) => string;
    foundFilesSelected: (added: number, total: number) => string;
    filesExcludedByFilters: (count: number) => string;
    presetSaved: (name: string) => string;
    presetUpdated: (name: string) => string;
    presetDeleted: string;
    workspaceDataRefreshed: string;
    presetNameAndTextRequired: string;
    presetNameTooLong: string;
    presetTextTooLong: string;
    presetLimitReached: string;
    presetInvalidId: string;
    presetNotFound: string;
  };
  presets: Record<string, { title: string; text: string; chipLabel: string }>;
}