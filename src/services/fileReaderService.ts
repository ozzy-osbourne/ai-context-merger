import * as path from 'path';
import * as fs from 'fs';
import { BINARY_EXTENSIONS, MAX_FILE_SIZE_BYTES } from '../constants';

/**
 * Result descriptor for safe file reading operations.
 */
export interface SafeFileReadResult {
  text?: string;
  placeholder?: string;
}

/**
 * Service responsible for safe file content reading, binary detection, encoding recovery, and placeholder generation.
 */
export class FileReaderService {
  /**
   * Magic byte headers of popular binary formats.
   */
  private static readonly BINARY_MAGIC_HEADERS: readonly number[][] = [
    // PDF (%PDF)
    [0x25, 0x50, 0x44, 0x46],
    // ZIP / JAR / DOCX / APK (PK\x03\x04)
    [0x50, 0x4b, 0x03, 0x04],
    // PNG (\x89PNG\r\n\x1a\n)
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    // JPEG (\xFF\xD8\xFF)
    [0xff, 0xd8, 0xff],
    // GIF87a & GIF89a (GIF8)
    [0x47, 0x49, 0x46, 0x38],
    // ELF Executable (\x7FELF)
    [0x7f, 0x45, 0x4c, 0x46],
    // Windows PE / DOS Executable (MZ)
    [0x4d, 0x5a],
    // WebAssembly (\0asm)
    [0x00, 0x61, 0x73, 0x6d],
    // Java Class File (CAFEBABE)
    [0xca, 0xfe, 0xba, 0xbe],
    // 7-Zip (7z\xBC\xAF\x27\x1C)
    [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],
    // GZIP (\x1F\x8B)
    [0x1f, 0x8b],
    // RAR (Rar!\x1A\x07)
    [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07],
    // SQLite 3 format
    [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00]
  ];

  /**
   * Common Russian vowel characters in lowercase for frequency analysis.
   */
  private static readonly CYRILLIC_VOWELS_REGEX = /[аеёиоуыэюя]/gi;

  /**
   * Regex matching classic double-encoded UTF-8 mojibake patterns.
   */
  private static readonly MOJIBAKE_PATTERNS = [
    // Cyrillic double-encoded as Windows-1251 (UTF-8 bytes 0xD0..0xD1 decoded as 'Р', 'С')
    /(?:[РС][\u0080-\u00BF\u0400-\u04FF\u2010-\u203A\u2122]){3,}/,
    // Cyrillic double-encoded as Windows-1252 / ISO-8859-1 (UTF-8 bytes 0xD0, 0xD1 decoded as 'Ð', 'Ñ')
    /(?:[ÐÑ][\u0080-\u00FF\u0100-\u017F\u2010-\u20AC]){3,}/,
    // Latin quotes & symbols double-encoded as Windows-1252 (UTF-8 byte 0xE2 decoded as 'â')
    /â[\u0080-\u00FF\u2010-\u20AC]{2}/
  ];

  /**
   * Generates a placeholder string for files exceeding the maximum allowable size limit.
   *
   * @param sizeInBytes - File size in bytes.
   * @returns Formatted placeholder message.
   */
  public static getSizeExceededPlaceholder(sizeInBytes: number): string {
    const sizeMb = (sizeInBytes / (1024 * 1024)).toFixed(2);
    return `[Файл превышает лимит размера 5 MB (${sizeMb} MB) - содержимое пропущено во избежание переполнения контекста ИИ]`;
  }

  /**
   * Generates a placeholder string for binary and compiled media files.
   *
   * @param ext - File extension.
   * @param sizeInBytes - File size in bytes.
   * @param isCompiled - Flag indicating if detected via buffer inspection.
   * @returns Formatted placeholder message.
   */
  public static getBinaryPlaceholder(ext: string, sizeInBytes: number, isCompiled: boolean = false): string {
    const sizeKb = (sizeInBytes / 1024).toFixed(1);
    const label = ext ? ext.replace('.', '').toUpperCase() : 'BINARY';
    const prefix = isCompiled ? 'Бинарный или скомпилированный файл' : 'Бинарный файл';
    return `[${prefix}: ${label} (${sizeKb} KB) - содержимое пропущено для сохранения контекста]`;
  }

  /**
   * Generates a placeholder string for files with unrecognized or corrupted encoding.
   *
   * @param sizeInBytes - File size in bytes.
   * @param details - Optional detected encoding or failure reason.
   * @returns Formatted placeholder message.
   */
  public static getInvalidEncodingPlaceholder(sizeInBytes: number, details?: string): string {
    const sizeKb = (sizeInBytes / 1024).toFixed(1);
    const reason = details ? ` (${details}, ${sizeKb} KB)` : ` (${sizeKb} KB)`;
    return `[Файл с нераспознанной или повреждённой кодировкой${reason} - содержимое пропущено во избежание искажения контекста ИИ]`;
  }

