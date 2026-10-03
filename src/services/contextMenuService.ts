import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ContextTreeDataProvider, ContextTreeItem } from './contextTreeDataProvider';
import { ContextMergerControlsProvider } from '../sidebarProvider';
import { WorkspaceScanner } from './workspaceScanner';
import { GitService } from './gitService';
import { BundleService } from './bundleService';
import { FileReaderService } from './fileReaderService';
import { PathUtils } from '../utils/pathUtils';
import { SelectionService } from './selectionService';
import { ErrorUtils } from '../utils/errorUtils';
import { I18nService } from '../i18n';
import { DEFAULT_IGNORED_DIRECTORIES, invalidateFilterCaches } from '../constants/filters';

/**
 * Service handling Explorer, Editor, and TreeView context menu actions.
 */
export class ContextMenuService {
  constructor(
    private readonly selectedFiles: Set<string>,
    private readonly treeDataProvider: ContextTreeDataProvider,
    private readonly controlsProvider: ContextMergerControlsProvider
  ) {}

  private extractUri(item?: ContextTreeItem | vscode.Uri): vscode.Uri | undefined {
    if (!item) {
      return undefined;
    }
    return item instanceof ContextTreeItem ? item.uri : item;
  }

  private extractUris(
    target?: ContextTreeItem | vscode.Uri,
    allSelected?: Array<ContextTreeItem | vscode.Uri>
  ): { targetUri?: vscode.Uri; selectedUris?: vscode.Uri[] } {
    const targetUri = this.extractUri(target);
    const selectedUris = allSelected && allSelected.length > 0
      ? allSelected.map((i) => this.extractUri(i)).filter((u): u is vscode.Uri => u !== undefined)
      : undefined;

    return { targetUri, selectedUris };
  }

  /**
   * Resolves the target for writing settings: prefers Workspace if folder is open, otherwise Global.
   * If Workspace scope does not contain explicit customizations yet, inherits Global custom rules
   * so they remain visible and manageable in the UI.
   *
   * @returns Configuration reference, target scope, and active custom patterns list.
   */
  private getTargetScopeConfiguration(): {
    config: vscode.WorkspaceConfiguration;
    configTarget: vscode.ConfigurationTarget;
    list: string[];
  } {
    const config = vscode.workspace.getConfiguration('aiContextMerger');
    const inspected = config.inspect<string[]>('excludePatterns');

    const hasWorkspace = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;
    const configTarget = hasWorkspace ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;

    // Use current explicit custom settings array or inherit global customization
    const currentExplicit = hasWorkspace
      ? (inspected?.workspaceValue ?? inspected?.globalValue)
      : inspected?.globalValue;
    const list = Array.isArray(currentExplicit) ? [...currentExplicit] : [];

    return { config, configTarget, list };
  }

