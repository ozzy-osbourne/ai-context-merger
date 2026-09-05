export function getHtmlTemplate(): string {
    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        :root {
            --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
            --color-green: #2ea043;
            --color-yellow: #d29922;
            --color-red: #f85149;
            /* Используем нативные переменные темы оформления VS Code для Git */
            --git-modified: var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d);
            --git-untracked: var(--vscode-gitDecoration-untrackedResourceForeground, #73c991);
        }
        body {
            font-family: var(--font-family);
            padding: 10px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-sideBar-background);
            margin: 0;
            user-select: none;
        }

        .header-title {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 1px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 12px;
            text-transform: uppercase;
        }

        .btn-primary {
            width: 100%;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 10px 14px;
            font-size: 12px;
            font-weight: 700;
            border-radius: 4px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            box-sizing: border-box;
        }
        .btn-primary:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .btn-grid-2 {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
            margin-top: 6px;
        }

        .btn-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 6px 8px;
            font-size: 11px;
            border-radius: 4px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            white-space: nowrap;
        }
        .btn-secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .stats-card {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
            border-radius: 6px;
            padding: 8px 10px;
            margin-top: 12px;
        }
        .stats-header {
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            margin-bottom: 6px;
        }
        .stats-metric {
            font-weight: 600;
            color: var(--vscode-textLink-foreground);
        }
        .progress-bar-container {
            width: 100%;
            height: 6px;
            background-color: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.2));
            border-radius: 3px;
            overflow: hidden;
            margin-bottom: 4px;
        }
        .progress-bar-fill {
            height: 100%;
            width: 0%;
            background-color: var(--color-green);
            transition: width 0.3s ease, background-color 0.3s ease;
        }
        .progress-caption {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            text-align: right;
        }

        /* Панель фильтров */
        .filter-section {
            margin-top: 10px;
            background-color: var(--vscode-editor-background);
            border-radius: 4px;
            padding: 6px 8px;
            font-size: 11px;
        }
        .filter-title {
            font-weight: 600;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 4px;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .filter-row {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }
        .filter-item {
            display: flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
        }
        .filter-item input {
            cursor: pointer;
            margin: 0;
        }

        .search-container {
            margin-top: 10px;
            position: relative;
        }
        .search-input {
            width: 100%;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, transparent);
            padding: 6px 8px 6px 24px;
            font-size: 12px;
            border-radius: 4px;
            box-sizing: border-box;
            outline: none;
        }
        .search-input:focus {
            border-color: var(--vscode-focusBorder);
        }
        .search-icon {
            position: absolute;
            left: 7px;
            top: 6px;
            font-size: 11px;
            opacity: 0.6;
        }

        .tree-container {
            margin-top: 8px;
            max-height: calc(100vh - 410px);
            overflow-y: auto;
        }
        .tree-row {
            display: flex;
            align-items: center;
            padding: 3px 2px;
            font-size: 12px;
            border-radius: 3px;
            cursor: pointer;
        }
        .tree-row:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .tree-row input[type="checkbox"] {
            margin-right: 6px;
            cursor: pointer;
        }
        .folder-toggle {
            cursor: pointer;
            margin-right: 4px;
            font-size: 9px;
            width: 12px;
            display: inline-block;
            text-align: center;
            opacity: 0.8;
        }
        .node-icon {
            margin-right: 6px;
            opacity: 0.8;
        }
        .node-title {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .nested {
            margin-left: 14px;
        }
        .hidden {
            display: none !important;
        }

        .git-modified {
            color: var(--git-modified) !important;
        }
        .git-untracked {
            color: var(--git-untracked) !important;
        }

        .git-badge {
            margin-left: auto;
            font-size: 10px;
            font-weight: 700;
            padding: 0 4px;
            border-radius: 2px;
        }
        .git-badge-m {
            color: var(--git-modified);
        }
        .git-badge-u {
            color: var(--git-untracked);
        }

        /* Индикатор-точка для папок */
        .git-folder-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            margin-left: auto;
            margin-right: 4px;
            flex-shrink: 0;
        }
        .git-folder-dot-m {
            background-color: var(--git-modified);
        }
        .git-folder-dot-u {
            background-color: var(--git-untracked);
        }
    </style>
