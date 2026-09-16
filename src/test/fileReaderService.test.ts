import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { FileReaderService } from '../services/fileReaderService';

function createMojibakeSample(): string {
  const charCodes = [
    0x0420, 0x041F, 0x0421, 0x0402, 0x0420, 0x0451, 0x0420, 0x0406, 0x0420, 0x00B5, 0x0421, 0x201A,
    0x0020,
    0x0420, 0x0458, 0x0420, 0x0406, 0x0421, 0x0402,
    0x002C, 0x0020,
    0x0421, 0x040C, 0x0421, 0x201A, 0x0420, 0x0455,
    0x0020,
    0x0421, 0x201A, 0x0420, 0x00B5, 0x0421, 0x0403, 0x0421, 0x201A
  ];

  return String.fromCharCode(...charCodes);
}

suite('FileReaderService: Binary & Encoding Safety Tests', () => {
  let tempDir: string;

  suiteSetup(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-context-reader-test-'));
  });

  suiteTeardown(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore directory cleanup error
    }
  });

  test('Detects binary file by Magic Bytes (PNG signature) regardless of extension', async () => {
    const fakePngPath = path.join(tempDir, 'image_disguised_as_txt.txt');
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    await fs.promises.writeFile(fakePngPath, pngHeader);

    const result = await FileReaderService.safeReadFile(fakePngPath);
    assert.strictEqual(result.text, undefined);
    assert.strictEqual(result.placeholder?.includes('Binary or compiled file'), true);
  });

  test('Detects binary file by null-bytes inside buffer payload even when file extension is .txt', async () => {
    const nullByteFile = path.join(tempDir, 'binary_payload_as_text.txt');
    const bufferWithZeros = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x57, 0x6f, 0x72, 0x6c, 0x64]);
    await fs.promises.writeFile(nullByteFile, bufferWithZeros);

    const result = await FileReaderService.safeReadFile(nullByteFile);
    assert.strictEqual(result.text, undefined, 'Text content must not be returned for files containing null bytes');
    assert.strictEqual(result.placeholder?.includes('Binary'), true, 'Placeholder must indicate binary payload');
  });

  test('Detects corrupted double-encoded UTF-8 mojibake and yields placeholder', async () => {
    const mojibakeFile = path.join(tempDir, 'mojibake.txt');
    const mojibakeString = createMojibakeSample();
    await fs.promises.writeFile(mojibakeFile, mojibakeString, 'utf-8');

    const result = await FileReaderService.safeReadFile(mojibakeFile);
    assert.strictEqual(result.text, undefined);
    assert.strictEqual(result.placeholder?.includes('Mojibake detected'), true);
  });
});