import * as vscode from 'vscode';
import { ContextMergerSidebarProvider } from './sidebarProvider';

export function activate(context: vscode.ExtensionContext) {
    const sidebarProvider = new ContextMergerSidebarProvider(context.extensionUri);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ContextMergerSidebarProvider.viewType,
            sidebarProvider
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('ai-context-merger.refresh', () => {
            sidebarProvider.refresh();
        }),
        vscode.commands.registerCommand('ai-context-merger.clearSelection', () => {
            sidebarProvider.clearSelection();
        }),
        vscode.commands.registerCommand('ai-context-merger.preview', () => {
            sidebarProvider.previewContext();
        }),
        vscode.commands.registerCommand('ai-context-merger.copyToClipboard', () => {
            sidebarProvider.copyContextToClipboard();
        }),
        vscode.commands.registerCommand('ai-context-merger.exportToFile', () => {
            sidebarProvider.exportContextToFile();
        })
    );
}

export function deactivate() {}