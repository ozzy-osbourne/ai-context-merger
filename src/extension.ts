import * as vscode from 'vscode';
import * as fs from 'fs';
import { ContextMergerControlsProvider, WORKSPACE_STORAGE_KEYS } from './sidebarProvider';
import { ContextTreeDataProvider, ContextTreeItem } from './services/contextTreeDataProvider';
import { ContextMenuService } from './services/contextMenuService';
import { PresetService } from './services/presetService';

/**
 * Activates the AI Context Merger extension.
 *
 * @param context - Extension context provided by VS Code.
 */
export function activate(context: vscode.ExtensionContext): void {
  // 1. Restore persistent files selection from project workspaceState
  const savedFiles = context.workspaceState.get<string[]>(WORKSPACE_STORAGE_KEYS.SELECTED_FILES, []);
  const selectedFiles = new Set<string>(savedFiles);

  // 2. Restore global synchronized filter settings
  const presetService = new PresetService(context);
  const filters = presetService.getFilters();

  const treeDataProvider = new ContextTreeDataProvider(
    selectedFiles,
    filters,
    async (showOnly) => {
      await context.workspaceState.update(WORKSPACE_STORAGE_KEYS.SHOW_ONLY_SELECTED, showOnly);
    }
  );

  // Restore show-only-selected filter state
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

  // Handle item selection toggle when clicking on a file row
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

export function deactivate(): void { }