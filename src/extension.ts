import * as vscode from 'vscode';
import { ContextMergerSidebarProvider } from './sidebarProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('>>> AI CONTEXT MERGER УСПЕШНО АКТИВИРОВАН! <<<');

    // 1. Создаем провайдер кастомного интерфейса сайдбара
    const provider = new ContextMergerSidebarProvider(context.extensionUri);

    // 2. Регистрируем Webview View в левой панели
    const viewDisposable = vscode.window.registerWebviewViewProvider(
        ContextMergerSidebarProvider.viewType,
        provider
    );

    // 3. Регистрация глобальных команд тулбара
    const refreshCmd = vscode.commands.registerCommand('ai-context-merger.refresh', () => {
        provider.refresh();
    });

    const clearCmd = vscode.commands.registerCommand('ai-context-merger.clearSelection', () => {
        provider.clearSelection();
    });

    const copyCmd = vscode.commands.registerCommand('ai-context-merger.copyToClipboard', () => {
        provider.copyContextToClipboard();
    });

    const exportCmd = vscode.commands.registerCommand('ai-context-merger.exportToFile', () => {
        provider.exportContextToFile();
    });

    const previewCmd = vscode.commands.registerCommand('ai-context-merger.preview', () => {
        provider.previewContext();
    });

    // Добавляем все обработчики в подписки контекста для корректной очистки памяти
    context.subscriptions.push(
        viewDisposable,
        refreshCmd,
        clearCmd,
        copyCmd,
        exportCmd,
        previewCmd
    );
}

export function deactivate() {}