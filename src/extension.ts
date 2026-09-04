import * as vscode from 'vscode';
import { FileTreeProvider } from './treeProvider';

export function activate(context: vscode.ExtensionContext) {
		console.log('>>> AI CONTEXT MERGER УСПЕШНО АКТИВИРОВАН! <<<');

    // 1. Создаем экземпляр нашего провайдера файлового дерева
    const treeProvider = new FileTreeProvider();

    // 2. Регистрируем дерево в боковой панели
    const treeView = vscode.window.createTreeView('aiContextMergerView', {
        treeDataProvider: treeProvider,
        showCollapseAll: true
    });

    // 3. Подписываемся на клик по чекбоксам
    const checkboxDisposable = treeView.onDidChangeCheckboxState(async (event) => {
        for (const [item, state] of event.items) {
            await treeProvider.handleCheckboxChange(item, state);
        }
    });

    // 4. Регистрируем базовые команды шапки
    const refreshDisposable = vscode.commands.registerCommand('ai-context-merger.refresh', () => {
        treeProvider.refresh();
    });

    const clearDisposable = vscode.commands.registerCommand('ai-context-merger.clearSelection', () => {
        treeProvider.clearSelection();
    });

    // Добавляем все подписки в контекст для автоматической очистки памяти при выключении плагина
    context.subscriptions.push(
        treeView,
        checkboxDisposable,
        refreshDisposable,
        clearDisposable
    );
}

export function deactivate() {}