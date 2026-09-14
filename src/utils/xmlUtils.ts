/**
 * Utility functions for XML sanitization, surrogate validation, and CDATA escaping.
 * Ensures generated XML conforms strictly to the W3C XML 1.0 (Fifth Edition) specification.
 */
export class XmlUtils {
  /**
   * Safely escapes string content for inclusion inside an XML CDATA block.
   * In XML, a CDATA block cannot contain the sequence "]]>". If encountered,
   * it splits the closing sequence into "]]]]><![CDATA[>", which an XML parser
   * reassembles back into "]]>" without breaking the document structure.
   *
   * @param content - Raw text content to be placed inside CDATA.
   * @returns Escaped text safe for CDATA wrapping.
   */
  public static escapeCdata(content: string): string {
    return content.replace(/\]\]>/g, ']]]]><![CDATA[>');
  }

  /**
   * Escapes reserved XML characters (&, <, >, ', ") in attribute and element text contents.
   * First sanitizes illegal control characters and lone surrogates, then escapes XML entities.
   *
   * @param unsafe - Raw text string that may contain XML special characters.
   * @returns Sanitized and XML-safe escaped string.
   */
  public static escapeXml(unsafe: string): string {
    const sanitized = this.sanitizeXmlChars(unsafe);
    return sanitized.replace(/[<>&'"]/g, (char) => {
      switch (char) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        default: return char;
      }
    });
  }

  /**
   * Removes control characters and unpaired Unicode surrogates strictly illegal in XML 1.0 documents.
   *
   * XML 1.0 valid character specification:
   * #x9 (tab) | #xA (newline) | #xD (carriage return) | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]
   *
   * Surrogate Handling:
   * - High surrogates: 0xD800 to 0xDBFF
   * - Low surrogates: 0xDC00 to 0xDFFF
   * - Uses negative lookahead and lookbehind to strip lone (unpaired) surrogates
   *   while leaving valid surrogate pairs (emoji, CJK extension, etc.) completely intact.
   *
   * @param text - Raw input string to clean.
   * @returns Cleaned string conforming to XML 1.0 character rules.
   */
  public static sanitizeXmlChars(text: string): string {
    if (!text) {
      return '';
    }

    // Step 1: Strip lone high surrogates not followed by low surrogates,
    // and lone low surrogates not preceded by high surrogates.
    const cleanedSurrogates = text.replace(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
      ''
    );

    // Step 2: Strip non-printable ASCII control characters (except \t, \n, \r)
    // and Unicode non-characters (0xFFFE, 0xFFFF).
    return cleanedSurrogates.replace(
      /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]/g,
      ''
    );
  }
}