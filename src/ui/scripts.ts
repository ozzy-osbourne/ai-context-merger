import { PROMPT_PRESETS } from '../constants/presets';

/**
 * Generates the client-side JavaScript for the sidebar Webview.
 *
 * @returns Client JavaScript code string.
 */
export function getScripts(): string {
  const presetsJson = JSON.stringify(PROMPT_PRESETS);

  return `
        const vscode = acquireVsCodeApi();
        const PRESET_TEXTS = ${presetsJson};

        const previousState = vscode.getState() || {};
        let rawTreeData = [];
        let selectedFilesSet = new Set();
        let expandedFoldersSet = new Set(previousState.expandedFolders || []);
        let hasInitializedTree = previousState.hasInitializedTree || false;

        const promptToggle = document.getElementById('promptToggle');
        const promptBody = document.getElementById('promptBody');
        const promptInput = document.getElementById('promptInput');
        const btnClearPrompt = document.getElementById('btnClearPrompt');

        promptToggle.checked = Boolean(previousState.promptEnabled);
        promptInput.value = previousState.promptText || '';
        if (promptToggle.checked) {
            promptBody.classList.remove('hidden');
        }
        updateClearPromptButtonVisibility();

        function saveState() {
            vscode.setState({
                expandedFolders: Array.from(expandedFoldersSet),
                hasInitializedTree: true,
                promptEnabled: promptToggle.checked,
                promptText: promptInput.value
            });
        }

        function updateClearPromptButtonVisibility() {
            const hasText = promptInput.value.trim().length > 0;
            if (promptToggle.checked && hasText) {
                btnClearPrompt.classList.remove('hidden');
            } else {
                btnClearPrompt.classList.add('hidden');
            }
        }

        function syncPromptWithExtension() {
            updateClearPromptButtonVisibility();
            saveState();
            vscode.postMessage({
                type: 'updatePrompt',
                enabled: promptToggle.checked,
                text: promptInput.value
            });
        }

        promptToggle.addEventListener('change', () => {
            if (promptToggle.checked) {
                promptBody.classList.remove('hidden');
            } else {
                promptBody.classList.add('hidden');
            }
            syncPromptWithExtension();
        });

        promptInput.addEventListener('input', () => {
            syncPromptWithExtension();
        });

        btnClearPrompt.addEventListener('click', (e) => {
            e.stopPropagation();
            promptInput.value = '';
            promptInput.focus();
            syncPromptWithExtension();
        });

        document.querySelectorAll('.preset-chip').forEach(chip => {
            chip.addEventListener('click', (e) => {
                e.stopPropagation();
                const key = chip.getAttribute('data-preset');
                if (PRESET_TEXTS[key]) {
                    promptInput.value = PRESET_TEXTS[key];
                    syncPromptWithExtension();
                }
            });
        });

        window.addEventListener('message', event => {
            const message = event.data;
            if (!message || typeof message.type !== 'string') return;

            if (message.type === 'setData') {
                rawTreeData = Array.isArray(message.tree) ? message.tree : [];
                selectedFilesSet = new Set(Array.isArray(message.selectedFiles) ? message.selectedFiles : []);
                if (message.stats) updateStatsUI(message.stats);
                
                if (message.filters) {
                    document.getElementById('filterGit').checked = Boolean(message.filters.hideGitIgnored);
                    document.getElementById('filterLock').checked = Boolean(message.filters.hideLockFiles);
                    document.getElementById('filterBinary').checked = Boolean(message.filters.hideBinaryFiles);
                }

                if (message.smartGitExpand) {
                    expandedFoldersSet.clear();
                    applySmartGitExpansion(rawTreeData);
                    saveState();
                } else if (!hasInitializedTree) {
                    expandedFoldersSet.clear();
                    applyFirstLevelExpansion(rawTreeData);
                    hasInitializedTree = true;
                    saveState();
                }
                
                renderTree(rawTreeData, document.getElementById('treeView'));
                
                const searchQuery = document.getElementById('searchInput').value.trim();
                if (searchQuery) {
                    applySearchFilter(searchQuery);
                }
            } else if (message.type === 'updateStats') {
                selectedFilesSet = new Set(Array.isArray(message.selectedFiles) ? message.selectedFiles : []);
                if (message.stats) updateStatsUI(message.stats);
                syncTreeCheckboxesWithSet(document.getElementById('treeView'), selectedFilesSet);
                syncFolderCheckboxes(document.getElementById('treeView'));
            }
        });

        document.getElementById('btnCopy').addEventListener('click', () => vscode.postMessage({ type: 'copyContext' }));
        document.getElementById('btnPreview').addEventListener('click', () => vscode.postMessage({ type: 'previewContext' }));
        document.getElementById('btnExport').addEventListener('click', () => vscode.postMessage({ type: 'exportFile' }));
        document.getElementById('btnClear').addEventListener('click', () => {
            selectedFilesSet.clear();
            syncTreeCheckboxesWithSet(document.getElementById('treeView'), selectedFilesSet);
            syncFolderCheckboxes(document.getElementById('treeView'));
            vscode.postMessage({ type: 'clearSelection' });
        });
        document.getElementById('btnRefresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
        document.getElementById('btnGit').addEventListener('click', () => vscode.postMessage({ type: 'selectModified' }));
        
        document.getElementById('btnSelectAll').addEventListener('click', () => {
            const searchQuery = document.getElementById('searchInput').value.trim();
            if (searchQuery) {
                const visibleFileElements = document.querySelectorAll('#treeView .tree-item[data-is-dir="false"]:not(.hidden)');
                const paths = Array.from(visibleFileElements).map(el => el.getAttribute('data-path')).filter(Boolean);
                paths.forEach(p => selectedFilesSet.add(p));
                syncTreeCheckboxesWithSet(document.getElementById('treeView'), selectedFilesSet);
                syncFolderCheckboxes(document.getElementById('treeView'));
                vscode.postMessage({ type: 'selectMultipleFiles', filePaths: paths });
            } else {
                vscode.postMessage({ type: 'selectAll' });
            }
        });

        document.getElementById('btnExpandAll').addEventListener('click', () => {
            collectAllFolderPaths(rawTreeData);
            saveState();
            renderTree(rawTreeData, document.getElementById('treeView'));
        });

        document.getElementById('btnCollapse').addEventListener('click', () => {
            expandedFoldersSet.clear();
            saveState();
            renderTree(rawTreeData, document.getElementById('treeView'));
        });

        function collectAllFolderPaths(nodes) {
            if (!nodes) return;
            nodes.forEach(node => {
                if (node.isDirectory) {
                    expandedFoldersSet.add(node.path);
                    collectAllFolderPaths(node.children);
                }
            });
        }

        function applyFirstLevelExpansion(nodes) {
            if (!nodes) return;
            nodes.forEach(rootNode => {
                if (rootNode.isDirectory) {
                    expandedFoldersSet.add(rootNode.path);
                    if (rootNode.children) {
                        rootNode.children.forEach(child => {
                            if (child.isDirectory) {
                                expandedFoldersSet.add(child.path);
                            }
                        });
                    }
                }
            });
        }

        function applySmartGitExpansion(nodes) {
            if (!nodes) return;
            nodes.forEach(node => {
                if (node.isDirectory) {
                    if (node.gitFolderStatus && node.gitFolderStatus !== 'none') {
                        expandedFoldersSet.add(node.path);
                    }
                    applySmartGitExpansion(node.children);
                }
            });
        }

        function notifyFilterChange() {
            vscode.postMessage({
                type: 'updateFilters',
                filters: {
                    hideGitIgnored: document.getElementById('filterGit').checked,
                    hideLockFiles: document.getElementById('filterLock').checked,
                    hideBinaryFiles: document.getElementById('filterBinary').checked
                }
            });
        }
        document.getElementById('filterGit').addEventListener('change', notifyFilterChange);
        document.getElementById('filterLock').addEventListener('change', notifyFilterChange);
        document.getElementById('filterBinary').addEventListener('change', notifyFilterChange);

        document.getElementById('searchInput').addEventListener('input', (e) => {
            applySearchFilter(e.target.value.trim());
        });

        function applySearchFilter(query) {
            const rootContainer = document.getElementById('treeView');
            const selectAllBtn = document.getElementById('btnSelectAll');

            if (!query) {
                selectAllBtn.innerText = '✅ Выбрать всё';
                restoreTreeVisibility(rootContainer);
                return;
            }

            const lowerQuery = query.toLowerCase();

            function checkNodeVisibility(element) {
                let hasMatchingChild = false;
                const childContainer = element.querySelector(':scope > .nested');
                
                if (childContainer) {
                    const childItems = childContainer.querySelectorAll(':scope > .tree-item');
                    childItems.forEach(child => {
                        const isChildVisible = checkNodeVisibility(child);
                        if (isChildVisible) {
                            hasMatchingChild = true;
                        }
                    });
                }

                const name = (element.getAttribute('data-name') || '').toLowerCase();
                const isSelfMatch = name.includes(lowerQuery);
                const shouldBeVisible = isSelfMatch || hasMatchingChild;

                if (shouldBeVisible) {
                    element.classList.remove('hidden');
                    if (childContainer) {
                        childContainer.classList.remove('hidden');
                        const folderPath = element.getAttribute('data-path');
                        if (folderPath) {
                            expandedFoldersSet.add(folderPath);
                        }
                        const toggle = element.querySelector(':scope > .tree-row .folder-toggle');
                        if (toggle) toggle.innerText = '▼';
                        const icon = element.querySelector(':scope > .tree-row .node-icon');
                        if (icon) icon.innerText = '📂';
                    }
                } else {
                    element.classList.add('hidden');
                }

                return shouldBeVisible;
            }

            const topItems = rootContainer.querySelectorAll(':scope > .tree-item');
            topItems.forEach(item => checkNodeVisibility(item));
            saveState();

            const visibleFiles = rootContainer.querySelectorAll('.tree-item[data-is-dir="false"]:not(.hidden)');
            selectAllBtn.innerText = '✅ Выбрать найденное (' + visibleFiles.length + ')';
            syncFolderCheckboxes(rootContainer);
        }

        function restoreTreeVisibility(container) {
            const allItems = container.querySelectorAll('.tree-item');
            allItems.forEach(item => item.classList.remove('hidden'));

            const allNested = container.querySelectorAll('.nested');
            allNested.forEach(nested => {
                const parentItem = nested.closest('.tree-item');
                const folderPath = parentItem ? parentItem.getAttribute('data-path') : null;
                const isExpanded = folderPath ? expandedFoldersSet.has(folderPath) : false;

                if (isExpanded) {
                    nested.classList.remove('hidden');
                } else {
                    nested.classList.add('hidden');
                }

                const toggle = parentItem ? parentItem.querySelector(':scope > .tree-row .folder-toggle') : null;
                if (toggle) toggle.innerText = isExpanded ? '▼' : '▶';
                const icon = parentItem ? parentItem.querySelector(':scope > .tree-row .node-icon') : null;
                if (icon) icon.innerText = isExpanded ? '📂' : '📁';
            });

            syncFolderCheckboxes(container);
        }

        function updateStatsUI(stats) {
            document.getElementById('statCount').innerText = stats.count;
            document.getElementById('statTokens').innerText = '~' + stats.tokens.toLocaleString();
            
            const bar = document.getElementById('progressBar');
            bar.style.width = stats.percentage + '%';

            if (stats.percentage < 33) {
                bar.style.backgroundColor = 'var(--color-green)';
            } else if (stats.percentage < 66) {
                bar.style.backgroundColor = 'var(--color-yellow)';
            } else {
                bar.style.backgroundColor = 'var(--color-red)';
            }

            document.getElementById('progressCaption').innerText = stats.percentage + '% от 200k';
        }

        function renderTree(nodes, container) {
            container.innerHTML = '';
            if (!nodes || nodes.length === 0) {
                container.innerHTML = '<div style="padding: 10px; opacity: 0.6; font-size: 11px;">Нет доступных файлов в рабочей области</div>';
                return;
            }
            nodes.forEach(node => {
                container.appendChild(createNodeElement(node));
            });
            syncFolderCheckboxes(container);
        }

        function createNodeElement(node) {
            const wrapper = document.createElement('div');
            wrapper.className = 'tree-item';
            wrapper.setAttribute('data-name', node.name);
            wrapper.setAttribute('data-path', node.path);
            wrapper.setAttribute('data-is-dir', node.isDirectory ? 'true' : 'false');

            const row = document.createElement('div');
            row.className = 'tree-row';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.addEventListener('click', (e) => e.stopPropagation());

            if (node.isDirectory) {
                const isExpanded = expandedFoldersSet.has(node.path);

                const toggle = document.createElement('span');
                toggle.className = 'folder-toggle';
                toggle.innerText = isExpanded ? '▼' : '▶';

                const icon = document.createElement('span');
                icon.className = 'node-icon';
                icon.innerText = isExpanded ? '📂' : '📁';

                const title = document.createElement('span');
                title.className = 'node-title';
                title.innerText = node.name;

                if (node.gitFolderStatus === 'untracked') {
                    title.classList.add('git-untracked');
                } else if (node.gitFolderStatus === 'modified') {
                    title.classList.add('git-modified');
                }

                row.appendChild(toggle);
                row.appendChild(checkbox);
                row.appendChild(icon);
                row.appendChild(title);

                if (node.gitFolderStatus && node.gitFolderStatus !== 'none') {
                    const dot = document.createElement('span');
                    dot.className = 'git-folder-dot ' + (node.gitFolderStatus === 'untracked' ? 'git-folder-dot-u' : 'git-folder-dot-m');
                    dot.title = node.gitFolderStatus === 'untracked' ? 'Содержит новые файлы (Untracked)' : 'Содержит измененные файлы (Modified)';
                    row.appendChild(dot);
                }

                wrapper.appendChild(row);

                const childrenContainer = document.createElement('div');
                childrenContainer.className = 'nested' + (isExpanded ? '' : ' hidden');
                
                if (node.children && node.children.length > 0) {
                    node.children.forEach(child => {
                        childrenContainer.appendChild(createNodeElement(child));
                    });
                }
                wrapper.appendChild(childrenContainer);

                row.addEventListener('click', () => {
                    const currentlyOpen = expandedFoldersSet.has(node.path);
                    if (currentlyOpen) {
                        expandedFoldersSet.delete(node.path);
                        childrenContainer.classList.add('hidden');
                        toggle.innerText = '▶';
                        icon.innerText = '📁';
                    } else {
                        expandedFoldersSet.add(node.path);
                        childrenContainer.classList.remove('hidden');
                        toggle.innerText = '▼';
                        icon.innerText = '📂';
                    }
                    saveState();
                });

                checkbox.addEventListener('change', (e) => {
                    if (checkbox.disabled) return;
                    const isChecked = e.target.checked;
                    const searchQuery = document.getElementById('searchInput').value.trim();

                    if (searchQuery) {
                        const visibleFileItems = childrenContainer.querySelectorAll('.tree-item[data-is-dir="false"]:not(.hidden)');
                        const affectedPaths = [];

                        visibleFileItems.forEach(item => {
                            const p = item.getAttribute('data-path');
                            const cb = item.querySelector(':scope > .tree-row input[type="checkbox"]');
                            if (p && cb) {
                                cb.checked = isChecked;
                                cb.indeterminate = false;
                                if (isChecked) {
                                    selectedFilesSet.add(p);
                                } else {
                                    selectedFilesSet.delete(p);
                                }
                                affectedPaths.push(p);
                            }
                        });

                        checkbox.indeterminate = false;
                        syncFolderCheckboxes(document.getElementById('treeView'));

                        vscode.postMessage({
                            type: 'toggleFilesBatch',
                            filePaths: affectedPaths,
                            checked: isChecked
                        });
                    } else {
                        const childFileItems = childrenContainer.querySelectorAll('.tree-item[data-is-dir="false"]');
                        childFileItems.forEach(fileItem => {
                            const p = fileItem.getAttribute('data-path');
                            const cb = fileItem.querySelector(':scope > .tree-row input[type="checkbox"]');
                            if (p && cb) {
                                cb.checked = isChecked;
                                cb.indeterminate = false;
                                if (isChecked) {
                                    selectedFilesSet.add(p);
                                } else {
                                    selectedFilesSet.delete(p);
                                }
                            }
                        });

                        checkbox.indeterminate = false;
                        syncFolderCheckboxes(document.getElementById('treeView'));

                        vscode.postMessage({
                            type: 'toggleFolder',
                            folderPath: node.path,
                            checked: isChecked
                        });
                    }
                });
            } else {
                checkbox.checked = selectedFilesSet.has(node.path);

                const icon = document.createElement('span');
                icon.className = 'node-icon';
                icon.innerText = '📄';

                const title = document.createElement('span');
                title.className = 'node-title';
                title.innerText = node.name;

                row.appendChild(checkbox);
                row.appendChild(icon);
                row.appendChild(title);

                if (node.gitStatus === 'untracked') {
                    title.classList.add('git-untracked');
                    const badge = document.createElement('span');
                    badge.className = 'git-badge git-badge-u';
                    badge.innerText = 'U';
                    row.appendChild(badge);
                } else if (node.gitStatus === 'modified') {
                    title.classList.add('git-modified');
                    const badge = document.createElement('span');
                    badge.className = 'git-badge git-badge-m';
                    badge.innerText = 'M';
                    row.appendChild(badge);
                }

                function onFileCheckboxChange(isChecked) {
                    if (isChecked) {
                        selectedFilesSet.add(node.path);
                    } else {
                        selectedFilesSet.delete(node.path);
                    }
                    syncFolderCheckboxes(document.getElementById('treeView'));

                    vscode.postMessage({
                        type: 'toggleFile',
                        filePath: node.path,
                        checked: isChecked
                    });
                }

                row.addEventListener('click', (e) => {
                    if (e.target === checkbox) return;
                    checkbox.checked = !checkbox.checked;
                    onFileCheckboxChange(checkbox.checked);
                });

                checkbox.addEventListener('change', (e) => {
                    onFileCheckboxChange(e.target.checked);
                });

                wrapper.appendChild(row);
            }

            return wrapper;
        }

        function updateFolderCheckboxState(folderCheckbox, childrenContainer) {
            const searchQuery = document.getElementById('searchInput').value.trim();
            const folderRow = folderCheckbox.closest('.tree-row');
            
            const fileSelector = searchQuery
                ? '.tree-item[data-is-dir="false"]:not(.hidden) > .tree-row input[type="checkbox"]'
                : '.tree-item[data-is-dir="false"] > .tree-row input[type="checkbox"]';

            const fileCheckboxes = childrenContainer.querySelectorAll(fileSelector);
            const totalFiles = fileCheckboxes.length;

            if (totalFiles === 0) {
                folderCheckbox.checked = false;
                folderCheckbox.indeterminate = false;
                folderCheckbox.disabled = true;
                if (folderRow) {
                    folderRow.title = 'Папка пуста или её содержимое скрыто фильтрами';
                }
                return;
            }

            folderCheckbox.disabled = false;
            if (folderRow) {
                folderRow.removeAttribute('title');
            }

            let checkedCount = 0;
            fileCheckboxes.forEach(cb => {
                if (cb.checked) {
                    checkedCount++;
                }
            });

            if (checkedCount === 0) {
                folderCheckbox.checked = false;
                folderCheckbox.indeterminate = false;
            } else if (checkedCount === totalFiles) {
                folderCheckbox.checked = true;
                folderCheckbox.indeterminate = false;
            } else {
                folderCheckbox.checked = false;
                folderCheckbox.indeterminate = true;
            }
        }

        function syncTreeCheckboxesWithSet(container, set) {
            const fileItems = container.querySelectorAll('.tree-item[data-is-dir="false"]');
            fileItems.forEach(item => {
                const p = item.getAttribute('data-path');
                const cb = item.querySelector(':scope > .tree-row input[type="checkbox"]');
                if (p && cb) {
                    cb.checked = set.has(p);
                }
            });
        }

        function syncFolderCheckboxes(container) {
            const nestedContainers = Array.from(container.querySelectorAll('.nested')).reverse();
            nestedContainers.forEach(nc => {
                const parentRow = nc.previousElementSibling;
                if (parentRow) {
                    const folderCheckbox = parentRow.querySelector(':scope > input[type="checkbox"]');
                    if (folderCheckbox) {
                        updateFolderCheckboxState(folderCheckbox, nc);
                    }
                }
            });
        }

        syncPromptWithExtension();
        vscode.postMessage({ type: 'requestInitialData' });
    `;
}