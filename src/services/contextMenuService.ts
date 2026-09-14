import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ContextTreeDataProvider, ContextTreeItem } from './contextTreeDataProvider';
import { ContextMergerControlsProvider } from '../sidebarProvider';
import { WorkspaceScanner } from './workspaceScanner';
import { GitService } from './gitService';
import { MarkdownBuilder } from './markdownBuilder';
import { XmlBuilder } from './xmlBuilder';
import { FileReaderService } from './fileReaderService';
import { DiagnosticsService } from './diagnosticsService';
import { PathUtils } from '../utils/pathUtils';

/**
 * Service providing Explorer, Editor, Tab, and TreeView actions and context menus.
 * Fully supports multi-file selections across both standard VS Code Explorer and custom TreeView.
 */
export class ContextMenuService {
  /**
   * Creates an instance of ContextMenuService.
   *
   * @param selectedFiles - Shared set containing normalized absolute paths of selected files.
   * @param treeDataProvider - Reference to the Context TreeDataProvider for refresh sync.
   * @param controlsProvider - Reference to the sidebar controls provider for filters and state.
   */
  constructor(
    private readonly selectedFiles: Set<string>,
    private readonly treeDataProvider: ContextTreeDataProvider,
    private readonly controlsProvider: ContextMergerControlsProvider
  ) {}

  /**
   * Helper extracting a raw vscode.Uri from either a ContextTreeItem, an existing Uri, or an active editor.
   *
   * @param item - Target item to extract URI from.
   * @returns Resolved vscode.Uri or undefined.
   */
  private extractUri(item?: ContextTreeItem | vscode.Uri): vscode.Uri | undefined {
    if (!item) {
      return undefined;
    }
    return item instanceof ContextTreeItem ? item.uri : item;
  }

