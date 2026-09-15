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

  public registerCommands(): vscode.Disposable[] {
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

      vscode.commands.registerCommand('aiContextMerger.treeRefresh', async () => {
        await this.controlsProvider.forceRefresh();
      }),

      vscode.commands.registerCommand('aiContextMerger.treeClearAll', async () => {
        await this.controlsProvider.clearSelection();
        vscode.window.showInformationMessage('Выделение файлов снято.');
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
   * Resolves target files from invoked URIs with support for tracked Git deleted files.
   *
   * @param targetUri - The primary clicked item URI.
   * @param allSelectedUris - Multiple selected item URIs.
   * @returns Array of normalized file paths.
   */
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
    const gitStatuses = await GitService.getFileStatuses();

    for (const uri of sourceUris) {
      if (uri.scheme !== 'file') {
        continue;
      }

      const fsPath = PathUtils.normalizePath(uri.fsPath);
      // Fallback to enclosing directory if file is outside registered workspace folders
      const rootPath = PathUtils.getWorkspaceRoot(fsPath) || path.dirname(fsPath);

      // Case-insensitive Git deleted status check to eliminate Windows drive letter mismatches
      let isDeleted = gitStatuses.get(fsPath) === 'deleted';
      if (!isDeleted && process.platform === 'win32') {
        for (const [gitPath, status] of gitStatuses.entries()) {
          if (status === 'deleted' && PathUtils.arePathsEqual(gitPath, fsPath)) {
            isDeleted = true;
            break;
          }
        }
      }

      let stat: fs.Stats | null = null;
      try {
        stat = await fs.promises.stat(fsPath);
      } catch {
        // If file is physically absent from disk but tracked as deleted in Git, treat as valid deleted file
        if (!isDeleted) {
          continue;
        }
      }

      if (stat && stat.isDirectory()) {
        await SelectionService.selectFolderRecursive(
          fsPath,
          filters,
          resolvedFiles,
          this.treeDataProvider.folderTotalCountMap,
          new Set<string>(),
          gitStatuses
        );
      } else if (stat?.isFile() || isDeleted) {
        const isFiltered = await WorkspaceScanner.shouldFilterItem(fsPath, false, filters, rootPath, isDeleted);
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
    await this.controlsProvider.persistSelectedFiles();
    await this.controlsProvider.updateStats();

    const pluralLabel = newlyAdded === 1 ? 'файл добавлен' : `${newlyAdded} файлов добавлено`;
    vscode.window.showInformationMessage(`AI Context Merger: ${pluralLabel} в контекст (всего: ${this.selectedFiles.size}).`);
  }

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

    if (removedCount === 0) {
      vscode.window.showInformationMessage('Ни один из выбранных файлов не находился в контексте.');
      return;
    }

    this.treeDataProvider.refresh();
    await this.controlsProvider.persistSelectedFiles();
    await this.controlsProvider.updateStats();

    vscode.window.showInformationMessage(`AI Context Merger: ${removedCount} файлов убрано из контекста.`);
  }

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
      vscode.window.showInformationMessage(`Скопирован контекст (${formatLabel}): ${isolatedSelection.size} файлов!`);
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`Ошибка копирования в буфер обмена: ${ErrorUtils.extractErrorMessage(err)}`);
    }
  }

  public async copyUrisGitDiffImmediately(
    targetUri?: vscode.Uri,
    allSelectedUris?: vscode.Uri[]
  ): Promise<void> {
    const files = await this.resolveTargetFiles(targetUri, allSelectedUris);

    if (files.length === 0) {
      vscode.window.showWarningMessage('Не выбрано файлов для извлечения Git Diff.');
      return;
    }

    try {
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
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`Ошибка копирования Git Diff: ${ErrorUtils.extractErrorMessage(err)}`);
    }
  }

  public async copySingleFile(target?: ContextTreeItem | vscode.Uri): Promise<void> {
    const targetUri = target instanceof ContextTreeItem ? target.uri : target;
    if (!targetUri || targetUri.scheme !== 'file') {
      return;
    }

    const filePath = PathUtils.normalizePath(targetUri.fsPath);
    const fileName = path.basename(filePath);

    try {
      const gitStatuses = await GitService.getFileStatuses();
      if (gitStatuses.get(filePath) === 'deleted') {
        await vscode.env.clipboard.writeText('[Файл удален в Git]');
        vscode.window.showInformationMessage(`Скопирован файл (удален в Git): ${fileName}`);
        return;
      }

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
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`Ошибка копирования файла: ${ErrorUtils.extractErrorMessage(err)}`);
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