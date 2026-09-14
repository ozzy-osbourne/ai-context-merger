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
    return unsafe.replace(/[<>&'"]/g, (c) => {
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
   * Removes control characters that are strictly illegal in XML 1.0 documents.
   *
   * @param text - Raw input string.
   * @returns Sanitized string safe for XML parsing.
   */
  public static sanitizeXmlChars(text: string): string {
    return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }
}