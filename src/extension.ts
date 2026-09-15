import * as vscode from 'vscode';
import * as fs from 'fs';
import { ContextMergerControlsProvider, WORKSPACE_STORAGE_KEYS } from './sidebarProvider';
import { ContextTreeDataProvider, ContextTreeItem } from './services/contextTreeDataProvider';
import { ContextMenuService } from './services/contextMenuService';
import { PresetService } from './services/presetService';
import { GitService } from './services/gitService';
import { PathUtils } from './utils/pathUtils';

/**
 * Activates the AI Context Merger extension.
 *
 * @param context - Extension context provided by VS Code.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const savedFiles = context.workspaceState.get<string[]>(WORKSPACE_STORAGE_KEYS.SELECTED_FILES, []);

  // Retrieve git statuses to retain deleted git files [D] across VS Code restarts
  const gitStatuses = await GitService.getFileStatuses();

  const existingFiles: string[] = [];
  for (const filePath of savedFiles) {
    const normPath = PathUtils.normalizePath(filePath);
    try {
      const stat = await fs.promises.stat(normPath);
      if (stat.isFile()) {
        existingFiles.push(normPath);
      }
    } catch {
      // If file is physically absent from disk but tracked as deleted in Git, keep it in selection
      if (gitStatuses.get(normPath) === 'deleted') {
        existingFiles.push(normPath);
      }
    }
  }

  const selectedFiles = new Set<string>(existingFiles);
  if (existingFiles.length !== savedFiles.length) {
    await context.workspaceState.update(WORKSPACE_STORAGE_KEYS.SELECTED_FILES, existingFiles);
  }

  const presetService = new PresetService(context);
  const filters = presetService.getFilters();

  const treeDataProvider = new ContextTreeDataProvider(
    selectedFiles,
    filters,
    async (showOnly) => {
      await context.workspaceState.update(WORKSPACE_STORAGE_KEYS.SHOW_ONLY_SELECTED, showOnly);
    }
  );

  const savedShowOnlySelected = context.workspaceState.get<boolean>(WORKSPACE_STORAGE_KEYS.SHOW_ONLY_SELECTED, false);
  treeDataProvider.setShowOnlySelected(savedShowOnlySelected);

  const treeView = vscode.window.createTreeView('aiContextMergerTreeView', {
    treeDataProvider,
    canSelectMany: true,
    showCollapseAll: true,
    manageCheckboxStateManually: true
  });

  const controlsProvider = new ContextMergerControlsProvider(
    context,
    selectedFiles,
    treeDataProvider
  );

  controlsProvider.bindTreeView(treeView);

  const contextMenuService = new ContextMenuService(
    selectedFiles,
    treeDataProvider,
    controlsProvider
  );

  const toggleClickCommand = vscode.commands.registerCommand(
    'aiContextMerger.toggleFileByClick',
    async (filePath: string) => {
      await treeDataProvider.toggleFileByPath(filePath);
      await controlsProvider.persistSelectedFiles();
      await controlsProvider.updateStats();

      try {
        const stat = await fs.promises.stat(filePath).catch(() => null);
        if (stat && stat.isFile()) {
          await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
        }
      } catch {
        // Ignore open errors
      }
    }
  );

  context.subscriptions.push(
    treeDataProvider,
    controlsProvider,
    toggleClickCommand,
    ...contextMenuService.registerCommands(),

    treeView.onDidChangeCheckboxState(async (e) => {
      for (const [item, state] of e.items) {
        await treeDataProvider.toggleItemSelection(item as ContextTreeItem, state, false);
      }
      treeDataProvider.refresh();
      await controlsProvider.persistSelectedFiles();
      await controlsProvider.updateStats();
    }),

    vscode.window.registerWebviewViewProvider(
      ContextMergerControlsProvider.viewType,
      controlsProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true
        }
      }
    ),

    treeView
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      controlsProvider.reinitWatchers();
      treeDataProvider.refresh();
      controlsProvider.updateStats();
    })
  );
}

export function deactivate(): void {
  // Nothing to clean up; disposables handled via context.subscriptions
}