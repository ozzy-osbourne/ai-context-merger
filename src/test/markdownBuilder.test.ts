import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { MarkdownBuilder } from '../services/markdownBuilder';
import { PromptSettings } from '../types';

/**
 * Test suite for Markdown fence collisions, prompt inclusion/exclusion, diff-only mode, and tree generation boundaries.
 */
suite('MarkdownBuilder: Dynamic Code Fences & Formatting Tests', () => {
  let tempDir: string;

  suiteSetup(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-context-md-test-'));
  });

  suiteTeardown(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  test('Generates 4+ backtick fence when file contains inner triple backticks', async () => {
    const fileWithCodeBlocks = new Set<string>();
    const testFile = path.join(tempDir, 'sample.md');
    await fs.promises.writeFile(testFile, 'Inside code:\n```typescript\nconst x = 10;\n```', 'utf-8');
    fileWithCodeBlocks.add(testFile);

    const bundleMarkdown = await MarkdownBuilder.buildBundleMarkdown(fileWithCodeBlocks);
    // Outer fence must be at least ```` to avoid markdown collision with inner ```
    assert.strictEqual(bundleMarkdown.includes('````markdown'), true);
  });

  test('Resolves correct syntax highlighting tags by extension', () => {
    assert.strictEqual(MarkdownBuilder.getLanguageTag('src/app.ts'), 'typescript');
    assert.strictEqual(MarkdownBuilder.getLanguageTag('src/index.tsx'), 'tsx');
    assert.strictEqual(MarkdownBuilder.getLanguageTag('scripts/run.py'), 'python');
    assert.strictEqual(MarkdownBuilder.getLanguageTag('unknown.custom'), 'text');
  });

  test('Includes ## Instruction section when prompt is enabled and non-empty', async () => {
    const promptSettings: PromptSettings = {
      enabled: true,
      text: 'Analyze memory usage and suggest fixes.'
    };

    const bundleMarkdown = await MarkdownBuilder.buildBundleMarkdown(
      new Set<string>(),
      promptSettings
    );

    assert.strictEqual(bundleMarkdown.includes('## Instruction:'), true);
    assert.strictEqual(bundleMarkdown.includes('Analyze memory usage and suggest fixes.'), true);
  });

  test('Excludes ## Instruction section when prompt is disabled or contains only whitespace', async () => {
    const disabledPrompt: PromptSettings = {
      enabled: false,
      text: 'Some prompt that is currently disabled'
    };

    const whitespacePrompt: PromptSettings = {
      enabled: true,
      text: '   \n  \t  '
    };

    const resultDisabled = await MarkdownBuilder.buildBundleMarkdown(new Set<string>(), disabledPrompt);
    const resultWhitespace = await MarkdownBuilder.buildBundleMarkdown(new Set<string>(), whitespacePrompt);

    assert.strictEqual(resultDisabled.includes('## Instruction:'), false);
    assert.strictEqual(resultWhitespace.includes('## Instruction:'), false);
  });

  test('Omits Project Structure section when no files are selected', async () => {
    const promptSettings: PromptSettings = {
      enabled: true,
      text: 'Task without files'
    };

    const bundleMarkdown = await MarkdownBuilder.buildBundleMarkdown(
      new Set<string>(),
      promptSettings
    );

    assert.strictEqual(bundleMarkdown.includes('Project Structure:'), false);
  });

  test('Omits Project Structure when includeProjectStructure is set to false even if files are selected', async () => {
    const testFile = path.join(tempDir, 'sample_no_tree.ts');
    await fs.promises.writeFile(testFile, 'export const val = 42;', 'utf-8');
    const files = new Set<string>([testFile]);

    const resultWithTree = await MarkdownBuilder.buildBundleMarkdown(files, undefined, undefined, undefined, undefined, undefined, undefined, true);
    assert.strictEqual(resultWithTree.includes('Project Structure:'), true);

    const resultWithoutTree = await MarkdownBuilder.buildBundleMarkdown(files, undefined, undefined, undefined, undefined, undefined, undefined, false);
    assert.strictEqual(resultWithoutTree.includes('Project Structure:'), false);
    assert.strictEqual(resultWithoutTree.includes('export const val = 42;'), true);
  });

  test('Omits file content blocks in "diffOnly" mode while keeping project structure and Git diff', async () => {
    const testFile = path.join(tempDir, 'app.ts');
    await fs.promises.writeFile(testFile, 'export const a = 1;', 'utf-8');
    const files = new Set<string>([testFile]);

    const result = await MarkdownBuilder.buildBundleMarkdown(
      files,
      undefined,
      { includeGitDiff: true, diffOnly: true, unlimitedDiff: false },
      'diff --git a/app.ts b/app.ts\n+export const a = 1;'
    );

    assert.strictEqual(result.includes('Project Structure:'), true);
    assert.strictEqual(result.includes('## Git Diff:'), true);
    assert.strictEqual(result.includes('## File path:'), false);
    assert.strictEqual(result.includes('## File content:'), false);
  });
});