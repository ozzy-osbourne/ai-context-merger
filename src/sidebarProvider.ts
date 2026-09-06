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
 * Поддерживает файловый сканер, Git-интеграцию, сборку Markdown и реактивное автообновление.
 */
export class ContextMergerSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aiContextMergerView';
    private _view?: vscode.WebviewView;

    public selectedFiles: Set<string> = new Set<string>();

    private filters: FilterSettings = {
        hideGitIgnored: true,
        hideLockFiles: true,
        hideBinaryFiles: true
    };

    // Настройки инструкции для ИИ
    private promptSettings: PromptSettings = {
        enabled: false,
        text: ''
    };

    private debounceTimer?: NodeJS.Timeout;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(private readonly _extensionUri: vscode.Uri) {
        this.initAutoWatchers();
    }

    private initAutoWatchers(): void {
        const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
        
        fileWatcher.onDidCreate(() => this.triggerDebouncedRefresh(), this, this.disposables);
        fileWatcher.onDidDelete(() => this.triggerDebouncedRefresh(), this, this.disposables);
        fileWatcher.onDidChange(() => this.triggerDebouncedRefresh(), this, this.disposables);
        this.disposables.push(fileWatcher);

        this.initGitWatcher();
    }

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

            gitApi.onDidOpenRepository((repo: any) => {
                repo.state.onDidChange(() => this.triggerDebouncedRefresh(), this, this.disposables);
            }, this, this.disposables);

            gitApi.repositories.forEach((repo: any) => {
                repo.state.onDidChange(() => this.triggerDebouncedRefresh(), this, this.disposables);
            });
        } catch (error) {
            console.warn('[AI Context Merger] Ошибка подписки на Git API:', error);
        }
    }

    public triggerDebouncedRefresh(): void {
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

    public async refresh(smartGitExpand: boolean = false, isInitialLoad: boolean = false): Promise<void> {
        if (!this._view) {
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
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
        const gitStatusMap = await GitService.getGitStatusMap();
        const tree = await WorkspaceScanner.scanDirectory(rootPath, gitStatusMap, this.filters);

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
        this.refresh();
    }

    private async updateStatsOnly(): Promise<void> {
        if (!this._view) {
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

    public dispose(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.disposables.forEach(d => d.dispose());
    }
}