  public registerCommands(): vscode.Disposable[] {
    const t = () => I18nService.getTranslations();

    return [
      vscode.commands.registerCommand(
        'aiContextMerger.addToContext',
        async (target?: ContextTreeItem | vscode.Uri, allSelected?: Array<ContextTreeItem | vscode.Uri>) => {
          const { targetUri, selectedUris } = this.extractUris(target, allSelected);
          await this.addUrisToContext(targetUri, selectedUris);
        }
      ),

      vscode.commands.registerCommand(
        'aiContextMerger.removeFromContext',
        async (target?: ContextTreeItem | vscode.Uri, allSelected?: Array<ContextTreeItem | vscode.Uri>) => {
          const { targetUri, selectedUris } = this.extractUris(target, allSelected);
          await this.removeUrisFromContext(targetUri, selectedUris);
        }
      ),

      vscode.commands.registerCommand(
        'aiContextMerger.copyImmediately',
        async (target?: ContextTreeItem | vscode.Uri, allSelected?: Array<ContextTreeItem | vscode.Uri>) => {
          const { targetUri, selectedUris } = this.extractUris(target, allSelected);
          await this.copyUrisImmediately(targetUri, selectedUris);
        }
      ),

      vscode.commands.registerCommand(
        'aiContextMerger.copyGitDiffImmediately',
        async (target?: ContextTreeItem | vscode.Uri, allSelected?: Array<ContextTreeItem | vscode.Uri>) => {
          const { targetUri, selectedUris } = this.extractUris(target, allSelected);
          await this.copyUrisGitDiffImmediately(targetUri, selectedUris);
        }
      ),

      vscode.commands.registerCommand(
        'aiContextMerger.hideExtension',
        async (target?: ContextTreeItem | vscode.Uri) => {
          await this.hideFileExtension(target);
        }
      ),

      vscode.commands.registerCommand(
        'aiContextMerger.hidePath',
        async (target?: ContextTreeItem | vscode.Uri) => {
          await this.hidePathPattern(target);
        }
      ),

      vscode.commands.registerCommand(
        'aiContextMerger.unhidePath',
        async (target?: ContextTreeItem | vscode.Uri) => {
          await this.unhidePathPattern(target);
        }
      ),

      vscode.commands.registerCommand(
        'aiContextMerger.manageExcludedPatterns',
        async () => {
          await this.manageExcludedPatterns();
        }
      ),

      vscode.commands.registerCommand('aiContextMerger.treeRefresh', async () => {
        await this.controlsProvider.forceRefresh();
      }),

      vscode.commands.registerCommand('aiContextMerger.treeClearAll', async () => {
        await this.controlsProvider.clearSelection();
        vscode.window.showInformationMessage(t().messages.selectionCleared);
      }),

      vscode.commands.registerCommand('aiContextMerger.treeToggleSelectedOnly', async () => {
        await this.treeDataProvider.toggleShowOnlySelected();
      }),

      vscode.commands.registerCommand('aiContextMerger.treeShowAll', async () => {
        await this.treeDataProvider.toggleShowOnlySelected();
      }),

      vscode.commands.registerCommand('aiContextMerger.treeCopyContext', async () => {
        await this.controlsProvider.copyContextToClipboard();
      }),

      vscode.commands.registerCommand(
        'aiContextMerger.treeItemCopyFile',
        async (target?: ContextTreeItem | vscode.Uri) => {
          await this.copySingleFile(target);
        }
      ),

      vscode.commands.registerCommand(
        'aiContextMerger.treeItemOpenDiff',
        async (target?: ContextTreeItem | vscode.Uri) => {
          await this.openGitDiff(target);
        }
      )
    ];
  }

  /**
   * Prompts user confirmation and excludes all files sharing target file's extension.
   * Validates that the target is a physical file, preventing accidental folder extension rules.
   * Emits localized user notifications.
   *
   * @param target - Target tree item or URI.
   */
  public async hideFileExtension(target?: ContextTreeItem | vscode.Uri): Promise<void> {
    const t = I18nService.getTranslations();
    const targetUri = this.extractUri(target) || vscode.window.activeTextEditor?.document.uri;
    if (!targetUri || targetUri.scheme !== 'file') {
      return;
    }

    let stat: fs.Stats | null = null;
    try {
      stat = await fs.promises.stat(targetUri.fsPath);
    } catch {
      // Ignore stat error
    }

    if (stat && stat.isDirectory()) {
      vscode.window.showWarningMessage(t.messages.noExtensionToHide);
      return;
    }

    const ext = path.extname(targetUri.fsPath);
    if (!ext) {
      vscode.window.showWarningMessage(t.messages.noExtensionToHide);
      return;
    }

    const lowerExt = ext.toLowerCase();
    const question = t.messages.confirmHideExtensionTitle(lowerExt);

    const answer = await vscode.window.showInformationMessage(
      question,
      { modal: true, detail: t.messages.confirmHideDetail },
      t.messages.btnConfirmHide
    );

    if (answer !== t.messages.btnConfirmHide) {
      return;
    }

    const pattern = `**/*${lowerExt}`;
    await this.addExcludePattern(pattern, t.messages.hiddenAllExtensionFiles(lowerExt));
  }

