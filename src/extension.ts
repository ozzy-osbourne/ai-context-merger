import * as vscode from 'vscode';
import { ContextMergerSidebarProvider } from './sidebarProvider';

export function activate(context: vscode.ExtensionContext) {
    const sidebarProvider = new ContextMergerSidebarProvider(context.extensionUri);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ContextMergerSidebarProvider.viewType,
            sidebarProvider
        ),
        {
            dispose: () => sidebarProvider.dispose()
        }
    );
}

export function deactivate() {}