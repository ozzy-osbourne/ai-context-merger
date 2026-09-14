import { GitFileStatus } from '../types';

interface AsciiTreeNode {
  name: string;
  isDirectory: boolean;
  status?: string;
  children: Map<string, AsciiTreeNode>;
}

/**
 * Service responsible for building and rendering hierarchical ASCII project tree representations.
 */
export class AsciiTreeService {
  /**
   * Builds the internal tree node hierarchy from a list of relative paths and statuses.
   *
   * @param items - Array of items containing relative path and optional Git status.
   * @returns Root ASCII tree node.
   */
  private static buildAsciiTreeHierarchy(
    items: Array<{ relativePath: string; status?: string }>
  ): AsciiTreeNode {
    const root: AsciiTreeNode = {
      name: '',
      isDirectory: true,
      children: new Map()
    };

    for (const item of items) {
      const segments = item.relativePath.split('/').filter(Boolean);
      let currentNode = root;

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const isDirectory = i < segments.length - 1;

        if (!currentNode.children.has(segment)) {
          currentNode.children.set(segment, {
            name: segment,
            isDirectory,
            status: !isDirectory ? item.status : undefined,
            children: new Map()
          });
        }
        currentNode = currentNode.children.get(segment)!;
      }
    }

    return root;
  }

  /**
   * Recursively renders ASCII branch lines for a hierarchy node including Git markers.
   *
   * @param node - Current tree node.
   * @param prefix - Current line prefix indentation.
   * @returns Array of formatted ASCII lines.
   */
  private static renderAsciiTreeLines(node: AsciiTreeNode, prefix: string = ''): string[] {
    const lines: string[] = [];
    const entries = Array.from(node.children.values()).sort((a, b) => {
      if (a.isDirectory === b.isDirectory) {
        return a.name.localeCompare(b.name);
      }
      return a.isDirectory ? -1 : 1;
    });

    for (let i = 0; i < entries.length; i++) {
      const child = entries[i];
      const isLast = i === entries.length - 1;
      const branchSymbol = isLast ? '└── ' : '├── ';
      const nextPrefix = prefix + (isLast ? '    ' : '│   ');

      const badge = child.status ? ` [${child.status}]` : '';
      const displayName = child.isDirectory ? `${child.name}/` : `${child.name}${badge}`;
      lines.push(`${prefix}${branchSymbol}${displayName}`);

      if (child.isDirectory && child.children.size > 0) {
        lines.push(...this.renderAsciiTreeLines(child, nextPrefix));
      }
    }

    return lines;
  }

  /**
   * Generates a plain-text ASCII representation of the project hierarchy with optional Git decorations.
   *
   * @param relativePaths - Array of POSIX-formatted relative file paths.
   * @param statusMap - Optional map of file paths to Git statuses.
   * @param absolutePaths - Optional array of corresponding absolute paths for status resolution.
   * @returns Formatted ASCII tree string.
   */
  public static generateAsciiTree(
    relativePaths: string[],
    statusMap?: Map<string, GitFileStatus>,
    absolutePaths?: string[]
  ): string {
    const items = relativePaths.map((relPath, index) => {
      const absPath = absolutePaths ? absolutePaths[index] : undefined;
      let statusBadge: string | undefined;

      if (absPath && statusMap) {
        const status = statusMap.get(absPath);
        if (status === 'modified') {
          statusBadge = 'M';
        } else if (status === 'untracked') {
          statusBadge = 'U';
        } else if (status === 'deleted') {
          statusBadge = 'D';
        } else if (status === 'renamed') {
          statusBadge = 'R';
        }
      }

      return { relativePath: relPath, status: statusBadge };
    });

    const rootNode = this.buildAsciiTreeHierarchy(items);
    const lines = this.renderAsciiTreeLines(rootNode);
    return `Project Structure:\n${lines.join('\n')}`;
  }
}