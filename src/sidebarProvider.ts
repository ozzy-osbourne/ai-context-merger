import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FilterSettings } from './types';
import { GitService } from './services/gitService';
import { WorkspaceScanner } from './services/workspaceScanner';
import { StatsCalculator } from './services/statsCalculator';
import { MarkdownBuilder } from './services/markdownBuilder';
import { getHtmlTemplate } from './ui/htmlTemplate';

/**
 * Провайдер сайдбара с расширенным форматированием Markdown,
 * фильтрами отображения и интеграцией с Git.
 */
export class ContextMergerSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aiContextMergerView';
    private _view?: vscode.WebviewView;

    // Множество выбранных файлов
    public selectedFiles: Set<string> = new Set<string>();

    // Текущие фильтры
    private filters: FilterSettings = {
        hideGitIgnored: true,
        hideLockFiles: true,
        hideBinaryFiles: true
    };

    constructor(private readonly _extensionUri: vscode.Uri) {}

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

        // Слушатель сообщений от веб-интерфейса
        webviewView.webview.onDidReceiveMessage(async (message) => {
            console.log(`[AI Context Merger] UI Action: "${message.type}"`, message);

            switch (message.type) {
                case 'toggleFile':
                    this.handleFileToggle(message.filePath, message.checked);
                    break;
                case 'toggleFolder':
                    await this.handleFolderToggle(message.folderPath, message.checked);
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
                case 'clearSelection':
                    this.clearSelection();
                    break;
                case 'selectModified':
                    await this.selectModifiedGitFiles();
                    break;
                case 'updateFilters':
                    this.filters = message.filters;
                    await this.refresh();
                    break;
                case 'refresh':
                    await this.refresh();
                    break;
                case 'requestInitialData':
                    await this.refresh();
                    break;
            }
        });
    }

    public async selectModifiedGitFiles() {
        console.log('[AI Context Merger] Выбор измененных файлов...');
        const gitStatuses = await GitService.getGitStatusMap();

        this.selectedFiles.clear();
        for (const [filePath, status] of gitStatuses.entries()) {
            if (status === 'modified' || status === 'untracked') {
                this.selectedFiles.add(filePath);
            }
        }

        vscode.window.showInformationMessage(`Выбрано файлов Git Diff: ${this.selectedFiles.size}`);
        await this.refresh();
    }

    public async refresh() {
        if (!this._view) return;

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            this._view.webview.postMessage({
                type: 'setData',
                tree: [],
                stats: { count: 0, tokens: 0, percentage: 0 },
                selectedFiles: [],
                filters: this.filters
            });
            return;
        }

        const rootPath = path.normalize(workspaceFolders[0].uri.fsPath);
        const gitStatusMap = await GitService.getGitStatusMap();
        const tree = await WorkspaceScanner.scanDirectory(rootPath, gitStatusMap, this.filters);
        const stats = await StatsCalculator.calculateStats(this.selectedFiles);

        this._view.webview.postMessage({
            type: 'setData',
            tree: [tree],
            stats,
            selectedFiles: Array.from(this.selectedFiles),
            filters: this.filters
        });
    }

    public clearSelection() {
        this.selectedFiles.clear();
        this.refresh();
    }

    private handleFileToggle(filePath: string, checked: boolean) {
        const normalized = path.normalize(filePath);
        if (checked) {
            this.selectedFiles.add(normalized);
        } else {
            this.selectedFiles.delete(normalized);
        }
        this.updateStatsOnly();
    }

    private async handleFolderToggle(folderPath: string, checked: boolean) {
        const normalized = path.normalize(folderPath);
        await WorkspaceScanner.toggleFolderRecursive(normalized, checked, this.filters, this.selectedFiles);
        this.refresh();
    }

    private async updateStatsOnly() {
        if (!this._view) return;
        const stats = await StatsCalculator.calculateStats(this.selectedFiles);
        this._view.webview.postMessage({
            type: 'updateStats',
            stats,
            selectedFiles: Array.from(this.selectedFiles)
        });
    }

    public async copyContextToClipboard() {
        if (this.selectedFiles.size === 0) {
            vscode.window.showWarningMessage('Не выбрано ни одного файла для копирования.');
            return;
        }
        const markdown = await MarkdownBuilder.buildBundleMarkdown(this.selectedFiles);
        await vscode.env.clipboard.writeText(markdown);
        vscode.window.showInformationMessage(`Скопирован контекст: ${this.selectedFiles.size} файлов!`);
    }

    public async exportContextToFile() {
        if (this.selectedFiles.size === 0) {
            vscode.window.showWarningMessage('Не выбрано ни одного файла для экспорта.');
            return;
        }

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('project-context.md'),
            filters: { 'Markdown': ['md'], 'All Files': ['*'] }
        });

        if (!uri) return;

        const markdown = await MarkdownBuilder.buildBundleMarkdown(this.selectedFiles);
        await fs.promises.writeFile(uri.fsPath, markdown, 'utf-8');
        vscode.window.showInformationMessage(`Файл сохранен: ${path.basename(uri.fsPath)}`);
    }

    public async previewContext() {
        if (this.selectedFiles.size === 0) {
            vscode.window.showWarningMessage('Сначала выберите файлы для предпросмотра.');
            return;
        }
        const markdown = await MarkdownBuilder.buildBundleMarkdown(this.selectedFiles);
        const doc = await vscode.workspace.openTextDocument({
            content: markdown,
            language: 'markdown'
        });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
    }
}