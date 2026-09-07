import * as vscode from 'vscode';
import { ContextMergerSidebarProvider } from './sidebarProvider';

/**
 * Activates the AI Context Merger extension.
 * Registers the sidebar Webview View Provider with context retention support.
 *
 * @param context - Extension context provided by VS Code.
 */
export function activate(context: vscode.ExtensionContext): void {
  const sidebarProvider = new ContextMergerSidebarProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ContextMergerSidebarProvider.viewType,
      sidebarProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true
        }
      }
    ),
    {
      dispose: () => sidebarProvider.dispose()
    }
  );
}

/**
 * Deactivates the extension and disposes active subscriptions.
 */
export function deactivate(): void { }