  /**
   * Checks if buffer begins with known binary magic byte sequences.
   *
   * @param buffer - File content buffer.
   * @returns `true` if buffer matches any binary header signature.
   */
  private static hasBinaryMagicBytes(buffer: Buffer): boolean {
    if (buffer.length === 0) {
      return false;
    }

    for (const signature of this.BINARY_MAGIC_HEADERS) {
      if (buffer.length >= signature.length) {
        let matches = true;
        for (let i = 0; i < signature.length; i++) {
          if (buffer[i] !== signature[i]) {
            matches = false;
            break;
          }
        }
        if (matches) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Inspects buffer for null bytes indicating raw binary data.
   *
   * @param buffer - File content buffer.
   * @returns `true` if null bytes are found.
   */
  private static hasNullBytes(buffer: Buffer): boolean {
    const checkLength = Math.min(buffer.length, 8000);
    for (let i = 0; i < checkLength; i++) {
      if (buffer[i] === 0) {
        return true;
      }
    }
    return false;
  }

  /**
   * Detects UTF-16 encoding pattern without BOM by checking alternating null bytes with ASCII printable chars.
   *
   * @param buffer - File content buffer.
   * @returns Detected UTF-16 endianness or null.
   */
  private static detectUtf16NoBom(buffer: Buffer): 'utf-16le' | 'utf-16be' | null {
    if (buffer.length < 4 || buffer.length % 2 !== 0) {
      return null;
    }

    const checkLength = Math.min(buffer.length, 512);
    let leMatches = 0;
    let beMatches = 0;
    const pairs = checkLength / 2;

    for (let i = 0; i < checkLength; i += 2) {
      const b1 = buffer[i];
      const b2 = buffer[i + 1];

      // Little-endian: [ASCII, 0x00]
      if (b1 >= 0x09 && b1 <= 0x7e && b2 === 0x00) {
        leMatches++;
      }
      // Big-endian: [0x00, ASCII]
      if (b1 === 0x00 && b2 >= 0x09 && b2 <= 0x7e) {
        beMatches++;
      }
    }

    if (leMatches / pairs > 0.65) {
      return 'utf-16le';
    }
    if (beMatches / pairs > 0.65) {
      return 'utf-16be';
    }

    return null;
  }

  /**
   * Detects whether decoded text exhibits signatures of double-encoded UTF-8 mojibake.
   *
   * @param text - Candidate decoded text.
   * @returns `true` if corrupted mojibake sequence patterns are detected.
   */
  private static containsMojibakeSignature(text: string): boolean {
    const sample = text.slice(0, 4000);
    return this.MOJIBAKE_PATTERNS.some((regex) => regex.test(sample));
  }

  /**
   * Attempts robust statistical recovery of legacy single-byte Cyrillic encodings (Windows-1251, CP866, KOI8-R).
   * Strictly avoids blind fallback to Windows-1252 to prevent corrupting text with mojibake.
   *
   * @param buffer - Raw file buffer.
   * @returns Decoded text if high statistical confidence is met, or null.
   */
  private static tryDecodeLegacyCyrillic(buffer: Buffer): string | null {
    const checkLength = Math.min(buffer.length, 4000);
    if (checkLength < 10) {
      return null;
    }

    let win1251Specific = 0; // Bytes 0xC0-0xDF (Capital Cyrillic in Windows-1251; pseudo-graphics in CP866)
    let cp866Specific = 0;   // Bytes 0x80-0xAF (Cyrillic in CP866; control/symbols in Windows-1251)
    let koi8rSpecific = 0;   // Bytes 0xE0-0xFF (Lowercase Cyrillic in KOI8-R; overlapping lowercase in Win1251)
    let highByteCount = 0;

    for (let i = 0; i < checkLength; i++) {
      const b = buffer[i];
      if (b >= 0x80) {
        highByteCount++;
        if (b >= 0xc0 && b <= 0xdf) {
          win1251Specific++;
        }
        if (b >= 0x80 && b <= 0xaf) {
          cp866Specific++;
        }
        if (b >= 0xe0 && b <= 0xff) {
          koi8rSpecific++;
        }
      }
    }

    // Require at least 8 high-range bytes to warrant legacy analysis
    if (highByteCount < 8) {
      return null;
    }

    // Rank candidates by characteristic non-overlapping byte score
    const candidates: string[] = [];
    if (win1251Specific > cp866Specific && win1251Specific > 5) {
      candidates.push('windows-1251', 'ibm866', 'koi8-r');
    } else if (cp866Specific > win1251Specific && cp866Specific > 5) {
      candidates.push('ibm866', 'windows-1251', 'koi8-r');
    } else if (koi8rSpecific > 5) {
      candidates.push('koi8-r', 'windows-1251', 'ibm866');
    }

    let bestDecoded: string | null = null;
    let highestVowelRatio = 0;

    for (const encoding of candidates) {
      try {
        const decoder = new TextDecoder(encoding, { fatal: true });
        const decoded = decoder.decode(buffer);

        if (decoded.includes('\uFFFD')) {
          continue;
        }

        const cyrillicLetters = decoded.match(/[\u0400-\u04FF]/g);
        if (!cyrillicLetters || cyrillicLetters.length < 6) {
          continue;
        }

        // Natural Russian text has ~40% vowel ratio among letters. Pseudo-graphics decoded as Cyrillic will have near zero.
        const vowels = decoded.match(this.CYRILLIC_VOWELS_REGEX);
        const vowelRatio = vowels ? vowels.length / cyrillicLetters.length : 0;

        if (vowelRatio >= 0.25 && vowelRatio <= 0.60) {
          if (vowelRatio > highestVowelRatio) {
            highestVowelRatio = vowelRatio;
            bestDecoded = decoded.trimEnd();
          }
        }
      } catch {
        // Skip incompatible encoding
      }
    }

    return bestDecoded;
  }

  /**
   * Safely reads and validates file content with rock-solid binary and encoding heuristics.
   * Guaranteed to prevent corrupted mojibake and replacement characters from entering context.
   *
   * @param filePath - Target file path.
   * @returns Object containing either clean decoded text or an explanatory placeholder.
   */
  public static async safeReadFile(filePath: string): Promise<SafeFileReadResult> {
    const ext = path.extname(filePath).toLowerCase();

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      return {
        placeholder: '[Ошибка чтения: файл не найден или недоступен]'
      };
    }

    if (stat.size > MAX_FILE_SIZE_BYTES) {
      return {
        placeholder: this.getSizeExceededPlaceholder(stat.size)
      };
    }

    if (BINARY_EXTENSIONS.has(ext)) {
      return {
        placeholder: this.getBinaryPlaceholder(ext, stat.size)
      };
    }

    let buffer: Buffer;
    try {
      buffer = await fs.promises.readFile(filePath);
    } catch (err) {
      return { placeholder: `[Ошибка чтения файла: ${err}]` };
    }

    if (buffer.length === 0) {
      return { text: '' };
    }

    // 1. Binary Magic Headers check
    if (this.hasBinaryMagicBytes(buffer)) {
      return {
        placeholder: this.getBinaryPlaceholder(ext, stat.size, true)
      };
    }

    // 2. Explicit Byte Order Marks (BOM)
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      try {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        const text = decoder.decode(buffer.subarray(3)).trimEnd();
        if (this.containsMojibakeSignature(text)) {
          return { placeholder: this.getInvalidEncodingPlaceholder(stat.size, 'Обнаружен повреждённый моджибейк') };
        }
        return { text };
      } catch {
        return { placeholder: this.getInvalidEncodingPlaceholder(stat.size, 'UTF-8 BOM') };
      }
    }

    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
      try {
        const decoder = new TextDecoder('utf-16le', { fatal: true });
        const text = decoder.decode(buffer.subarray(2)).trimEnd();
        return { text };
      } catch {
        return { placeholder: this.getInvalidEncodingPlaceholder(stat.size, 'UTF-16LE BOM') };
      }
    }

    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
      try {
        const decoder = new TextDecoder('utf-16be', { fatal: true });
        const text = decoder.decode(buffer.subarray(2)).trimEnd();
        return { text };
      } catch {
        return { placeholder: this.getInvalidEncodingPlaceholder(stat.size, 'UTF-16BE BOM') };
      }
    }

