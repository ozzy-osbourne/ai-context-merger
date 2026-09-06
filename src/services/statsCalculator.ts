import * as fs from 'fs';
import { ContextStats } from '../types';
import { MAX_CONTEXT_TOKENS } from '../constants';

export class StatsCalculator {
    /**
     * Параллельный подсчет размера и приблизительного количества токенов
     * @param selectedFiles Множество путей выбранных файлов
     */
    public static async calculateStats(selectedFiles: Set<string>): Promise<ContextStats> {
        let totalChars = 0;
        const filesArray = Array.from(selectedFiles);

        // Параллельное чтение метаданных файлов через Promise.all
        const sizePromises = filesArray.map(async (filePath) => {
            try {
                const stat = await fs.promises.stat(filePath);
                return stat.size;
            } catch {
                return 0;
            }
        });

        const sizes = await Promise.all(sizePromises);
        for (const size of sizes) {
            totalChars += size;
        }

        // Приблизительная оценка: 1 токен ≈ 4 символа исходного кода
        const estimatedTokens = Math.ceil(totalChars / 4);
        const percentage = Math.min(100, Math.round((estimatedTokens / MAX_CONTEXT_TOKENS) * 100));

        return {
            count: selectedFiles.size,
            tokens: estimatedTokens,
            percentage
        };
    }
}