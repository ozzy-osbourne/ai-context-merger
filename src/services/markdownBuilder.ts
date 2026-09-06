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
     */
    public static getLanguageTag(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        return LANGUAGE_MAP[ext] || 'text';
    }

    /**
     * Динамический расчет закрывающего блока бэктиков для исключения коллизий
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
        return '`'.repeat(maxLen + 1);
    }

    /**
     * Кроссплатформенная нормализация путей и регистра буквы диска для Windows / macOS / Linux
     * @param p Путь к файлу или папке
     */
    public static normalizePathForComparison(p: string): string {
        const normalized = path.normalize(p);
        if (process.platform === 'win32') {
            // На Windows приводим букву диска к верхнему регистру (C:\ вместо c:\)
            return normalized.replace(/^[a-zA-Z]:/, match => match.toUpperCase());
        }
        return normalized;
    }

    /**
     * Вычисление относительного пути с корректной поддержкой Multi-Root воркспейсов и регистра ОС
     * @param filePath Абсолютный путь к файлу
     * @param workspaceFolders Список открытых папок рабочей области
     */
    public static getRelativePath(filePath: string, workspaceFolders?: readonly vscode.WorkspaceFolder[]): string {
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return path.basename(filePath);
        }

        const normFilePath = this.normalizePathForComparison(filePath);
        const compareFilePath = process.platform === 'win32' ? normFilePath.toLowerCase() : normFilePath;

        for (const folder of workspaceFolders) {
            const folderPath = this.normalizePathForComparison(folder.uri.fsPath);
            const compareFolderPath = process.platform === 'win32' ? folderPath.toLowerCase() : folderPath;
            const folderPrefix = compareFolderPath.endsWith(path.sep) ? compareFolderPath : compareFolderPath + path.sep;

            const isMatching = compareFilePath.startsWith(folderPrefix) || compareFilePath === compareFolderPath;

            if (isMatching) {
                const rel = path.relative(folderPath, normFilePath).replace(/\\/g, '/');
                return workspaceFolders.length > 1 ? `${folder.name}/${rel}` : rel;
            }
        }

        return path.basename(filePath);
    }

    /**
     * Быстрая проверка буфера на наличие бинарных данных (нулевых байтов)
     */
    private static isBinaryBuffer(buffer: Buffer): boolean {
        const checkLength = Math.min(buffer.length, 8000);
        for (let i = 0; i < checkLength; i++) {
            if (buffer[i] === 0) {
                return true;
            }
        }
        return false;
    }

    /**
     * Безопасное чтение и декодирование файла с защитой от бинарников и повреждённых кодировок
     * @param filePath Абсолютный путь к файлу
     */
    public static async safeReadFile(filePath: string): Promise<{ text?: string; placeholder?: string }> {
        const ext = path.extname(filePath).toLowerCase();

        let stat: fs.Stats | undefined;
        try {
            stat = await fs.promises.stat(filePath);
        } catch {
            return { placeholder: `\`\`\`text\n<Ошибка чтения: файл не найден или заблокирован>\n\`\`\`` };
        }

        const sizeKb = (stat.size / 1024).toFixed(1);

        // 1. Проверка по известным расширениям бинарников
        if (BINARY_EXTENSIONS.has(ext)) {
            return {
                placeholder: `[Бинарный файл: ${ext.replace('.', '').toUpperCase()} (${sizeKb} KB) — содержимое пропущено для сохранения контекста]`
            };
        }

        let buffer: Buffer;
        try {
            buffer = await fs.promises.readFile(filePath);
        } catch (err) {
            return { placeholder: `\`\`\`text\n<Ошибка чтения файла: ${err}>\n\`\`\`` };
        }

        // 2. Эвристическая проверка на скрытые бинарные данные
        if (this.isBinaryBuffer(buffer)) {
            return {
                placeholder: `[Бинарный или скомпилированный файл: ${ext ? ext.replace('.', '').toUpperCase() : 'BINARY'} (${sizeKb} KB) — содержимое пропущено для сохранения контекста]`
            };
        }

        // 3. Строгая валидация UTF-8
        try {
            const strictDecoder = new TextDecoder('utf-8', { fatal: true });
            const text = strictDecoder.decode(buffer).trimEnd();
            return { text };
        } catch {
            // Если строгий UTF-8 упал, анализируем процент битых символов замены
            const lenientDecoder = new TextDecoder('utf-8', { fatal: false });
            const text = lenientDecoder.decode(buffer).trimEnd();
            const replacementCount = (text.match(/\uFFFD/g) || []).length;

            if (replacementCount > 0 && replacementCount / Math.max(text.length, 1) > 0.05) {
                return {
                    placeholder: `[Файл с нераспознанной или повреждённой кодировкой (не UTF-8, ${sizeKb} KB) — пропущен для предотвращения искажения контекста ИИ]`
                };
            }

            return { text };
        }
    }

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
     */
    public static generateAsciiTree(relativePaths: string[]): string {
        const rootNode = this.buildAsciiTreeHierarchy(relativePaths);
        const lines = this.renderAsciiTreeLines(rootNode);
        return `Project Structure:\n${lines.join('\n')}`;
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

        // 1. Формирование пользовательской инструкции для ИИ
        if (promptSettings && promptSettings.enabled) {
            const trimmedPrompt = promptSettings.text.trim();
            if (trimmedPrompt.length > 0) {
                outputBlocks.push(`## Instruction:\n${trimmedPrompt}`);
            }
        }

        // 2. ASCII-дерево структуры выбранных файлов
        const asciiTree = this.generateAsciiTree(relativePaths);
        outputBlocks.push(asciiTree);

        // 3. Формирование секции для каждого выбранного файла
        for (let i = 0; i < sortedFiles.length; i++) {
            const filePath = sortedFiles[i];
            const relativePath = relativePaths[i];
            const fileName = path.basename(filePath);

            const readResult = await this.safeReadFile(filePath);
            let contentBlock = '';

            if (readResult.placeholder) {
                contentBlock = readResult.placeholder;
            } else if (readResult.text !== undefined) {
                const langTag = this.getLanguageTag(filePath);
                const fence = this.getFenceSequence(readResult.text);
                contentBlock = `${fence}${langTag}\n${readResult.text}\n${fence}`;
            }

            const fileSection = `## File path: ${relativePath}\n## File name: ${fileName}\n## File content:\n${contentBlock}`;
            outputBlocks.push(fileSection);
        }

        return outputBlocks.join('\n\n---\n\n');
    }
}