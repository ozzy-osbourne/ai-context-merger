import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

import { XmlUtils } from '../utils/xmlUtils';
import { PathUtils } from '../utils/pathUtils';
import { isSecretFile, isMinifiedOrSourceMap, ALWAYS_IGNORED } from '../constants/filters';
import { MarkdownBuilder } from '../services/markdownBuilder';
import { FileReaderService } from '../services/fileReaderService';
import { WorkspaceScanner } from '../services/workspaceScanner';
import { PresetService } from '../services/presetService';
import { ContextTreeStateResolver } from '../services/contextTreeStateResolver';

suite('AI Context Merger: Comprehensive Test Suite', () => {

  // =========================================================================
  // 1. Модуль безопасного чтения файлов, кодировок и динамических заборов
  // =========================================================================
  suite('1. Safe File Reading & Encoding Protection', () => {
    let tempDir: string;

    suiteSetup(async () => {
      tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-context-test-'));
    });

    suiteTeardown(async () => {
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    test('Detects binary file by Magic Bytes (PNG header) regardless of extension', async () => {
      const fakePngPath = path.join(tempDir, 'image_disguised_as_txt.txt');
      // PNG Signature: 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
      await fs.promises.writeFile(fakePngPath, pngHeader);

      const result = await FileReaderService.safeReadFile(fakePngPath);
      assert.strictEqual(result.text, undefined);
      assert.strictEqual(result.placeholder?.includes('Бинарный или скомпилированный файл'), true);
    });

    test('Detects binary file by null-bytes in buffer', async () => {
      const nullByteFile = path.join(tempDir, 'binary_data.dat');
      const bufferWithZeros = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x57, 0x6f, 0x72, 0x6c, 0x64]);
      await fs.promises.writeFile(nullByteFile, bufferWithZeros);

      const result = await FileReaderService.safeReadFile(nullByteFile);
      assert.strictEqual(result.text, undefined);
      assert.strictEqual(result.placeholder?.includes('Бинарный'), true);
    });

    test('Detects corrupted double-encoded UTF-8 mojibake and yields placeholder', async () => {
      const mojibakeFile = path.join(tempDir, 'mojibake.txt');
      // Cyrillic UTF-8 bytes double-decoded as Windows-1251
      const mojibakeString = 'РџСЂРёРІРµС‚ РјРёСЂ, СЌС‚Рѕ С‚РµСЃС‚';
      await fs.promises.writeFile(mojibakeFile, mojibakeString, 'utf-8');

      const result = await FileReaderService.safeReadFile(mojibakeFile);
      assert.strictEqual(result.text, undefined);
      assert.strictEqual(result.placeholder?.includes('Обнаружен повреждённый моджибейк'), true);
    });

    test('MarkdownBuilder generates 4+ backtick fence when file contains triple backticks', async () => {
      const fileWithCodeBlocks = new Set<string>();
      const testFile = path.join(tempDir, 'sample.md');
      await fs.promises.writeFile(testFile, 'Inside code:\n```typescript\nconst x = 10;\n```', 'utf-8');
      fileWithCodeBlocks.add(testFile);

      const bundleMarkdown = await MarkdownBuilder.buildBundleMarkdown(fileWithCodeBlocks);
      // The outer fence must be at least ```` to avoid collision with inner ```
      assert.strictEqual(bundleMarkdown.includes('````markdown'), true);
    });

    test('XmlUtils splits "]]>" properly to prevent XML payload injection', () => {
      const input = '<script>]]><nested>data</nested></script>';
      const escaped = XmlUtils.escapeCdata(input);
      // Ensures the closing sequence is safely split into multiple CDATA blocks
      assert.strictEqual(escaped, '<script>]]]]><![CDATA[><nested>data</nested></script>');
      assert.strictEqual(escaped.includes(']]]]><![CDATA[>'), true);
    });
  });

  // =========================================================================
  // 2. Модуль производительности вотчеров (игнорирование тяжелых папок)
  // =========================================================================
  suite('2. Watchers & Path Segment Filters (npm install protection)', () => {
    test('Unconditionally ignores node_modules, build artifacts and VCS metadata', () => {
      const nodeModulesPath = '/workspace/my-app/node_modules/express/index.js';
      const gitInternalPath = '/workspace/my-app/.git/objects/abc';
      const buildDistPath = '/workspace/my-app/dist/bundle.js';
      const venvPath = '/workspace/my-app/.venv/lib/python3.10/site.py';

      assert.strictEqual(WorkspaceScanner.isIgnoredByPathSegments(nodeModulesPath), true);
      assert.strictEqual(WorkspaceScanner.isIgnoredByPathSegments(gitInternalPath), true);
      assert.strictEqual(WorkspaceScanner.isIgnoredByPathSegments(buildDistPath), true);
      assert.strictEqual(WorkspaceScanner.isIgnoredByPathSegments(venvPath), true);
    });

    test('Permits valid source files in root or subdirectories', () => {
      assert.strictEqual(WorkspaceScanner.isIgnoredByPathSegments('/workspace/my-app/src/index.ts'), false);
      assert.strictEqual(WorkspaceScanner.isIgnoredByPathSegments('/workspace/my-app/package.json'), false);
    });
  });

  // =========================================================================
  // 3. Модуль Multi-root воркспейсов и кросс-дисковых путей (Windows)
  // =========================================================================
  suite('3. Multi-Root Workspaces & Cross-Platform Paths', () => {
    test('Correctly prefixes folder name when multiple workspace roots exist', () => {
      const mockWorkspaces: vscode.WorkspaceFolder[] = [
        {
          uri: vscode.Uri.file('/workspaces/frontend'),
          name: 'frontend',
          index: 0
        },
        {
          uri: vscode.Uri.file('/workspaces/backend'),
          name: 'backend',
          index: 1
        }
      ];

      const frontFile = '/workspaces/frontend/src/App.tsx';
      const backFile = '/workspaces/backend/src/server.ts';

      const relFront = PathUtils.getRelativePath(frontFile, mockWorkspaces);
      const relBack = PathUtils.getRelativePath(backFile, mockWorkspaces);

      assert.strictEqual(relFront, 'frontend/src/App.tsx');
      assert.strictEqual(relBack, 'backend/src/server.ts');
    });

    test('Cross-drive subpath check on Windows (C:\\ vs D:\\) does not throw or mismatch', () => {
      const pathDriveC = 'C:\\Projects\\App\\index.ts';
      const pathDriveD = 'D:\\Projects\\App\\index.ts';
      const rootDriveC = 'C:\\Projects\\App';

      assert.strictEqual(PathUtils.isSubpath(pathDriveC, rootDriveC), true);
      assert.strictEqual(PathUtils.isSubpath(pathDriveD, rootDriveC), false);
    });
  });

  // =========================================================================
  // 4. Модуль валидации пресетов и лимитов хранилища
  // =========================================================================
  suite('4. Preset Validation & Storage Limits', () => {
    // Dummy context with empty globalState to test PresetService validation rules
    const dummyContext = {
      globalState: {
        get: () => [],
        update: async () => {},
        setKeysForSync: () => {}
      }
    } as unknown as vscode.ExtensionContext;

    const presetService = new PresetService(dummyContext);

    test('Rejects empty or whitespace-only preset names and texts', () => {
      const emptyName = presetService.validatePreset('   ', 'valid body');
      assert.strictEqual(emptyName.isValid, false);

      const emptyText = presetService.validatePreset('Valid Title', '   ');
      assert.strictEqual(emptyText.isValid, false);
    });

    test('Rejects preset names longer than 32 characters', () => {
      const longName = 'A'.repeat(33);
      const validation = presetService.validatePreset(longName, 'Some prompt body');
      assert.strictEqual(validation.isValid, false);
      assert.strictEqual(validation.warning?.includes('32 символа'), true);
    });

    test('Accepts valid custom presets', () => {
      const validation = presetService.validatePreset('🔍 SQL Оптимизация', 'Оптимизируй SQL-запросы');
      assert.strictEqual(validation.isValid, true);
      assert.strictEqual(validation.trimmedName, '🔍 SQL Оптимизация');
    });
  });

  // =========================================================================
  // 5. Модуль логики дерева и склонения счетчиков файлов
  // =========================================================================
  suite('5. Tree State & File Counter Pluralization', () => {
    test('Correctly formats Russian plural forms for selected file counters', () => {
      assert.strictEqual(ContextTreeStateResolver.formatFilePlural(1), '1 файл выбран');
      assert.strictEqual(ContextTreeStateResolver.formatFilePlural(2), '2 файла выбрано');
      assert.strictEqual(ContextTreeStateResolver.formatFilePlural(4), '4 файла выбрано');
      assert.strictEqual(ContextTreeStateResolver.formatFilePlural(5), '5 файлов выбрано');
      assert.strictEqual(ContextTreeStateResolver.formatFilePlural(11), '11 файлов выбрано');
      assert.strictEqual(ContextTreeStateResolver.formatFilePlural(21), '21 файл выбран');
      assert.strictEqual(ContextTreeStateResolver.formatFilePlural(24), '24 файла выбрано');
    });
  });
});