import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FilterSettings, PromptSettings } from './types';
import { GitService } from './services/gitService';
import { WorkspaceScanner } from './services/workspaceScanner';
import { StatsCalculator } from './services/statsCalculator';
import { MarkdownBuilder } from './services/markdownBuilder';
import { getHtmlTemplate } from './ui/htmlTemplate';

/**
 * Провайдер боковой панели управления контекстом AI.
 * Поддерживает файловый сканер, Git-интеграцию, сборку Markdown и реактивное автообновление
 * с изолированным управлением жизненным циклом ресурсов и наблюдателей.
 */
export class ContextMergerSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aiContextMergerView';
    private _view?: vscode.WebviewView;
    private _isDisposed: boolean = false;

    public selectedFiles: Set<string> = new Set<string>();

    private filters: FilterSettings = {
        hideGitIgnored: true,
        hideLockFiles: true,
        hideBinaryFiles: true
    };

    // Настройки пользовательской инструкции для ИИ
    private promptSettings: PromptSettings = {
        enabled: false,
        text: ''
    };

    private debounceTimer?: NodeJS.Timeout;

    // Глобальные подписки провайдера (команды, общие события VS Code)
    private readonly disposables: vscode.Disposable[] = [];

    // Изолированные подписки наблюдателей (FileWatcher, Git API), которые могут безопасно перезапускаться
    private watcherDisposables: vscode.Disposable[] = [];

    constructor(private readonly _extensionUri: vscode.Uri) {
        this.initAutoWatchers();

        // Переинициализация вотчеров при изменении структуры мульти-рут воркспейса
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            this.initAutoWatchers();
            this.triggerDebouncedRefresh();
        }, this, this.disposables);
    }

    /**
     * Очистка только активных файловых и Git наблюдателей
     */
    private disposeWatchers(): void {
        this.watcherDisposables.forEach(d => {
            try {
                d.dispose();
            } catch {}
        });
        this.watcherDisposables = [];
    }

    /**
     * Инициализация слушателей файловой системы и Git с защитой от утечек памяти
     */
    private initAutoWatchers(): void {
        // Очищаем предыдущие наблюдатели перед созданием новых
        this.disposeWatchers();

        const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
        this.watcherDisposables.push(fileWatcher);
        
        this.watcherDisposables.push(
            fileWatcher.onDidCreate(() => this.triggerDebouncedRefresh()),
            fileWatcher.onDidChange(() => this.triggerDebouncedRefresh()),
            fileWatcher.onDidDelete((uri: vscode.Uri) => {
                const deletedPath = path.normalize(uri.fsPath);
                const folderPrefix = deletedPath.endsWith(path.sep) ? deletedPath : deletedPath + path.sep;

                for (const file of Array.from(this.selectedFiles)) {
                    if (file === deletedPath || file.startsWith(folderPrefix)) {
                        this.selectedFiles.delete(file);
                    }
                }
                this.triggerDebouncedRefresh();
            })
        );

        this.initGitWatcher();
    }

    /**
     * Безопасная подписка на репозитории Git с регистрацией в watcherDisposables
     */
    private async initGitWatcher(): Promise<void> {
        try {
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            if (!gitExtension) {
                return;
            }

            const gitExports = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
            const gitApi = gitExports?.getAPI(1);
            if (!gitApi) {
                return;
            }

            // Подписка на открытие новых репозиториев
            const onDidOpenRepoDisposable = gitApi.onDidOpenRepository((repo: any) => {
                const repoChangeDisposable = repo.state.onDidChange(() => this.triggerDebouncedRefresh());
                this.watcherDisposables.push(repoChangeDisposable);
            });
            this.watcherDisposables.push(onDidOpenRepoDisposable);

            // Подписка на текущие открытые репозитории
            gitApi.repositories.forEach((repo: any) => {
                const repoChangeDisposable = repo.state.onDidChange(() => this.triggerDebouncedRefresh());
                this.watcherDisposables.push(repoChangeDisposable);
            });
        } catch (error) {
            console.warn('[AI Context Merger] Ошибка подписки на Git API:', error);
        }
    }

    /**
     * Запуск обновления UI с подавлением дребезга (debounce 300мс)
     */
    public triggerDebouncedRefresh(): void {
        if (this._isDisposed) {
            return;
        }

        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.refresh();
        }, 300);
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = getHtmlTemplate();

        // Сброс ссылки при закрытии/уничтожении webview в UI
        webviewView.onDidDispose(() => {
            this._view = undefined;
        }, null, this.disposables);

        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'toggleFile':
                    this.handleFileToggle(message.filePath, message.checked);
                    break;
                case 'toggleFolder':
                    await this.handleFolderToggle(message.folderPath, message.checked);
                    break;
                case 'selectAll':
                    await this.selectAllFiles();
                    break;
                case 'selectMultipleFiles':
                    if (Array.isArray(message.filePaths)) {
                        this.selectedFiles.clear();
                        for (const filePath of message.filePaths) {
                            this.selectedFiles.add(path.normalize(filePath));
                        }
                        await this.refresh();
                    }
                    break;
                case 'clearSelection':
                    this.clearSelection();
                    break;
                case 'copyContext':
                    await this.copyContextToClipboard();
                    break;
                case 'exportFile':
                    await this.exportContextToFile();
                    break;
                case 'previewContext':
                    await this.previewContext();
                    break;
                case 'selectModified':
                    await this.selectModifiedGitFiles();
                    break;
                case 'updateFilters':
                    this.filters = message.filters;
                    await this.refresh();
                    break;
                case 'updatePrompt':
                    this.promptSettings = {
                        enabled: Boolean(message.enabled),
                        text: String(message.text || '')
                    };
                    break;
                case 'refresh':
                    await this.refresh();
                    break;
                case 'requestInitialData':
                    await this.refresh(false, true);
                    break;
            }
        });
    }

    /**
     * Выбор всех доступных файлов рабочей области
     */
    public async selectAllFiles(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        const rootPath = path.normalize(workspaceFolders[0].uri.fsPath);
        this.selectedFiles.clear();
        await WorkspaceScanner.toggleFolderRecursive(rootPath, true, this.filters, this.selectedFiles);
        await this.refresh();
    }

    /**
     * Выбор измененных и новых файлов Git
     */
    public async selectModifiedGitFiles(): Promise<void> {
        const gitStatuses = await GitService.getGitStatusMap();

        this.selectedFiles.clear();
        for (const [filePath, status] of gitStatuses.entries()) {
            if (status === 'modified' || status === 'untracked') {
                const fileName = path.basename(filePath);
                const isFiltered = WorkspaceScanner.shouldFilterItem(fileName, false, this.filters);
                if (!isFiltered) {
                    this.selectedFiles.add(filePath);
                }
            }
        }

        vscode.window.showInformationMessage(`Выбрано файлов Git Diff: ${this.selectedFiles.size}`);
        await this.refresh(true, false);
    }

    /**
     * Полное обновление дерева файлов, валидация путей и пересчет статистики
     */
    public async refresh(smartGitExpand: boolean = false, isInitialLoad: boolean = false): Promise<void> {
        if (!this._view || this._isDisposed) {
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            this.selectedFiles.clear();
            this._view.webview.postMessage({
                type: 'setData',
                tree: [],
                stats: { count: 0, tokens: 0, percentage: 0 },
                selectedFiles: [],
                filters: this.filters,
                smartGitExpand,
                isInitialLoad
            });
            return;
        }

        const rootPath = path.normalize(workspaceFolders[0].uri.fsPath);
        
        // Валидация корня рабочей области
        if (!fs.existsSync(rootPath)) {
            this.selectedFiles.clear();
            return;
        }

        const gitStatusMap = await GitService.getGitStatusMap();
        const tree = await WorkspaceScanner.scanDirectory(rootPath, gitStatusMap, this.filters);

        // Очистка удаленных файлов и файлов из несуществующих папок
        for (const file of Array.from(this.selectedFiles)) {
            if (!fs.existsSync(file)) {
                this.selectedFiles.delete(file);
            }
        }

        const stats = await StatsCalculator.calculateStats(this.selectedFiles);

        this._view.webview.postMessage({
            type: 'setData',
            tree: [tree],
            stats,
            selectedFiles: Array.from(this.selectedFiles),
            filters: this.filters,
            smartGitExpand,
            isInitialLoad
        });
    }

    public clearSelection(): void {
        this.selectedFiles.clear();
        this.refresh();
    }

    private handleFileToggle(filePath: string, checked: boolean): void {
        const normalized = path.normalize(filePath);
        if (checked) {
            this.selectedFiles.add(normalized);
        } else {
            this.selectedFiles.delete(normalized);
        }
        this.updateStatsOnly();
    }

    private async handleFolderToggle(folderPath: string, checked: boolean): Promise<void> {
        const normalized = path.normalize(folderPath);
        await WorkspaceScanner.toggleFolderRecursive(normalized, checked, this.filters, this.selectedFiles);
        await this.refresh();
    }

    private async updateStatsOnly(): Promise<void> {
        if (!this._view || this._isDisposed) {
            return;
        }
        const stats = await StatsCalculator.calculateStats(this.selectedFiles);
        this._view.webview.postMessage({
            type: 'updateStats',
            stats,
            selectedFiles: Array.from(this.selectedFiles)
        });
    }

    public async copyContextToClipboard(): Promise<void> {
        if (this.selectedFiles.size === 0) {
            vscode.window.showWarningMessage('Не выбрано ни одного файла для копирования.');
            return;
        }
        const markdown = await MarkdownBuilder.buildBundleMarkdown(this.selectedFiles, this.promptSettings);
        await vscode.env.clipboard.writeText(markdown);
        vscode.window.showInformationMessage(`Скопирован контекст: ${this.selectedFiles.size} файлов!`);
    }

    public async exportContextToFile(): Promise<void> {
        if (this.selectedFiles.size === 0) {
            vscode.window.showWarningMessage('Не выбрано ни одного файла для экспорта.');
            return;
        }

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('project-context.md'),
            filters: { 'Markdown': ['md'], 'All Files': ['*'] }
        });

        if (!uri) {
            return;
        }

        const markdown = await MarkdownBuilder.buildBundleMarkdown(this.selectedFiles, this.promptSettings);
        await fs.promises.writeFile(uri.fsPath, markdown, 'utf-8');
        vscode.window.showInformationMessage(`Файл сохранен: ${path.basename(uri.fsPath)}`);
    }

    public async previewContext(): Promise<void> {
        if (this.selectedFiles.size === 0) {
            vscode.window.showWarningMessage('Сначала выберите файлы для предпросмотра.');
            return;
        }
        const markdown = await MarkdownBuilder.buildBundleMarkdown(this.selectedFiles, this.promptSettings);
        const doc = await vscode.workspace.openTextDocument({
            content: markdown,
            language: 'markdown'
        });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
    }

    /**
     * Полное освобождение ресурсов при деактивации расширения
     */
    public dispose(): void {
        this._isDisposed = true;

        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }

        this.disposeWatchers();
        this.disposables.forEach(d => {
            try {
                d.dispose();
            } catch {}
        });
        this.disposables.length = 0;
    }
}