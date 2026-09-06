import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BINARY_EXTENSIONS, LANGUAGE_MAP } from '../constants';
import { PromptSettings } from '../types';

interface AsciiTreeNode {
    name: string;
    isDirectory: boolean;
    children: Map<string, AsciiTreeNode>;
}

export class MarkdownBuilder {
    /**
     * Определение тега подсветки Markdown по расширению файла
     * @param filePath Путь к файлу
     */
    public static getLanguageTag(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        return LANGUAGE_MAP[ext] || 'text';
    }

    /**
     * Динамический расчет закрывающего блока бэктиков (защита от коллизий c кодом Markdown)
     * @param content Содержимое файла
     */
    private static getFenceSequence(content: string): string {
        const matches = content.match(/`{3,}/g);
        if (!matches) {
            return '```';
        }
        let maxLen = 2;
        for (const match of matches) {
            if (match.length > maxLen) {
                maxLen = match.length;
            }
        }
        // Оборачивающий блок должен быть минимум на один символ длиннее внутреннего
        return '`'.repeat(maxLen + 1);
    }

    /**
     * Построение промежуточного дерева для генерации ASCII-структуры
     * @param relativePaths Список относительных путей выбранных файлов
     */
    private static buildAsciiTreeHierarchy(relativePaths: string[]): AsciiTreeNode {
        const root: AsciiTreeNode = {
            name: '',
            isDirectory: true,
            children: new Map()
        };

        for (const relPath of relativePaths) {
            const segments = relPath.split('/').filter(Boolean);
            let currentNode = root;

            for (let i = 0; i < segments.length; i++) {
                const segment = segments[i];
                const isDirectory = i < segments.length - 1;

                if (!currentNode.children.has(segment)) {
                    currentNode.children.set(segment, {
                        name: segment,
                        isDirectory,
                        children: new Map()
                    });
                }
                currentNode = currentNode.children.get(segment)!;
            }
        }

        return root;
    }

    /**
     * Рекурсивный рендеринг ASCII-дерева с псевдографикой ветвления
     * @param node Текущий узел дерева
     * @param prefix Префикс текущей строки отступа
     */
    private static renderAsciiTreeLines(node: AsciiTreeNode, prefix: string = ''): string[] {
        const lines: string[] = [];
        const entries = Array.from(node.children.values()).sort((a, b) => {
            if (a.isDirectory === b.isDirectory) {
                return a.name.localeCompare(b.name);
            }
            return a.isDirectory ? -1 : 1;
        });

        for (let i = 0; i < entries.length; i++) {
            const child = entries[i];
            const isLast = i === entries.length - 1;
            const branchSymbol = isLast ? '└── ' : '├── ';
            const nextPrefix = prefix + (isLast ? '    ' : '│   ');

            const displayName = child.isDirectory ? `${child.name}/` : child.name;
            lines.push(`${prefix}${branchSymbol}${displayName}`);

            if (child.isDirectory && child.children.size > 0) {
                lines.push(...this.renderAsciiTreeLines(child, nextPrefix));
            }
        }

        return lines;
    }

    /**
     * Генерация текстовой ASCII-структуры проекта
     * @param relativePaths Отсортированные относительные пути выбранных файлов
     */
    public static generateAsciiTree(relativePaths: string[]): string {
        const rootNode = this.buildAsciiTreeHierarchy(relativePaths);
        const lines = this.renderAsciiTreeLines(rootNode);
        return `Project Structure:\n${lines.join('\n')}`;
    }

    /**
     * Вычисление относительного пути с корректной поддержкой Multi-Root воркспейсов
     * @param filePath Абсолютный путь к файлу
     * @param workspaceFolders Список открытых папок рабочей области
     */
    private static getRelativePath(filePath: string, workspaceFolders?: readonly vscode.WorkspaceFolder[]): string {
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return path.basename(filePath);
        }

        // Если открыто несколько корневых папок, находим соответствующую
        for (const folder of workspaceFolders) {
            const folderPath = path.normalize(folder.uri.fsPath);
            const normFilePath = path.normalize(filePath);

            const isMatching = process.platform === 'win32'
                ? normFilePath.toLowerCase().startsWith(folderPath.toLowerCase())
                : normFilePath.startsWith(folderPath);

            if (isMatching) {
                const rel = path.relative(folderPath, normFilePath).replace(/\\/g, '/');
                // Для Multi-Root добавляем имя корневой папки в начало пути
                return workspaceFolders.length > 1 ? `${folder.name}/${rel}` : rel;
            }
        }

        return path.basename(filePath);
    }

    /**
     * Сборка итогового Markdown документа
     * @param selectedFiles Множество путей выбранных файлов
     * @param promptSettings Настройки пользовательской инструкции
     */
    public static async buildBundleMarkdown(
        selectedFiles: Set<string>,
        promptSettings?: PromptSettings
    ): Promise<string> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const sortedFiles = Array.from(selectedFiles).sort();
        const relativePaths = sortedFiles.map(file => this.getRelativePath(file, workspaceFolders));

        const outputBlocks: string[] = [];

        // ---------------------------------------------------------------------
        // 1. Формирование пользовательской инструкции для ИИ
        // ---------------------------------------------------------------------
        if (promptSettings && promptSettings.enabled) {
            const trimmedPrompt = promptSettings.text.trim();
            if (trimmedPrompt.length > 0) {
                outputBlocks.push(`## Instruction:\n${trimmedPrompt}`);
            }
        }

        // ---------------------------------------------------------------------
        // 2. ASCII-дерево структуры выбранных файлов
        // ---------------------------------------------------------------------
        const asciiTree = this.generateAsciiTree(relativePaths);
        outputBlocks.push(asciiTree);

        // ---------------------------------------------------------------------
        // 3. Формирование секции для каждого выбранного файла
        // ---------------------------------------------------------------------
        for (let i = 0; i < sortedFiles.length; i++) {
            const filePath = sortedFiles[i];
            const relativePath = relativePaths[i];
            const fileName = path.basename(filePath);
            const ext = path.extname(filePath).toLowerCase();
            const isBinary = BINARY_EXTENSIONS.has(ext);

            let contentBlock = '';

            if (isBinary) {
                try {
                    const stat = await fs.promises.stat(filePath);
                    const sizeKb = (stat.size / 1024).toFixed(1);
                    contentBlock = `[Бинарный файл: ${ext.replace('.', '').toUpperCase()} (${sizeKb} KB) — содержимое пропущено для сохранения контекста]`;
                } catch {
                    contentBlock = `[Бинарный файл: ${ext} — пропущен]`;
                }
            } else {
                try {
                    const text = (await fs.promises.readFile(filePath, 'utf-8')).trimEnd();
                    const langTag = this.getLanguageTag(filePath);
                    const fence = this.getFenceSequence(text);
                    // Оборачиваем вычисленной последовательностью бэктиков
                    contentBlock = `${fence}${langTag}\n${text}\n${fence}`;
                } catch (err) {
                    contentBlock = `\`\`\`text\n<Ошибка чтения файла: ${err}>\n\`\`\``;
                }
            }

            const fileSection = `## File path: ${relativePath}\n## File name: ${fileName}\n## File content:\n${contentBlock}`;
            outputBlocks.push(fileSection);
        }

        return outputBlocks.join('\n\n---\n\n');
    }
}