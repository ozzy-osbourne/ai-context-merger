import * as fs from 'fs';
import { ContextStats } from '../types';
import { MAX_CONTEXT_TOKENS } from '../constants';

export class StatsCalculator {
    /**
     * Подсчет размера и приблизительного количества токенов
     */
    public static async calculateStats(selectedFiles: Set<string>): Promise<ContextStats> {
        let totalChars = 0;

        for (const filePath of selectedFiles) {
            try {
                const stat = await fs.promises.stat(filePath);
                totalChars += stat.size;
            } catch {}
        }

        const estimatedTokens = Math.ceil(totalChars / 4);
        const percentage = Math.min(100, Math.round((estimatedTokens / MAX_CONTEXT_TOKENS) * 100));

        return {
            count: selectedFiles.size,
            tokens: estimatedTokens,
            percentage
        };
    }
}