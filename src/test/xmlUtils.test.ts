import * as assert from 'assert';
import { XmlUtils } from '../utils/xmlUtils';

/**
 * Test suite verifying XML character sanitization, Unicode surrogate validation,
 * entity escaping, and CDATA injection prevention according to W3C XML 1.0.
 */
suite('XmlUtils: Sanitization, Escaping & CDATA Security Tests', () => {

  // =========================================================================
  // 1. CDATA Escaping Tests
  // =========================================================================
  suite('escapeCdata', () => {
    test('Leaves clean content without CDATA closers unchanged', () => {
      const input = 'const x = [1, 2, 3]; if (x.length > 0) return true;';
      assert.strictEqual(XmlUtils.escapeCdata(input), input);
    });

    test('Splits single CDATA closing sequence ]]> into safe split syntax', () => {
      const dangerous = 'payload with ]]> closing token';
      const expected = 'payload with ]]]]><![CDATA[> closing token';
      assert.strictEqual(XmlUtils.escapeCdata(dangerous), expected);
    });

    test('Splits multiple occurrences of ]]> across payload', () => {
      const dangerous = 'block1 ]]> block2 ]]> block3';
      const expected = 'block1 ]]]]><![CDATA[> block2 ]]]]><![CDATA[> block3';
      assert.strictEqual(XmlUtils.escapeCdata(dangerous), expected);
    });

    test('Handles empty string safely', () => {
      assert.strictEqual(XmlUtils.escapeCdata(''), '');
    });
  });

  // =========================================================================
  // 2. XML Entity Escaping Tests
  // =========================================================================
  suite('escapeXml', () => {
    test('Escapes all five predefined XML entities (&, <, >, ", \')', () => {
      const raw = `Tom & Jerry said: <"It's true">`;
      const expected = 'Tom &amp; Jerry said: &lt;&quot;It&apos;s true&quot;&gt;';
      assert.strictEqual(XmlUtils.escapeXml(raw), expected);
    });

    test('Preserves plain strings without XML sensitive characters', () => {
      const clean = 'Simple string with numbers 12345 and punctuation.';
      assert.strictEqual(XmlUtils.escapeXml(clean), clean);
    });

    test('Sanitizes illegal control characters before escaping entities', () => {
      const dirty = 'Error: <\x00tag>\x08 & "test"';
      // \x00 and \x08 must be stripped, while <, >, &, " must be escaped
      const expected = 'Error: &lt;tag&gt; &amp; &quot;test&quot;';
      assert.strictEqual(XmlUtils.escapeXml(dirty), expected);
    });

    test('Returns empty string when input is empty', () => {
      assert.strictEqual(XmlUtils.escapeXml(''), '');
    });
  });

  // =========================================================================
  // 3. XML 1.0 Character Sanitization Tests
  // =========================================================================
  suite('sanitizeXmlChars', () => {
    test('Preserves valid whitespace (tabs, newlines, carriage returns)', () => {
      const validText = 'Line 1\r\n\tLine 2 with tab\nLine 3';
      assert.strictEqual(XmlUtils.sanitizeXmlChars(validText), validText);
    });

    test('Strips non-printable ASCII control characters prohibited in XML 1.0', () => {
      // 0x00 (NUL), 0x07 (BEL), 0x08 (BS), 0x0B (VT), 0x0C (FF), 0x1B (ESC)
      const input = 'A\x00B\x07C\x08D\x0BE\x0CF\x1BG';
      assert.strictEqual(XmlUtils.sanitizeXmlChars(input), 'ABCDEFG');
    });

    test('Strips XML non-characters U+FFFE and U+FFFF', () => {
      const input = 'Valid\uFFFEText\uFFFFEnd';
      assert.strictEqual(XmlUtils.sanitizeXmlChars(input), 'ValidTextEnd');
    });

    test('Preserves valid surrogate pairs (Emoji, extended CJK, math symbols)', () => {
      // 🚀 = \uD83D\uDE80, 💻 = \uD83D\uDCBB, ✨ = \u2728
      const emojiString = 'AI Context 🚀 Merger 💻 ✨';
      assert.strictEqual(XmlUtils.sanitizeXmlChars(emojiString), emojiString);
    });

    test('Strips lone high surrogates not followed by a low surrogate', () => {
      // \uD83D without paired low surrogate
      const corrupted = 'Broken \uD83D high surrogate';
      assert.strictEqual(XmlUtils.sanitizeXmlChars(corrupted), 'Broken  high surrogate');
    });

    test('Strips lone low surrogates not preceded by a high surrogate', () => {
      // \uDE80 without paired high surrogate
      const corrupted = 'Broken \uDE80 low surrogate';
      assert.strictEqual(XmlUtils.sanitizeXmlChars(corrupted), 'Broken  low surrogate');
    });

    test('Handles consecutive mixed valid pairs and lone surrogates', () => {
      const mixed = '\uD83D\uDE80\uD800Clean\uDC00Code\uD83D\uDCBB';
      // \uD83D\uDE80 (🚀) and \uD83D\uDCBB (💻) remain intact, lone \uD800 and \uDC00 are removed
      assert.strictEqual(XmlUtils.sanitizeXmlChars(mixed), '🚀CleanCode💻');
    });

    test('Handles falsy and empty inputs safely', () => {
      assert.strictEqual(XmlUtils.sanitizeXmlChars(''), '');
    });
  });
});