  /**
   * Prompts user confirmation and excludes target file or directory path from the AI Context tree.
   * Constructs root-anchored glob patterns (`/${rel}` or `/${rel}/**`) for workspace root items to avoid
   * accidental collisions with same-named files located in subpackages and monorepos.
   * Emits localized user notifications.
   *
   * @param target - Target tree item or URI to hide.
   */
  public async hidePathPattern(target?: ContextTreeItem | vscode.Uri): Promise<void> {
    const t = I18nService.getTranslations();
    const targetUri = this.extractUri(target) || vscode.window.activeTextEditor?.document.uri;
    if (!targetUri || targetUri.scheme !== 'file') {
      return;
    }

    const fsPath = PathUtils.normalizePath(targetUri.fsPath);
    const rootPath = PathUtils.getWorkspaceRoot(fsPath) || path.dirname(fsPath);
    const rel = PathUtils.toPosixRelative(rootPath, fsPath);

    if (!rel || rel === '.') {
      return;
    }

    let stat: fs.Stats | null = null;
    try {
      stat = await fs.promises.stat(fsPath);
    } catch {
      // Ignore stat error
    }

    const isDir = Boolean(stat && stat.isDirectory());
    const question = t.messages.confirmHidePathTitle(rel, isDir);

    const answer = await vscode.window.showInformationMessage(
      question,
      { modal: true, detail: t.messages.confirmHideDetail },
      t.messages.btnConfirmHide
    );

    if (answer !== t.messages.btnConfirmHide) {
      return;
    }

    // Anchor root items with leading slash to avoid matching arbitrary subfolder files
    const pattern = isDir
      ? (rel.includes('/') ? `${rel}/**` : `/${rel}/**`)
      : (rel.includes('/') ? rel : `/${rel}`);

    await this.addExcludePattern(pattern, t.messages.hiddenPathInTree(rel));
  }

  /**
   * Restores a previously hidden path or extension in the AI Context tree.
   * Accurately targets specific custom and default rules without unintended over-unhiding.
   * Emits localized user notifications.
   *
   * @param target - Tree item or URI of target file or folder to unhide.
   */
  public async unhidePathPattern(target?: ContextTreeItem | vscode.Uri): Promise<void> {
    const t = I18nService.getTranslations();
    const targetUri = this.extractUri(target) || vscode.window.activeTextEditor?.document.uri;
    if (!targetUri || targetUri.scheme !== 'file') {
      return;
    }

    const fsPath = PathUtils.normalizePath(targetUri.fsPath);
    const rootPath = PathUtils.getWorkspaceRoot(fsPath) || path.dirname(fsPath);
    const rel = PathUtils.toPosixRelative(rootPath, fsPath);
    const ext = path.extname(fsPath).toLowerCase();
    const baseName = path.basename(fsPath);

    const { config, configTarget, list } = this.getTargetScopeConfiguration();

    // 1. Try removing from custom rules in list matching the specific target
    const filtered = list.filter((p) => {
      const pLower = p.toLowerCase();
      // Match extension hide rules only when target has an extension
      if (ext && (pLower === `**/*${ext}` || pLower === `*${ext}`)) {
        return false;
      }
      // Match exact path, folder recursive rule, or exact filename
      if (
        p === rel ||
        p === `/${rel}` ||
        p === `${rel}/**` ||
        p === `/${rel}/**` ||
        p === `**/${rel}` ||
        p === `**/${rel}/**` ||
        p === baseName ||
        p === `/${baseName}` ||
        p === `**/${baseName}`
      ) {
        return false;
      }
      return true;
    });

    if (filtered.length !== list.length) {
      invalidateFilterCaches();
      await config.update('excludePatterns', filtered.length > 0 ? filtered : undefined, configTarget);
      await this.controlsProvider.forceRefresh();
      vscode.window.showInformationMessage(t.messages.restoredPathInTree(baseName));
      return;
    }

    // 2. Check if hidden by default rules (only match if the target itself directly corresponds to the default rule)
    const matchedDefault = DEFAULT_IGNORED_DIRECTORIES.find((d) => {
      const dLower = d.toLowerCase();
      if (ext && (dLower === `**/*${ext}` || dLower === `*${ext}`)) {
        return true;
      }
      return dLower === rel.toLowerCase() || dLower === baseName.toLowerCase() || dLower === `**/${baseName.toLowerCase()}`;
    });

    if (matchedDefault) {
      const negation = `!${matchedDefault}`;
      if (!list.includes(negation)) {
        list.push(negation);
        invalidateFilterCaches();
        await config.update('excludePatterns', list, configTarget);
        await this.controlsProvider.forceRefresh();
        vscode.window.showInformationMessage(t.messages.restoredPathInTree(baseName));
        return;
      }
    }

    vscode.window.showInformationMessage(t.messages.notMatchedExcludedPattern(baseName));
  }