  /**
   * Normalizes heterogeneous arguments from explorer/context and view/item/context into standardized Uri arrays.
   *
   * @param target - Primary clicked item.
   * @param allSelected - Array of selected items (Uris from Explorer, or ContextTreeItems from TreeView).
   * @returns Normalized target URI and list of all selected URIs.
   */
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
   * Registers all context menu and TreeView header/inline commands in VS Code command registry.
   *
   * @returns Array of disposables to register in extension subscriptions.
   */
  public registerCommands(): vscode.Disposable[] {
    return [
      // Explorer / Tab / Editor / TreeView Multi-select commands
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

      // TreeView Header (view/title) commands
      vscode.commands.registerCommand('aiContextMerger.treeRefresh', async () => {
        await this.controlsProvider.forceRefresh();
      }),

      vscode.commands.registerCommand('aiContextMerger.treeClearAll', () => {
        this.controlsProvider.clearSelection();
      }),

      vscode.commands.registerCommand('aiContextMerger.treeToggleSelectedOnly', () => {
        this.treeDataProvider.toggleShowOnlySelected();
      }),

      vscode.commands.registerCommand('aiContextMerger.treeCopyContext', async () => {
        await this.controlsProvider.copyContextToClipboard();
      }),

      // TreeView Item Inline / Context commands
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
   * Resolves raw URIs into a flat list of selectable file paths, traversing directories recursively.
   *
   * @param targetUri - Primary clicked item URI.
   * @param allSelectedUris - All selected URIs if multi-selection was used.
   * @returns Array of normalized absolute file paths eligible for context.
   */
  private async resolveTargetFiles(
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

    const workspaceFolders = vscode.workspace.workspaceFolders;
    const resolvedFiles = new Set<string>();
    const filters = this.controlsProvider.filters;

    for (const uri of sourceUris) {
      if (uri.scheme !== 'file') {
        continue;
      }

      const fsPath = PathUtils.normalizePath(uri.fsPath);

      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(fsPath);
      } catch {
        continue;
      }

      const matchedFolder = workspaceFolders?.find((f) =>
        PathUtils.isSubpath(fsPath, PathUtils.normalizePath(f.uri.fsPath))
      );
      const rootPath = matchedFolder ? PathUtils.normalizePath(matchedFolder.uri.fsPath) : undefined;

      if (stat.isDirectory()) {
        await WorkspaceScanner.selectFolderRecursive(
          fsPath,
          filters,
          resolvedFiles,
          this.treeDataProvider.folderTotalCountMap
        );
      } else if (stat.isFile()) {
        const isFiltered = await WorkspaceScanner.shouldFilterItem(fsPath, false, filters, rootPath);
        if (!isFiltered) {
          resolvedFiles.add(fsPath);
        }
      }
    }

    return Array.from(resolvedFiles);
  }

  /**
   * Adds targets (files or folders) to the current active selection and synchronizes the TreeView.
   *
   * @param targetUri - Primary clicked item URI.
   * @param allSelectedUris - All selected URIs if multi-selection was used.
   */
  public async addUrisToContext(
    targetUri?: vscode.Uri,
    allSelectedUris?: vscode.Uri[]
  ): Promise<void> {
    const files = await this.resolveTargetFiles(targetUri, allSelectedUris);

    if (files.length === 0) {
      vscode.window.showWarningMessage('Не выбрано доступных файлов (или они скрыты активными фильтрами).');
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
    await this.controlsProvider.updateStats();

    const pluralLabel = newlyAdded === 1 ? 'файл добавлен' : `${newlyAdded} файлов добавлено`;
    vscode.window.showInformationMessage(`AI Context Merger: ${pluralLabel} в контекст (всего: ${this.selectedFiles.size}).`);
  }

  /**
   * Removes targets (files or directory subtrees) from the current active selection.
   *
   * @param targetUri - Primary clicked item URI.
   * @param allSelectedUris - All selected URIs if multi-selection was used.
   */
  public async removeUrisFromContext(
    targetUri?: vscode.Uri,
    allSelectedUris?: vscode.Uri[]
  ): Promise<void> {
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

    this.treeDataProvider.refresh();
    await this.controlsProvider.updateStats();

    vscode.window.showInformationMessage(`AI Context Merger: ${removedCount} файлов убрано из контекста.`);
  }

  /**
   * Assembles context bundle for targets on the fly and writes directly to clipboard without altering sidebar selection.
   *
   * @param targetUri - Primary clicked item URI.
   * @param allSelectedUris - All selected URIs if multi-selection was used.
   */
  public async copyUrisImmediately(
    targetUri?: vscode.Uri,
    allSelectedUris?: vscode.Uri[]
  ): Promise<void> {
    const files = await this.resolveTargetFiles(targetUri, allSelectedUris);

    if (files.length === 0) {
      vscode.window.showWarningMessage('Не выбрано доступных файлов для копирования (или они скрыты фильтрами).');
      return;
    }

    const isolatedSelection = new Set<string>(files);
    const filters = this.controlsProvider.filters;
    const outputFormat = this.controlsProvider.outputFormat;
    const promptSettings = this.controlsProvider.promptSettings;
    const gitDiffSettings = this.controlsProvider.gitDiffSettings;
    const diagnosticsSettings = this.controlsProvider.diagnosticsSettings;

    let gitDiffContent = '';
    if (gitDiffSettings.includeGitDiff) {
      gitDiffContent = await GitService.getFilesDiff(
        files,
        gitDiffSettings.unlimitedDiff,
        filters
      );
    }

    let diagnosticsContent = '';
    if (diagnosticsSettings.enabled && (diagnosticsSettings.includeCompiler || diagnosticsSettings.includeLinter)) {
      const items = DiagnosticsService.getDiagnosticsForFiles(
        isolatedSelection,
        diagnosticsSettings,
        vscode.workspace.workspaceFolders
      );
      diagnosticsContent = DiagnosticsService.formatDiagnosticsText(items);
    }

    const gitStatuses = await GitService.getFileStatuses();

    let payload = '';
    if (outputFormat === 'xml') {
      payload = await XmlBuilder.buildBundleXml(
        isolatedSelection,
        promptSettings,
        gitDiffSettings,
        gitDiffContent,
        gitStatuses,
        diagnosticsSettings,
        diagnosticsContent
      );
    } else {
      payload = await MarkdownBuilder.buildBundleMarkdown(
        isolatedSelection,
        promptSettings,
        gitDiffSettings,
        gitDiffContent,
        gitStatuses,
        diagnosticsSettings,
        diagnosticsContent
      );
    }

    await vscode.env.clipboard.writeText(payload);
    const formatLabel = outputFormat.toUpperCase();
    vscode.window.showInformationMessage(`Скопирован контекст (${formatLabel}): ${isolatedSelection.size} файлов!`);
  }

  /**
   * Generates and copies Git Diff exclusively for the specified targets.
   *
   * @param targetUri - Primary clicked item URI.
   * @param allSelectedUris - All selected URIs if multi-selection was used.
   */
  public async copyUrisGitDiffImmediately(
    targetUri?: vscode.Uri,
    allSelectedUris?: vscode.Uri[]
  ): Promise<void> {
    const files = await this.resolveTargetFiles(targetUri, allSelectedUris);

    if (files.length === 0) {
      vscode.window.showWarningMessage('Не выбрано файлов для извлечения Git Diff.');
      return;
    }

    const diffContent = await GitService.getFilesDiff(
      files,
      true,
      this.controlsProvider.filters
    );

    if (!diffContent || diffContent.trim().length === 0) {
      vscode.window.showInformationMessage('Для выбранных файлов нет изменений в Git.');
      return;
    }

    await vscode.env.clipboard.writeText(diffContent);
    vscode.window.showInformationMessage(`Скопирован Git Diff для ${files.length} файлов!`);
  }

  /**
   * Copies the content of a single file item to clipboard.
   *
   * @param target - Target TreeItem or Uri.
   */
  public async copySingleFile(target?: ContextTreeItem | vscode.Uri): Promise<void> {
    const targetUri = target instanceof ContextTreeItem ? target.uri : target;
    if (!targetUri || targetUri.scheme !== 'file') {
      return;
    }

    const filePath = PathUtils.normalizePath(targetUri.fsPath);
    const fileName = path.basename(filePath);
    const readResult = await FileReaderService.safeReadFile(filePath);

    let contentToCopy = '';
    if (readResult.placeholder) {
      contentToCopy = readResult.placeholder;
    } else if (readResult.text !== undefined) {
      contentToCopy = readResult.text;
    }

    if (!contentToCopy) {
      vscode.window.showWarningMessage(`Файл ${fileName} пуст или недоступен для чтения.`);
      return;
    }

    await vscode.env.clipboard.writeText(contentToCopy);
    vscode.window.showInformationMessage(`Скопирован файл: ${fileName}`);
  }

  /**
   * Opens the side-by-side Git diff comparison against HEAD for a target file.
   *
   * @param target - Target TreeItem or Uri.
   */
  public async openGitDiff(target?: ContextTreeItem | vscode.Uri): Promise<void> {
    const targetUri = target instanceof ContextTreeItem ? target.uri : target;
    if (!targetUri || targetUri.scheme !== 'file') {
      return;
    }

    try {
      await vscode.commands.executeCommand('git.openChange', targetUri);
    } catch {
      await vscode.commands.executeCommand('vscode.open', targetUri);
    }
  }
}