import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BINARY_EXTENSIONS, LANGUAGE_MAP } from '../constants';

export class MarkdownBuilder {
    /**
     * Определение тега подсветки Markdown по расширению файла
     */
    public static getLanguageTag(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        return LANGUAGE_MAP[ext] || 'text';
    }

    /**
     * Сборка итогового Markdown документа по заданному формату:
     * ## File path: <path>
     * 
     * ## File content:
     * ```<lang>
     * <code>
     * ```
     * 
     * 
     * ---
     */
    public static async buildBundleMarkdown(selectedFiles: Set<string>): Promise<string> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const rootPath = workspaceFolders ? path.normalize(workspaceFolders[0].uri.fsPath) : '';

        const outputBlocks: string[] = [];

        for (const filePath of Array.from(selectedFiles).sort()) {
            const relativePath = path.relative(rootPath, filePath).replace(/\\/g, '/');
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
                    contentBlock = `\`\`\`${langTag}\n${text}\n\`\`\``;
                } catch (err) {
                    contentBlock = `\`\`\`text\n<Ошибка чтения файла: ${err}>\n\`\`\``;
                }
            }

            // Формируем блок файла строго по заданному шаблону
            const fileSection = `## File path: ${relativePath}\n\n## File content:\n${contentBlock}`;
            outputBlocks.push(fileSection);
        }

        // Соединяем блоки разделителем с двойными пропусками строк
        return outputBlocks.join('\n\n---\n\n');
    }
}