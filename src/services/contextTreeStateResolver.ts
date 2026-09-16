import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getIgnoredDirectoriesSet } from '../constants';
import { FilterSettings, GitFileStatus } from '../types';
import { WorkspaceScanner } from './workspaceScanner';
import { PathUtils } from '../utils/pathUtils';
import { I18nService } from '../i18n';

/**
 * Resolved folder presentation metadata.
 */
export interface ResolvedFolderPresentation {
  readonly isChecked: boolean | undefined;
  readonly description?: string;
  readonly isDisabled: boolean;
}

/**
 * Service dedicated to resolving directory states, selection ratios, and depths for TreeView items.
 */
export class ContextTreeStateResolver {
  /**
   * Formats file quantity using native Intl.PluralRules localization.
   *
   * @param count - Total number of selected files.
   * @returns Formatted localized label string.
   */
  public static formatFilePlural(count: number): string {
    return I18nService.formatSelectedFilePlural(count);
  }

  /**
   * Computes the depth of a folder relative to its workspace root.
   *
   * @param folderPath - Absolute folder path.
   * @returns Relative folder depth.
   */
  public static getFolderDepth(folderPath: string): number {
    const norm = PathUtils.normalizePath(folderPath);
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return 0;
    }

    for (const wf of workspaceFolders) {
      const root = PathUtils.normalizePath(wf.uri.fsPath);
      if (norm === root) {
        return 0;
      }
      if (PathUtils.isSubpath(norm, root)) {
        const rel = path.relative(root, norm);
        return rel.split(path.sep).length;
      }
    }
    return 0;
  }

  /**
   * Computes the number of currently selected files located inside target directory in memory.
   *
   * @param folderPath - Absolute directory path.
   * @param selectedFiles - Active selection set.
   * @returns Number of selected files contained within directory subtree.
   */
  public static getSelectedCountInFolder(folderPath: string, selectedFiles: Set<string>): number {
    const normFolder = PathUtils.normalizePath(folderPath);
    let count = 0;
    for (const file of selectedFiles) {
      if (PathUtils.isSubpath(file, normFolder)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Gets or calculates the total selectable file count in target directory with concurrent request deduplication.
   *
   * @param folderPath - Absolute directory path.
   * @param filters - Active exclusion filters.
   * @param countMap - Cache map storing counts per normalized folder path.
   * @param pendingPromises - Cache map storing in-flight calculation promises.
   * @param gitStatuses - Optional map of current Git file statuses.
   * @returns Total selectable file count.
   */
  public static async getFolderTotalCount(
    folderPath: string,
    filters: FilterSettings,
    countMap: Map<string, number>,
    pendingPromises: Map<string, Promise<number>>,
    gitStatuses?: Map<string, GitFileStatus>
  ): Promise<number> {
    const norm = PathUtils.normalizePath(folderPath);
    if (countMap.has(norm)) {
      return countMap.get(norm)!;
    }

    if (pendingPromises.has(norm)) {
      return await pendingPromises.get(norm)!;
    }

    const countPromise = (async () => {
      const diskCount = await WorkspaceScanner.countSelectableFiles(norm, filters, countMap);
      let deletedGitCount = 0;

      if (gitStatuses) {
        for (const [gitPath, status] of gitStatuses.entries()) {
          if (status === 'deleted' && PathUtils.isSubpath(gitPath, norm)) {
            const fileName = path.basename(gitPath);
            if (!WorkspaceScanner.isFilteredByType(fileName, false, filters)) {
              deletedGitCount++;
            }
          }
        }
      }

      const total = diskCount + deletedGitCount;
      countMap.set(norm, total);
      return total;
    })().finally(() => {
      pendingPromises.delete(norm);
    });

    pendingPromises.set(norm, countPromise);
    return await countPromise;
  }

  /**
   * Resolves the checkbox state, disabled status, and formatted description label for a directory node.
   *
   * @param folderPath - Absolute directory path.
   * @param selectedFiles - Active selection set.
   * @param filters - Active exclusion filters.
   * @param countMap - Cache map storing counts per normalized folder path.
   * @param pendingPromises - Cache map storing in-flight calculation promises.
   * @param gitStatuses - Optional map of current Git file statuses.
   * @returns Resolved selection state, disabled flag, and optional description.
   */
  public static async resolveFolderState(
    folderPath: string,
    selectedFiles: Set<string>,
    filters: FilterSettings,
    countMap: Map<string, number>,
    pendingPromises: Map<string, Promise<number>>,
    gitStatuses?: Map<string, GitFileStatus>
  ): Promise<ResolvedFolderPresentation> {
    const totalCount = await this.getFolderTotalCount(folderPath, filters, countMap, pendingPromises, gitStatuses);
    const ignoredSet = getIgnoredDirectoriesSet();
    const t = I18nService.getTranslations();

    if (totalCount === 0) {
      let isPhysicallyEmpty = false;
      try {
        const rawEntries = await fs.promises.readdir(folderPath, { withFileTypes: true });
        const visibleEntries = rawEntries.filter((e) => !ignoredSet.has(e.name) && !e.isSymbolicLink());

        if (visibleEntries.length === 0) {
          isPhysicallyEmpty = true;
        } else {
          const hasFiles = visibleEntries.some((e) => !e.isDirectory());
          if (!hasFiles) {
            isPhysicallyEmpty = true;
            for (const dirEntry of visibleEntries) {
              const subPath = path.join(folderPath, dirEntry.name);
              const subCount = await this.getFolderTotalCount(subPath, filters, countMap, pendingPromises, gitStatuses);
              if (subCount > 0) {
                isPhysicallyEmpty = false;
                break;
              }
              try {
                const subRaw = await fs.promises.readdir(subPath);
                if (subRaw.some((name) => !ignoredSet.has(name))) {
                  isPhysicallyEmpty = false;
                  break;
                }
              } catch {
                // Ignore subfolder read failure
              }
            }
          }
        }
      } catch {
        isPhysicallyEmpty = true;
      }

      return {
        isChecked: undefined,
        description: isPhysicallyEmpty ? t.tree.folderEmpty : t.tree.folderFiltered,
        isDisabled: true
      };
    }

    const selectedCount = this.getSelectedCountInFolder(folderPath, selectedFiles);
    if (selectedCount === 0) {
      return { isChecked: false, description: undefined, isDisabled: false };
    }

    const isAllSelected = selectedCount >= totalCount;
    const pluralText = this.formatFilePlural(selectedCount);
    const description = `${selectedCount}/${totalCount} (${pluralText})`;

    return { isChecked: isAllSelected, description, isDisabled: false };
  }
}