</head>
<body>

    <div class="header-title">AI Context Merger</div>

    <button class="btn-primary" id="btnCopy">
        <span>📋</span> СКОПИРОВАТЬ КОНТЕКСТ
    </button>

    <div class="btn-grid-2">
        <button class="btn-secondary" id="btnPreview">👁️ Превью .md</button>
        <button class="btn-secondary" id="btnExport">💾 Экспорт в .md</button>
    </div>

    <!-- Ряд выбора файлов -->
    <div class="btn-grid-2">
        <button class="btn-secondary" id="btnSelectAll">✅ Выбрать всё</button>
        <button class="btn-secondary" id="btnClear">🧹 Снять всё</button>
    </div>

    <!-- Ряд управления раскрытием дерева -->
    <div class="btn-grid-2">
        <button class="btn-secondary" id="btnExpandAll">📂 Развернуть всё</button>
        <button class="btn-secondary" id="btnCollapse">📁 Свернуть всё</button>
    </div>

    <!-- Ряд обновления и Git Diff -->
    <div class="btn-grid-2">
        <button class="btn-secondary" id="btnRefresh">🔄 Обновить</button>
        <button class="btn-secondary" id="btnGit">🌿 Измененные (Git)</button>
    </div>

    <!-- Панель фильтров -->
    <div class="filter-section">
        <div class="filter-title"><span>⚙️</span> Фильтры скрытия:</div>
        <div class="filter-row">
            <label class="filter-item">
                <input type="checkbox" id="filterGit" checked> .gitignore
            </label>
            <label class="filter-item">
                <input type="checkbox" id="filterLock" checked> Lock-файлы
            </label>
            <label class="filter-item">
                <input type="checkbox" id="filterBinary" checked> Бинарники
            </label>
        </div>
    </div>

    <div class="stats-card">
        <div class="stats-header">
            <span>📊 Статистика:</span>
            <span><strong id="statCount" class="stats-metric">0</strong> файлов | <strong id="statTokens" class="stats-metric">0</strong> токенов</span>
        </div>
        <div class="progress-bar-container">
            <div class="progress-bar-fill" id="progressBar"></div>
        </div>
        <div class="progress-caption" id="progressCaption">0% от 200k</div>
    </div>

    <div class="search-container">
        <span class="search-icon">🔍</span>
        <input type="text" id="searchInput" class="search-input" placeholder="Быстрый поиск файлов..." />
    </div>

    <div class="tree-container" id="treeView"></div>

    <script>
        const vscode = acquireVsCodeApi();

        let rawTreeData = [];
        let selectedFilesSet = new Set();
        // Состояние раскрытых папок, сохраняемое между обновлениями
        let expandedFoldersSet = new Set();
        let isInitialLoadState = true;

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'setData') {
                rawTreeData = message.tree;
                selectedFilesSet = new Set(message.selectedFiles);
                updateStatsUI(message.stats);
                
                if (message.filters) {
                    document.getElementById('filterGit').checked = message.filters.hideGitIgnored;
                    document.getElementById('filterLock').checked = message.filters.hideLockFiles;
                    document.getElementById('filterBinary').checked = message.filters.hideBinaryFiles;
                }

                // Логика умного открытия или первичной инициализации 1-го уровня
                if (message.smartGitExpand) {
                    expandedFoldersSet.clear();
                    applySmartGitExpansion(rawTreeData);
                } else if (message.isInitialLoad || isInitialLoadState) {
                    expandedFoldersSet.clear();
                    applyFirstLevelExpansion(rawTreeData);
                    isInitialLoadState = false;
                }
                
                renderTree(rawTreeData, document.getElementById('treeView'));
                
                // Восстанавливаем фильтрацию, если в строке поиска есть текст
                const searchQuery = document.getElementById('searchInput').value.trim();
                if (searchQuery) {
                    applySearchFilter(searchQuery);
                }
            } else if (message.type === 'updateStats') {
                selectedFilesSet = new Set(message.selectedFiles);
                updateStatsUI(message.stats);
                syncFolderCheckboxes(document.getElementById('treeView'));
            }
        });

        // Слушатели кнопок действий
        document.getElementById('btnCopy').addEventListener('click', () => vscode.postMessage({ type: 'copyContext' }));
        document.getElementById('btnPreview').addEventListener('click', () => vscode.postMessage({ type: 'previewContext' }));
        document.getElementById('btnExport').addEventListener('click', () => vscode.postMessage({ type: 'exportFile' }));
        document.getElementById('btnSelectAll').addEventListener('click', () => vscode.postMessage({ type: 'selectAll' }));
        document.getElementById('btnClear').addEventListener('click', () => vscode.postMessage({ type: 'clearSelection' }));
        document.getElementById('btnRefresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
        document.getElementById('btnGit').addEventListener('click', () => vscode.postMessage({ type: 'selectModified' }));
        
        // Развернуть все папки
        document.getElementById('btnExpandAll').addEventListener('click', () => {
            collectAllFolderPaths(rawTreeData);
            renderTree(rawTreeData, document.getElementById('treeView'));
        });

        // Свернуть все папки
        document.getElementById('btnCollapse').addEventListener('click', () => {
            expandedFoldersSet.clear();
            renderTree(rawTreeData, document.getElementById('treeView'));
        });

        /**
         * Рекурсивное добавление всех директорий в множество раскрытых
         */
        function collectAllFolderPaths(nodes) {
            if (!nodes) return;
            nodes.forEach(node => {
                if (node.isDirectory) {
                    expandedFoldersSet.add(node.path);
                    collectAllFolderPaths(node.children);
                }
            });
        }

        /**
         * Раскрытие только 1-го уровня (корень и его прямые папки)
         */
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

        /**
         * Умное раскрытие: открывает только директории, содержащие измененные файлы Git
         */
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

        // Слушатели фильтров
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

        // Поиск с поддержкой вложенности
        document.getElementById('searchInput').addEventListener('input', (e) => {
            applySearchFilter(e.target.value.trim());
        });

        /**
         * Корректный поиск: элемент виден, если совпадает имя или если есть совпадения внутри
         * @param query строка поиска
         */
        function applySearchFilter(query) {
            const rootContainer = document.getElementById('treeView');
            if (!query) {
                // Если запрос пуст — восстанавливаем отображение по expandedFoldersSet
                renderTree(rawTreeData, rootContainer);
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
                        if (isChildVisible) hasMatchingChild = true;
                    });
                }

                const name = (element.getAttribute('data-name') || '').toLowerCase();
                const isSelfMatch = name.includes(lowerQuery);
                const shouldBeVisible = isSelfMatch || hasMatchingChild;

                if (shouldBeVisible) {
                    element.classList.remove('hidden');
                    if (childContainer) {
                        childContainer.classList.remove('hidden');
                        const toggle = element.querySelector(':scope > .tree-row .folder-toggle');
                        if (toggle) toggle.innerText = '▼';
                    }
                } else {
                    element.classList.add('hidden');
                }

                return shouldBeVisible;
            }

            const topItems = rootContainer.querySelectorAll(':scope > .tree-item');
            topItems.forEach(item => checkNodeVisibility(item));
        }

        function updateStatsUI(stats) {
            document.getElementById('statCount').innerText = stats.count;
            document.getElementById('statTokens').innerText = stats.tokens.toLocaleString();
            
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

        /**
         * Генерация DOM-структуры для отдельного узла файлового дерева
         */
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

                // Подкрашиваем текст названия папки, как в проводнике VS Code
                if (node.gitFolderStatus === 'modified') {
                    title.classList.add('git-modified');
                } else if (node.gitFolderStatus === 'untracked') {
                    title.classList.add('git-untracked');
                }

                row.appendChild(toggle);
                row.appendChild(checkbox);
                row.appendChild(icon);
                row.appendChild(title);

                // Отрисовка цветного индикатора-точки
                if (node.gitFolderStatus && node.gitFolderStatus !== 'none') {
                    const dot = document.createElement('span');
                    dot.className = 'git-folder-dot ' + (node.gitFolderStatus === 'untracked' ? 'git-folder-dot-u' : 'git-folder-dot-m');
                    dot.title = node.gitFolderStatus === 'untracked' ? 'Содержит новые файлы (Untracked)' : 'Содержит измененные файлы (Modified)';
                    row.appendChild(dot);
                }

                wrapper.appendChild(row);

                const childrenContainer = document.createElement('div');
                childrenContainer.className = 'nested' + (isExpanded ? '' : ' hidden');
                
                if (node.children) {
                    node.children.forEach(child => {
                        childrenContainer.appendChild(createNodeElement(child));
                    });
                }
                wrapper.appendChild(childrenContainer);

                // Переключение состояния папки по клику на всю строку (кроме самого чекбокса)
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
                });

                checkbox.addEventListener('change', (e) => {
                    vscode.postMessage({
                        type: 'toggleFolder',
                        folderPath: node.path,
                        checked: e.target.checked
                    });
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

                if (node.gitStatus === 'modified') {
                    title.classList.add('git-modified');
                    const badge = document.createElement('span');
                    badge.className = 'git-badge git-badge-m';
                    badge.innerText = 'M';
                    row.appendChild(badge);
                } else if (node.gitStatus === 'untracked') {
                    title.classList.add('git-untracked');
                    const badge = document.createElement('span');
                    badge.className = 'git-badge git-badge-u';
                    badge.innerText = 'U';
                    row.appendChild(badge);
                }

                // Клик по строке файла переключает его чекбокс
                row.addEventListener('click', () => {
                    checkbox.checked = !checkbox.checked;
                    vscode.postMessage({
                        type: 'toggleFile',
                        filePath: node.path,
                        checked: checkbox.checked
                    });
                });

                checkbox.addEventListener('change', (e) => {
                    vscode.postMessage({
                        type: 'toggleFile',
                        filePath: node.path,
                        checked: e.target.checked
                    });
                });

                wrapper.appendChild(row);
            }

            return wrapper;
        }

        /**
         * Пересчет состояния чекбокса папки (checked / indeterminate / unchecked)
         * Анализируются только прямые и вложенные чекбоксы файлов, игнорируя промежуточные папки.
         */
        function updateFolderCheckboxState(folderCheckbox, childrenContainer) {
            // Находим чекбоксы только конкретных файлов
            const fileItems = childrenContainer.querySelectorAll('.tree-item:not([data-is-dir="true"]) input[type="checkbox"]');
            if (fileItems.length === 0) return;

            let checkedCount = 0;
            fileItems.forEach(cb => {
                if (cb.checked) checkedCount++;
            });

            if (checkedCount === 0) {
                folderCheckbox.checked = false;
                folderCheckbox.indeterminate = false;
            } else if (checkedCount === fileItems.length) {
                folderCheckbox.checked = true;
                folderCheckbox.indeterminate = false;
            } else {
                folderCheckbox.checked = false;
                folderCheckbox.indeterminate = true;
            }
        }

        function syncFolderCheckboxes(container) {
            // Обходим дерево снизу вверх, чтобы вложенные структуры корректно обновляли родителей
            const nestedContainers = Array.from(container.querySelectorAll('.nested')).reverse();
            nestedContainers.forEach(nc => {
                const parentRow = nc.previousElementSibling;
                if (parentRow) {
                    const folderCheckbox = parentRow.querySelector('input[type="checkbox"]');
                    if (folderCheckbox) {
                        updateFolderCheckboxState(folderCheckbox, nc);
                    }
                }
            });
        }

        // Запрос начальных данных
        vscode.postMessage({ type: 'requestInitialData' });
    </script>
</body>
</html>`;
}