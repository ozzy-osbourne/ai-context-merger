/**
 * Utility functions for safely extracting human-readable error messages.
 */
export class ErrorUtils {
  /**
   * Safely extracts a readable message string from an unknown caught error.
   *
   * @param err - Unknown caught error.
   * @returns String error representation.
   */
  public static extractErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}