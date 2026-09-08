import * as vscode from 'vscode';
import { ContextMergerControlsProvider } from './sidebarProvider';
import { ContextTreeDataProvider, ContextTreeItem } from './services/contextTreeDataProvider';

/**
 * Activates the AI Context Merger extension.
 *
 * @param context - Extension context provided by VS Code.
 */
export function activate(context: vscode.ExtensionContext): void {
  const selectedFiles = new Set<string>();

  const filters = {
    hideGitIgnored: true,
    hideLockFiles: true,
    hideBinaryFiles: true
  };

  const treeDataProvider = new ContextTreeDataProvider(selectedFiles, filters);

  const treeView = vscode.window.createTreeView('aiContextMergerTreeView', {
    treeDataProvider,
    canSelectMany: true,
    showCollapseAll: true,
    manageCheckboxStateManually: true
  });

  const controlsProvider = new ContextMergerControlsProvider(
    context.extensionUri,
    selectedFiles,
    treeDataProvider
  );

  controlsProvider.bindTreeView(treeView);

  // Handle item selection toggle when clicking on a file row
  const toggleClickCommand = vscode.commands.registerCommand(
    'aiContextMerger.toggleFileByClick',
    async (filePath: string) => {
      await treeDataProvider.toggleFileByPath(filePath);
      await controlsProvider.updateStats();
    }
  );

  context.subscriptions.push(
    controlsProvider,
    toggleClickCommand,

    treeView.onDidChangeCheckboxState(async (e) => {
      for (const [item, state] of e.items) {
        await treeDataProvider.toggleItemSelection(item as ContextTreeItem, state, false);
      }
      treeDataProvider.refresh();
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