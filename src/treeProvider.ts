import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Элемент дерева (файл или папка) с поддержкой состояния чекбокса
 */
export class FileTreeItem extends vscode.TreeItem {
    constructor(
        public readonly resourceUri: vscode.Uri,
        public readonly isDirectory: boolean,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(resourceUri, collapsibleState);

        this.id = resourceUri.fsPath;
        // Назначаем стандартную иконку файла/папки из текущей темы VS Code
        this.iconPath = isDirectory ? vscode.ThemeIcon.Folder : vscode.ThemeIcon.File;
        // По умолчанию чекбокс выключен
        this.checkboxState = vscode.TreeItemCheckboxState.Unchecked;
    }
}

/**
 * Провайдер данных для отображения файлов проекта в боковой панели
 */
export class FileTreeProvider implements vscode.TreeDataProvider<FileTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<FileTreeItem | undefined | null | void> = new vscode.EventEmitter<FileTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<FileTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    // Хранилище абсолютных путей выбранных файлов
    public selectedFiles: Set<string> = new Set<string>();

    // Список исключаемых из отображения служебных папок и файлов
    private ignoredNames = new Set([
        'node_modules',
        '.git',
        '.vscode',
        'dist',
        'out',
        'build',
        '.next',
        'package-lock.json',
        'yarn.lock',
        'pnpm-lock.yaml'
    ]);

    /**
     * Принудительное обновление дерева (по кнопке Refresh)
     */
    public refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Сброс всех выбранных чекбоксов
     */
    public clearSelection(): void {
        this.selectedFiles.clear();
        this.refresh();
    }

    getTreeItem(element: FileTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Получение дочерних элементов (ленивая загрузка узлов при раскрытии)
     */
    async getChildren(element?: FileTreeItem): Promise<FileTreeItem[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return [];
        }

        // Если корень — берем путь открытого проекта, иначе путь выбранной папки
        const targetDir = element ? element.resourceUri.fsPath : workspaceFolders[0].uri.fsPath;

        try {
            const entries = await fs.promises.readdir(targetDir, { withFileTypes: true });

            // Сортировка: сначала папки по алфавиту, затем файлы по алфавиту
            const sortedEntries = entries
                .filter(entry => !this.ignoredNames.has(entry.name))
                .sort((a, b) => {
                    if (a.isDirectory() === b.isDirectory()) {
                        return a.name.localeCompare(b.name);
                    }
                    return a.isDirectory() ? -1 : 1;
                });

            return sortedEntries.map(entry => {
                const fullPath = path.join(targetDir, entry.name);
                const uri = vscode.Uri.file(fullPath);
                const isDir = entry.isDirectory();

                const item = new FileTreeItem(
                    uri,
                    isDir,
                    isDir ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
                );

                // Восстанавливаем состояние чекбокса
                if (isDir) {
                    // Для папки: отмечена, если внутри есть выбранные файлы
                    const hasSelectedChildren = Array.from(this.selectedFiles).some(f => f.startsWith(fullPath));
                    item.checkboxState = hasSelectedChildren
                        ? vscode.TreeItemCheckboxState.Checked
                        : vscode.TreeItemCheckboxState.Unchecked;
                } else {
                    item.checkboxState = this.selectedFiles.has(fullPath)
                        ? vscode.TreeItemCheckboxState.Checked
                        : vscode.TreeItemCheckboxState.Unchecked;
                }

                return item;
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Ошибка чтения каталога: ${error}`);
            return [];
        }
    }

    /**
     * Обработка переключения чекбокса (поддерживает каскадный выбор для папок)
     * @param item Элемент дерева, по которому кликнули
     * @param newState Новое состояние чекбокса (Checked / Unchecked)
     */
    public async handleCheckboxChange(item: FileTreeItem, newState: vscode.TreeItemCheckboxState): Promise<void> {
        const isChecked = newState === vscode.TreeItemCheckboxState.Checked;
        const targetPath = item.resourceUri.fsPath;

        if (item.isDirectory) {
            // Рекурсивно выбираем или снимаем выделение со всех вложенных файлов
            await this.toggleDirectoryRecursive(targetPath, isChecked);
        } else {
            if (isChecked) {
                this.selectedFiles.add(targetPath);
            } else {
                this.selectedFiles.delete(targetPath);
            }
        }

        // Обновляем отображение дерева для синхронизации иконок
        this.refresh();
    }

    /**
     * Рекурсивный обход директории для массовой смены состояния файлов
     */
    private async toggleDirectoryRecursive(dirPath: string, isChecked: boolean): Promise<void> {
        try {
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                if (this.ignoredNames.has(entry.name)) {
                    continue;
                }

                const fullPath = path.join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    await this.toggleDirectoryRecursive(fullPath, isChecked);
                } else {
                    if (isChecked) {
                        this.selectedFiles.add(fullPath);
                    } else {
                        this.selectedFiles.delete(fullPath);
                    }
                }
            }
        } catch {
            // Игнорируем папки с ограниченным доступом
        }
    }
}