  /**
   * Opens an interactive QuickPick allowing users to review, search, and manage excluded patterns.
   * Displays distinct custom rules, active default rules, and previously disabled default rules.
   * Reliably handles negation logic when removing rules that coincide with default engine patterns.
   * All items and feedback notifications are fully localized.
   */
  public async manageExcludedPatterns(): Promise<void> {
    const t = I18nService.getTranslations();
    const { config, configTarget, list } = this.getTargetScopeConfiguration();

    const defaultRulesLower = new Set(DEFAULT_IGNORED_DIRECTORIES.map((d) => d.toLowerCase()));

    // Identify which default rules have been negated/disabled
    const negatedDefaults = new Set<string>();
    for (const p of list) {
      const trimmed = p.trim();
      if (trimmed.startsWith('!')) {
        negatedDefaults.add(trimmed.slice(1).trim().toLowerCase());
      }
    }

    const items: vscode.QuickPickItem[] = [];

    // 1. Custom rules added by user (exclude negations and exclude rules that are identical to default rules)
    for (const pattern of list) {
      const trimmed = pattern.trim();
      if (!trimmed.startsWith('!') && !defaultRulesLower.has(trimmed.toLowerCase())) {
        items.push({
          label: trimmed,
          description: t.messages.customRuleQuickPickDesc,
          iconPath: new vscode.ThemeIcon('eye-closed')
        });
      }
    }

    // 2. Active default rules (not negated)
    for (const pattern of DEFAULT_IGNORED_DIRECTORIES) {
      if (!negatedDefaults.has(pattern.toLowerCase())) {
        items.push({
          label: pattern,
          description: t.messages.defaultRuleQuickPickDesc,
          iconPath: new vscode.ThemeIcon('shield')
        });
      }
    }

    // 3. Previously removed default rules (allow re-enabling them)
    for (const pattern of DEFAULT_IGNORED_DIRECTORIES) {
      if (negatedDefaults.has(pattern.toLowerCase())) {
        items.push({
          label: pattern,
          description: t.messages.removedDefaultRuleQuickPickDesc,
          iconPath: new vscode.ThemeIcon('eye')
        });
      }
    }

    if (items.length === 0) {
      vscode.window.showInformationMessage(t.messages.noExcludePatternsConfigured);
      return;
    }

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: t.messages.manageExcludedQuickPickPlaceholder,
      matchOnDescription: true
    });

    if (!selected) {
      return;
    }

    let updatedList: string[];
    const selectedLabel = selected.label;
    const selectedLower = selectedLabel.toLowerCase();
    const isDefaultRule = defaultRulesLower.has(selectedLower);
    const isNegated = list.some((p) => p.trim().toLowerCase() === `!${selectedLower}`);
    const isCustom = list.some((p) => p.trim().toLowerCase() === selectedLower) && !isDefaultRule;

    if (isCustom) {
      // Remove custom rule
      updatedList = list.filter((p) => p.trim().toLowerCase() !== selectedLower);
      vscode.window.showInformationMessage(t.messages.removedCustomPattern(selectedLabel));
    } else if (isNegated) {
      // Restore default rule (remove the negation)
      updatedList = list.filter((p) => p.trim().toLowerCase() !== `!${selectedLower}`);
      vscode.window.showInformationMessage(t.messages.restoredDefaultRule(selectedLabel));
    } else {
      // Default rule clicked -> disable it by adding negation and removing positive entry if present in list
      const filteredList = list.filter((p) => p.trim().toLowerCase() !== selectedLower);
      updatedList = [...filteredList, `!${selectedLabel}`];
      vscode.window.showInformationMessage(t.messages.removedDefaultRule(selectedLabel));
    }

    invalidateFilterCaches();
    await config.update('excludePatterns', updatedList.length > 0 ? updatedList : undefined, configTarget);
    await this.controlsProvider.forceRefresh();
  }

  /**
   * Adds an exclusion pattern to configuration and purges matching files from active selection.
   * Supports restoring previously deselected files if the user clicks the localized "Undo" button.
   *
   * @param pattern - Exclusion glob pattern.
   * @param successMessage - Localized feedback message on successful addition.
   */
  private async addExcludePattern(pattern: string, successMessage: string): Promise<void> {
    const t = I18nService.getTranslations();
    const { config, configTarget, list } = this.getTargetScopeConfiguration();

    // 1. Если паттерн ранее был отключен отрицанием (!pattern), убираем отрицание
    const negation = `!${pattern}`;
    const negationIndex = list.indexOf(negation);
    if (negationIndex !== -1) {
      list.splice(negationIndex, 1);
    }

    if (!list.includes(pattern)) {
      list.push(pattern);
      
      invalidateFilterCaches();
      await config.update('excludePatterns', list, configTarget);

      const deselectedFiles: string[] = [];
      const hasSlash = pattern.includes('/');
      for (const file of Array.from(this.selectedFiles)) {
        const root = PathUtils.getWorkspaceRoot(file);
        const rel = root ? PathUtils.toPosixRelative(root, file) : path.basename(file);
        const matches =
          rel === pattern ||
          PathUtils.matchesGlob(rel, pattern) ||
          (!hasSlash && PathUtils.matchesGlob(path.basename(file), pattern));

        if (matches) {
          deselectedFiles.push(file);
          this.selectedFiles.delete(file);
        }
      }

      await this.controlsProvider.persistSelectedFiles();
      await this.controlsProvider.forceRefresh();

      const action = await vscode.window.showInformationMessage(successMessage, t.messages.btnUndo);
      if (action === t.messages.btnUndo) {
        const reverted = list.filter((p) => p !== pattern);
        invalidateFilterCaches();
        await config.update('excludePatterns', reverted.length > 0 ? reverted : undefined, configTarget);

        for (const file of deselectedFiles) {
          this.selectedFiles.add(file);
        }
        await this.controlsProvider.persistSelectedFiles();
        await this.controlsProvider.forceRefresh();
      }
    }
  }

  public async resolveTargetFiles(
    targetUri?: vscode.Uri,
    allSelectedUris?: vscode.Uri[]
  ): Promise<string[]> {
    let sourceUris: vscode.Uri[] = [];

    if (allSelectedUris && allSelectedUris.length > 0) {
      sourceUris = allSelectedUris;
    } else if (targetUri) {
      sourceUris = [targetUri];
    } else if (vscode.window.activeTextEditor) {
      sourceUris = [vscode.window.activeTextEditor.document.uri];
    }

    if (sourceUris.length === 0) {
      return [];
    }

    const resolvedFiles = new Set<string>();
    const filters = this.controlsProvider.filters;

    for (const uri of sourceUris) {
      if (uri.scheme !== 'file') {
        continue;
      }

      const fsPath = PathUtils.normalizePath(uri.fsPath);
      const rootPath = PathUtils.getWorkspaceRoot(fsPath) || path.dirname(fsPath);

      let stat: fs.Stats | null = null;
      try {
        stat = await fs.promises.stat(fsPath);
      } catch {
        continue;
      }

      if (stat && stat.isDirectory()) {
        await SelectionService.selectFolderRecursive(
          fsPath,
          filters,
          resolvedFiles,
          this.treeDataProvider.folderTotalCountMap,
          new Set<string>()
        );
      } else if (stat?.isFile()) {
        const isFiltered = await WorkspaceScanner.shouldFilterItem(fsPath, false, filters, rootPath);
        if (!isFiltered) {
          resolvedFiles.add(fsPath);
        }
      }
    }

    return Array.from(resolvedFiles);
  }

  public async addUrisToContext(
    targetUri?: vscode.Uri,
    allSelectedUris?: vscode.Uri[]
  ): Promise<void> {
    const t = I18nService.getTranslations();
    const files = await this.resolveTargetFiles(targetUri, allSelectedUris);

    if (files.length === 0) {
      vscode.window.showWarningMessage(t.messages.noAvailableFiles);
      return;
    }

    let newlyAdded = 0;
    for (const file of files) {
      if (!this.selectedFiles.has(file)) {
        this.selectedFiles.add(file);
        newlyAdded++;
      }
    }

    this.treeDataProvider.refresh();
    await this.controlsProvider.persistSelectedFiles();
    await this.controlsProvider.updateStats();

    vscode.window.showInformationMessage(t.messages.filesAddedToContext(newlyAdded, this.selectedFiles.size));
  }

  public async removeUrisFromContext(
    targetUri?: vscode.Uri,
    allSelectedUris?: vscode.Uri[]
  ): Promise<void> {
    const t = I18nService.getTranslations();
    let sourceUris: vscode.Uri[] = [];

    if (allSelectedUris && allSelectedUris.length > 0) {
      sourceUris = allSelectedUris;
    } else if (targetUri) {
      sourceUris = [targetUri];
    } else if (vscode.window.activeTextEditor) {
      sourceUris = [vscode.window.activeTextEditor.document.uri];
    }

    if (sourceUris.length === 0) {
      return;
    }

    let removedCount = 0;

    for (const uri of sourceUris) {
      const targetPath = PathUtils.normalizePath(uri.fsPath);

      for (const file of Array.from(this.selectedFiles)) {
        if (file === targetPath || PathUtils.isSubpath(file, targetPath)) {
          this.selectedFiles.delete(file);
          removedCount++;
        }
      }
    }

    if (removedCount === 0) {
      vscode.window.showInformationMessage(t.messages.noFilesWereInContext);
      return;
    }

    this.treeDataProvider.refresh();
    await this.controlsProvider.persistSelectedFiles();
    await this.controlsProvider.updateStats();

    vscode.window.showInformationMessage(t.messages.filesRemovedFromContext(removedCount));
  }

  public async copyUrisImmediately(
    targetUri?: vscode.Uri,
    allSelectedUris?: vscode.Uri[]
  ): Promise<void> {
    const t = I18nService.getTranslations();
    const files = await this.resolveTargetFiles(targetUri, allSelectedUris);

    if (files.length === 0) {
      vscode.window.showWarningMessage(t.messages.noAvailableFiles);
      return;
    }

    const isolatedSelection = new Set<string>(files);
    const gitStatuses = await GitService.getFileStatuses();

    try {
      const payload = await BundleService.buildContextPayload(
        isolatedSelection,
        this.controlsProvider.outputFormat,
        this.controlsProvider.promptSettings,
        this.controlsProvider.gitDiffSettings,
        this.controlsProvider.diagnosticsSettings,
        this.controlsProvider.filters,
        gitStatuses
      );

      await vscode.env.clipboard.writeText(payload);
      const formatLabel = this.controlsProvider.outputFormat.toUpperCase();
      vscode.window.showInformationMessage(t.messages.contextCopied(formatLabel, isolatedSelection.size));
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`${t.messages.copyError}: ${ErrorUtils.extractErrorMessage(err)}`);
    }
  }

  public async copyUrisGitDiffImmediately(
    targetUri?: vscode.Uri,
    allSelectedUris?: vscode.Uri[]
  ): Promise<void> {
    const t = I18nService.getTranslations();
    const files = await this.resolveTargetFiles(targetUri, allSelectedUris);

    if (files.length === 0) {
      vscode.window.showWarningMessage(t.messages.noChangesInGit);
      return;
    }

    try {
      const diffContent = await GitService.getFilesDiff(
        files,
        true,
        this.controlsProvider.filters
      );

      if (!diffContent || diffContent.trim().length === 0) {
        vscode.window.showInformationMessage(t.messages.noChangesInGit);
        return;
      }

      await vscode.env.clipboard.writeText(diffContent);
      vscode.window.showInformationMessage(t.messages.gitDiffCopied(files.length));
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`${t.messages.gitDiffError}: ${ErrorUtils.extractErrorMessage(err)}`);
    }
  }

  public async copySingleFile(target?: ContextTreeItem | vscode.Uri): Promise<void> {
    const t = I18nService.getTranslations();
    const targetUri = target instanceof ContextTreeItem ? target.uri : target;
    if (!targetUri || targetUri.scheme !== 'file') {
      return;
    }

    const filePath = PathUtils.normalizePath(targetUri.fsPath);
    const fileName = path.basename(filePath);

    try {
      const readResult = await FileReaderService.safeReadFile(filePath);

      let contentToCopy = '';
      if (readResult.placeholder) {
        contentToCopy = readResult.placeholder;
      } else if (readResult.text !== undefined) {
        contentToCopy = readResult.text;
      }

      if (!contentToCopy) {
        vscode.window.showWarningMessage(t.messages.fileEmptyOrUnreadable(fileName));
        return;
      }

      await vscode.env.clipboard.writeText(contentToCopy);
      vscode.window.showInformationMessage(t.messages.fileCopied(fileName));
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`${t.messages.fileCopyError}: ${ErrorUtils.extractErrorMessage(err)}`);
    }
  }

  public async openGitDiff(target?: ContextTreeItem | vscode.Uri): Promise<void> {
    const targetUri = target instanceof ContextTreeItem ? target.uri : target;
    if (!targetUri || targetUri.scheme !== 'file') {
      return;
    }

    const filePath = PathUtils.normalizePath(targetUri.fsPath);
    const gitStatuses = await GitService.getFileStatuses();
    const status = gitStatuses.get(filePath);

    if (status === 'untracked') {
      await vscode.commands.executeCommand('vscode.open', targetUri);
      return;
    }

    try {
      await vscode.commands.executeCommand('git.openChange', targetUri);
    } catch {
      await vscode.commands.executeCommand('vscode.open', targetUri);
    }
  }
}