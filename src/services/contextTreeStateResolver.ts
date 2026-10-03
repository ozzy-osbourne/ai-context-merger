import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
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
   * Computes the number of currently selected physical files inside target directory.
   * Strictly filters out deleted Git files so that UI tree folder counters never reflect deleted items.
   *
   * @param folderPath - Absolute directory path.
   * @param selectedFiles - Active selection set.
   * @param gitStatuses - Optional map containing current Git file statuses.
   * @returns Number of selected physical files contained within directory subtree.
   */
  public static getSelectedCountInFolder(
    folderPath: string,
    selectedFiles: Set<string>,
    gitStatuses?: Map<string, GitFileStatus>
  ): number {
    const normFolder = PathUtils.normalizePath(folderPath);
    let count = 0;
    for (const file of selectedFiles) {
      // Under no circumstances count deleted files in UI folder descriptions
      if (gitStatuses && gitStatuses.get(file) === 'deleted') {
        continue;
      }
      if (PathUtils.isSubpath(file, normFolder)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Gets or calculates the total selectable file count in target directory with concurrent request deduplication.
   * Counts strictly physical selectable files on disk.
   *
   * @param folderPath - Absolute directory path.
   * @param filters - Active exclusion filters.
   * @param countMap - Cache map storing counts per normalized folder path.
   * @param pendingPromises - Cache map storing in-flight calculation promises.
   * @returns Total selectable physical file count.
   */
  public static async getFolderTotalCount(
    folderPath: string,
    filters: FilterSettings,
    countMap: Map<string, number>,
    pendingPromises: Map<string, Promise<number>>
  ): Promise<number> {
    const norm = PathUtils.normalizePath(folderPath);
    if (countMap.has(norm)) {
      return countMap.get(norm)!;
    }

    if (pendingPromises.has(norm)) {
      return await pendingPromises.get(norm)!;
    }

    const countPromise = (async () => {
      const total = await WorkspaceScanner.countSelectableFiles(norm, filters, countMap);
      countMap.set(norm, total);
      return total;
    })().finally(() => {
      pendingPromises.delete(norm);
    });

    pendingPromises.set(norm, countPromise);
    return await countPromise;
  }

  /**
   * Resolves the checkbox state, disabled status, and formatted description label for a directory node in the UI.
   * Guaranteed to represent physical files only, preventing deleted files from leaking into UI badges.
   *
   * @param folderPath - Absolute directory path.
   * @param selectedFiles - Active selection set.
   * @param filters - Active exclusion filters.
   * @param countMap - Cache map storing counts per normalized folder path.
   * @param pendingPromises - Cache map storing in-flight calculation promises.
   * @param gitStatuses - Optional map containing current Git file statuses.
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
    const totalCount = await this.getFolderTotalCount(folderPath, filters, countMap, pendingPromises);
    const rootPath = PathUtils.getWorkspaceRoot(folderPath);
    const t = I18nService.getTranslations();

    if (totalCount === 0) {
      let isPhysicallyEmpty = false;
      try {
        const rawEntries = await fs.promises.readdir(folderPath, { withFileTypes: true });
        const visibleEntries = rawEntries.filter((e) =>
          !WorkspaceScanner.isIgnoredByPathSegments(path.join(folderPath, e.name), rootPath) &&
          !e.isSymbolicLink()
        );

        if (visibleEntries.length === 0) {
          isPhysicallyEmpty = true;
        } else {
          const hasFiles = visibleEntries.some((e) => !e.isDirectory());
          if (!hasFiles) {
            isPhysicallyEmpty = true;
            for (const dirEntry of visibleEntries) {
              const subPath = path.join(folderPath, dirEntry.name);
              const subCount = await this.getFolderTotalCount(subPath, filters, countMap, pendingPromises);
              if (subCount > 0) {
                isPhysicallyEmpty = false;
                break;
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

    const selectedCount = this.getSelectedCountInFolder(folderPath, selectedFiles, gitStatuses);
    if (selectedCount === 0) {
      return { isChecked: false, description: undefined, isDisabled: false };
    }

    const isAllSelected = selectedCount >= totalCount;
    const pluralText = this.formatFilePlural(selectedCount);
    const description = `${selectedCount}/${totalCount} (${pluralText})`;

    return { isChecked: isAllSelected, description, isDisabled: false };
  }
}