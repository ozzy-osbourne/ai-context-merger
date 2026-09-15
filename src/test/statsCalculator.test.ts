import * as assert from 'assert';
import { StatsCalculator } from '../services/statsCalculator';
import { PromptSettings, GitDiffSettings, DiagnosticsSettings } from '../types';

/**
 * Test suite for token budget calculations, format structural overheads, and percentage metrics.
 */
suite('StatsCalculator: Token Budget & Format Overhead Tests', () => {
  const dummyPrompt: PromptSettings = {
    enabled: true,
    text: 'Analyze the performance of this module.'
  };

  const dummyDiff: GitDiffSettings = {
    includeGitDiff: true,
    diffOnly: false,
    unlimitedDiff: false
  };

  const dummyDiagnostics: DiagnosticsSettings = {
    enabled: true,
    includeCompiler: true,
    includeLinter: true
  };

  test('Returns zero metrics when no files are selected and no addons or instructions exist', async () => {
    const stats = await StatsCalculator.calculateStats(
      new Set<string>(),
      { enabled: false, text: '' },
      { includeGitDiff: false, diffOnly: false, unlimitedDiff: false },
      0,
      undefined,
      'markdown'
    );

    assert.strictEqual(stats.count, 0);
    assert.strictEqual(stats.tokens, 0);
    assert.strictEqual(stats.percentage, 0);
  });

  test('Correctly calculates token estimation for prompt even when 0 files are selected', async () => {
    const stats = await StatsCalculator.calculateStats(
      new Set<string>(),
      dummyPrompt,
      { includeGitDiff: false, diffOnly: false, unlimitedDiff: false },
      0,
      undefined,
      'markdown'
    );

    assert.strictEqual(stats.count, 0);
    assert.ok(stats.tokens > 0, 'Instruction tokens must be estimated even without selected files');
  });

  test('Demonstrates XML formatting structural overhead compared to Markdown', async () => {
    // Both formats calculate with same instruction and diff length
    const diffLength = 400;

    const statsMd = await StatsCalculator.calculateStats(
      new Set<string>(),
      dummyPrompt,
      dummyDiff,
      diffLength,
      undefined,
      'markdown'
    );

    const statsXml = await StatsCalculator.calculateStats(
      new Set<string>(),
      dummyPrompt,
      dummyDiff,
      diffLength,
      undefined,
      'xml'
    );

    assert.ok(
      statsXml.tokens > statsMd.tokens,
      `XML (${statsXml.tokens} tokens) must exhibit higher overhead than Markdown (${statsMd.tokens} tokens) due to tags and CDATA`
    );
  });

  test('Clamps budget usage percentage to maximum 100 on overflow', async () => {
    const stats = await StatsCalculator.calculateStats(
      new Set<string>(),
      { enabled: true, text: 'A'.repeat(50000) }, // ~12500 tokens
      undefined,
      0,
      undefined,
      'markdown',
      undefined,
      0,
      '2000' // Small budget of 2000 tokens
    );

    assert.strictEqual(stats.percentage, 100);
  });
});