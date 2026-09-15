import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { XmlBuilder } from '../services/xmlBuilder';
import { PromptSettings, GitFileStatus } from '../types';

/**
 * Test suite for XML context bundle assembly, CDATA isolation, instruction handling, and diffOnly mode.
 */
suite('XmlBuilder: Bundle Assembly & Structural Integrity Tests', () => {
  let tempDir: string;

  suiteSetup(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-context-xml-test-'));
  });

  suiteTeardown(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  test('Builds valid standard XML document structure with declaration and documents container', async () => {
    const fileA = path.join(tempDir, 'index.ts');
    await fs.promises.writeFile(fileA, 'console.log("Hello XML");', 'utf-8');

    const selectedFiles = new Set<string>([fileA]);
    const xml = await XmlBuilder.buildBundleXml(selectedFiles);

    assert.strictEqual(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), true);
    assert.strictEqual(xml.includes('<context>'), true);
    assert.strictEqual(xml.includes('</context>'), true);
    assert.strictEqual(xml.includes('<documents>'), true);
    assert.strictEqual(xml.includes('<document index="1">'), true);
    assert.strictEqual(xml.includes('<source>index.ts</source>'), true);
    assert.strictEqual(xml.includes('<file_name>index.ts</file_name>'), true);
    assert.strictEqual(xml.includes('<![CDATA[console.log("Hello XML");]]>'), true);
  });

  test('Includes <instructions> when prompt is enabled and excludes when disabled or whitespace-only', async () => {
    const enabledPrompt: PromptSettings = {
      enabled: true,
      text: 'Perform unit tests for this module.'
    };

    const disabledPrompt: PromptSettings = {
      enabled: false,
      text: 'Disabled prompt'
    };

    const whitespacePrompt: PromptSettings = {
      enabled: true,
      text: '   \r\n  \t '
    };

    const xmlEnabled = await XmlBuilder.buildBundleXml(new Set<string>(), enabledPrompt);
    const xmlDisabled = await XmlBuilder.buildBundleXml(new Set<string>(), disabledPrompt);
    const xmlWhitespace = await XmlBuilder.buildBundleXml(new Set<string>(), whitespacePrompt);

    assert.strictEqual(xmlEnabled.includes('<instructions>'), true);
    assert.strictEqual(xmlEnabled.includes('Perform unit tests for this module.'), true);
    assert.strictEqual(xmlDisabled.includes('<instructions>'), false);
    assert.strictEqual(xmlWhitespace.includes('<instructions>'), false);
  });

  test('Omits <project_structure> section when no files are selected', async () => {
    const promptSettings: PromptSettings = {
      enabled: true,
      text: 'Only instructions, 0 files'
    };

    const xml = await XmlBuilder.buildBundleXml(new Set<string>(), promptSettings);

    assert.strictEqual(xml.includes('<project_structure>'), false);
    assert.strictEqual(xml.includes('<documents>'), false);
  });

  test('Omits <project_structure> when includeProjectStructure is false even if files are selected', async () => {
    const fileA = path.join(tempDir, 'index_no_tree.ts');
    await fs.promises.writeFile(fileA, 'console.log("No tree");', 'utf-8');

    const selectedFiles = new Set<string>([fileA]);
    const xml = await XmlBuilder.buildBundleXml(
      selectedFiles,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false
    );

    assert.strictEqual(xml.includes('<project_structure>'), false);
    assert.strictEqual(xml.includes('<documents>'), true);
  });

  test('Renders deleted Git files with specialized placeholder without reading from disk', async () => {
    const deletedFile = path.join(tempDir, 'removed.ts');
    const selectedFiles = new Set<string>([deletedFile]);
    const gitStatuses = new Map<string, GitFileStatus>();
    gitStatuses.set(deletedFile, 'deleted');

    const xml = await XmlBuilder.buildBundleXml(
      selectedFiles,
      undefined,
      undefined,
      undefined,
      gitStatuses
    );

    assert.strictEqual(xml.includes('<document index="1">'), true);
    assert.strictEqual(xml.includes('<git_status>deleted</git_status>'), true);
    assert.strictEqual(xml.includes('<document_content>[Файл удален в Git]</document_content>'), true);
  });

  test('Omits <documents> container in "diffOnly" mode while retaining structure and <git_diff>', async () => {
    const testFile = path.join(tempDir, 'diff_only.ts');
    await fs.promises.writeFile(testFile, 'export const x = 99;', 'utf-8');
    const files = new Set<string>([testFile]);

    const xml = await XmlBuilder.buildBundleXml(
      files,
      undefined,
      { includeGitDiff: true, diffOnly: true, unlimitedDiff: false },
      'diff --git a/diff_only.ts b/diff_only.ts\n+export const x = 99;'
    );

    assert.strictEqual(xml.includes('<project_structure>'), true);
    assert.strictEqual(xml.includes('<git_diff>'), true);
    assert.strictEqual(xml.includes('<documents>'), false);
    assert.strictEqual(xml.includes('<document index='), false);
  });
});