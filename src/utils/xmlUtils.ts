/**
 * Utility functions for XML sanitization and character escaping.
 */
export class XmlUtils {
  /**
   * Safely escapes string content for inclusion inside an XML CDATA block by splitting any closing tokens.
   *
   * @param content - Raw text content.
   * @returns Escaped text safe for CDATA wrapping.
   */
  public static escapeCdata(content: string): string {
    return content.replace(/\]\]>/g, ']]]]><![CDATA[>');
  }

  /**
   * Escapes reserved XML characters in attribute and element text contents.
   *
   * @param unsafe - Raw text string.
   * @returns XML-safe escaped string.
   */
  public static escapeXml(unsafe: string): string {
    const sanitized = this.sanitizeXmlChars(unsafe);
    return sanitized.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });
  }

  /**
   * Removes control characters and unpaired Unicode surrogates strictly illegal in XML 1.0 documents.
   * Conforms to W3C XML 1.0 (Fifth Edition) valid character specification:
   * #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]
   *
   * @param text - Raw input string.
   * @returns Sanitized string safe for standard XML parsers.
   */
  public static sanitizeXmlChars(text: string): string {
    if (!text) {
      return '';
    }

    // Strip illegal XML 1.0 control characters and noncharacters (0xFFFE, 0xFFFF)
    let cleaned = text.replace(
      /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]/g,
      ''
    );

    // Remove isolated / unpaired high and low Unicode surrogates
    cleaned = cleaned.replace(
      /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF]))|(?:[^\uD800-\uDBFF]|^)([\uDC00-\uDFFF])/g,
      (match, isolatedLow) => (isolatedLow ? match.slice(1) : '')
    );

    return cleaned;
  }
}