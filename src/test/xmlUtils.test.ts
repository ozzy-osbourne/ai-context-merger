import * as assert from 'assert';
import { XmlUtils } from '../utils/xmlUtils';

/**
 * Test suite for XML escaping, sanitization, and CDATA injection prevention.
 */
suite('XmlUtils: CDATA Escaping & XML 1.0 Sanitization Tests', () => {
  test('Splits "]]>" properly to prevent XML payload injection', () => {
    const input = '<script>]]><nested>data</nested></script>';
    const escaped = XmlUtils.escapeCdata(input);

    assert.strictEqual(escaped, '<script>]]]]><![CDATA[><nested>data</nested></script>');
    assert.strictEqual(escaped.includes(']]]]><![CDATA[>'), true);
  });

  test('Escapes standard XML entities in attributes and plain text', () => {
    const raw = `<query name="user" desc='A & B'>10 > 5</query>`;
    const escaped = XmlUtils.escapeXml(raw);

    assert.strictEqual(escaped.includes('<query'), false);
    assert.strictEqual(escaped.includes('&lt;query'), true);
    assert.strictEqual(escaped.includes('&amp;'), true);
    assert.strictEqual(escaped.includes('&quot;'), true);
    assert.strictEqual(escaped.includes('&apos;'), true);
    assert.strictEqual(escaped.includes('&gt;'), true);
  });

  test('Strips illegal XML 1.0 control characters while preserving whitespace', () => {
    const input = "Valid text\t\r\n\x00\x08\x0B\x0C\x1F.";
    const sanitized = XmlUtils.sanitizeXmlChars(input);

    assert.strictEqual(sanitized, "Valid text\t\r\n.");
  });

  test('Preserves valid emoji surrogate pairs and multi-byte UTF-8 sequences', () => {
    const textWithEmoji = 'Тест 🤖 контекста и эмодзи ✨';
    assert.strictEqual(XmlUtils.sanitizeXmlChars(textWithEmoji), textWithEmoji);
  });
});