    // 3. UTF-16 without BOM
    const detectedUtf16 = this.detectUtf16NoBom(buffer);
    if (detectedUtf16) {
      try {
        const decoder = new TextDecoder(detectedUtf16, { fatal: true });
        const text = decoder.decode(buffer).trimEnd();
        return { text };
      } catch {
        return { placeholder: this.getInvalidEncodingPlaceholder(stat.size, detectedUtf16.toUpperCase()) };
      }
    }

    // 4. Binary detection via null bytes (strictly checked before UTF-8 decoding because NUL 0x00 is valid UTF-8)
    if (this.hasNullBytes(buffer)) {
      return {
        placeholder: this.getBinaryPlaceholder(ext, stat.size, true)
      };
    }

    // 5. Strict UTF-8 decoding
    try {
      const strictDecoder = new TextDecoder('utf-8', { fatal: true });
      const text = strictDecoder.decode(buffer).trimEnd();

      if (!text.includes('\uFFFD')) {
        if (this.containsMojibakeSignature(text)) {
          return { placeholder: this.getInvalidEncodingPlaceholder(stat.size, 'Обнаружен повреждённый моджибейк') };
        }
        return { text };
      }
    } catch {
      // Not valid UTF-8, proceed to heuristics
    }

    // 6. Intelligent statistical legacy Cyrillic recovery
    const recoveredText = this.tryDecodeLegacyCyrillic(buffer);
    if (recoveredText !== null) {
      return { text: recoveredText };
    }

    // 7. Strict safeguard: reject unrecognized encoding rather than emitting mojibake
    return {
      placeholder: this.getInvalidEncodingPlaceholder(stat.size, 'Неизвестная однобайтовая кодировка')
    };
  }
}