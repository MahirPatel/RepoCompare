$(document).ready(function() {
    let currentDiffData = null;
    let currentFilePath = null;
    let baseRepoPath    = '';
    let parentRepoPath  = '';
    let firstModifiedId = null;
    let diffCache       = {};

    $('#compareForm').on('submit', function(e) {
        e.preventDefault();

        const baseRepo   = $('#baseRepo').val().trim();
        const parentRepo = $('#parentRepo').val().trim();

        if (!baseRepo || !parentRepo) {
            showErrorToast('Please enter both repository paths');
            return;
        }

        baseRepoPath   = baseRepo;
        parentRepoPath = parentRepo;
        compareRepositories(baseRepo, parentRepo);
    });

    function compareRepositories(baseRepo, parentRepo) {
        // Clear stale state before new comparison
        currentDiffData = null;
        currentFilePath = null;
        firstModifiedId = null;
        diffCache       = {};
        $('#fileTree').jstree('destroy');
        $('#diffViewer').addClass('d-none');
        $('#diffLoading').addClass('d-none');
        $('#noSelection').removeClass('d-none');
        $('#diffLegend').addClass('d-none');
        $('#summaryBar').addClass('d-none');
        $('#treeSearch').val('');

        $('#loadingSpinner').removeClass('d-none');
        $('#resultsSection').addClass('d-none');

        $.ajax({
            url: 'api_v1/repodiff.php',
            method: 'POST',
            data: {
                baseRepository:   baseRepo,
                parentRepository: parentRepo
            },
            dataType: 'json',
            success: function(response) {
                $('#loadingSpinner').addClass('d-none');
                if (response.status === '1') {
                    displayResults(response.data);
                } else {
                    showErrorToast(response.message || 'Failed to compare repositories');
                }
            },
            error: function(xhr, status, error) {
                $('#loadingSpinner').addClass('d-none');
                showErrorToast(error || 'An unexpected error occurred');
            }
        });
    }

    function displayResults(data) {
        if (data.Summary) {
            var s = data.Summary;
            $('#stat-total').text(s.total       || 0);
            $('#stat-modified').text(s.modified || 0);
            $('#stat-new').text(s.new           || 0);
            $('#stat-deleted').text(s.deleted   || 0);
            $('#stat-unchanged').text(s.unchanged || 0);
            $('#summaryBar').removeClass('d-none');
        }
        buildJSTree(data.FileTree);
        $('#resultsSection').removeClass('d-none').addClass('fade-in');
        $('#noSelection').removeClass('d-none');
        $('#diffViewer').addClass('d-none');
    }

    function buildJSTree(tree) {
        firstModifiedId = null;
        const treeData  = convertToJSTreeFormat(tree, '');

        $('#fileTree').jstree('destroy').jstree({
            'core': {
                'data': treeData,
                'themes': {
                    'name':  'default',
                    'dots':  true,
                    'icons': true
                }
            },
            'plugins': ['types', 'search'],
            'search': {
                'show_only_matches':          true,
                'show_only_matches_children': true
            },
            'types': {
                'folder':          { 'icon': 'fas fa-folder text-warning' },
                'folder-modified': { 'icon': 'fas fa-folder text-success' },
                'file':            { 'icon': 'fas fa-file-code text-muted' },
                'modified':        { 'icon': 'fas fa-file-code text-success' },
                'new-file':        { 'icon': 'fas fa-file-circle-plus text-primary' },
                'deleted-file':    { 'icon': 'fas fa-file-circle-minus text-danger' }
            }
        })
        .on('ready.jstree', function() {
            if (firstModifiedId) {
                $('#fileTree').jstree('select_node', firstModifiedId);
            }
        })
        .on('select_node.jstree', function(e, data) {
            const node = data.node;
            const t    = node.original.type;
            if (t === 'modified' || t === 'new-file' || t === 'deleted-file') {
                fetchAndDisplayDiff(node.original.fullPath, node.original.relativePath, node.original.fileStatus);
            }
        });
    }

    function fetchAndDisplayDiff(filePath, relativePath, fileStatus) {
        // Serve from cache if already fetched
        if (diffCache[filePath] !== undefined) {
            displayDiff(filePath, diffCache[filePath], relativePath, fileStatus);
            return;
        }

        // Show inline loading indicator
        $('#noSelection').addClass('d-none');
        $('#diffViewer').addClass('d-none');
        $('#diffLegend').addClass('d-none');
        $('#diffLoading').removeClass('d-none');

        $.ajax({
            url: 'api_v1/repodiff.php',
            method: 'POST',
            data: {
                baseRepository:   baseRepoPath,
                parentRepository: parentRepoPath,
                filePath:         relativePath
            },
            dataType: 'json',
            success: function(response) {
                $('#diffLoading').addClass('d-none');
                if (response.status === '1') {
                    var diff       = response.diff       || '';
                    var fileStatus = response.fileStatus || fileStatus;
                    diffCache[filePath] = diff;
                    displayDiff(filePath, diff, relativePath, fileStatus);
                } else {
                    showErrorToast(response.message || 'Failed to load diff');
                    $('#noSelection').removeClass('d-none');
                }
            },
            error: function(xhr, status, error) {
                $('#diffLoading').addClass('d-none');
                showErrorToast('Failed to load diff: ' + error);
                $('#noSelection').removeClass('d-none');
            }
        });
    }

    function convertToJSTreeFormat(tree, parentPath) {
        const nodes = [];

        if (tree.folders) {
            Object.keys(tree.folders).forEach(function(folderName) {
                const folder        = tree.folders[folderName];
                const currentPath   = parentPath ? parentPath + '/' + folderName : folderName;
                const modifiedCount = countModifiedFiles(folder);
                const totalFiles    = countTotalFiles(folder);
                const hasModified   = modifiedCount > 0;

                const folderNode = {
                    'id':       'folder_' + Math.random().toString(36).substring(2, 11),
                    'text':     folderName + ' (' + totalFiles + (modifiedCount > 0 ? ', +' + modifiedCount : '') + ')',
                    'type':     hasModified ? 'folder-modified' : 'folder',
                    'state':    { 'opened': false },
                    'children': convertToJSTreeFormat(folder, currentPath),
                    'a_attr':   hasModified ? { 'class': 'folder-has-changes' } : {}
                };

                nodes.push(folderNode);
            });
        }

        if (tree.files) {
            tree.files.forEach(function(file) {
                const status     = file.status || 'unchanged';
                const hasChanges = status === 'modified' || status === 'new' || status === 'deleted';

                const typeMap = {
                    'modified':  'modified',
                    'new':       'new-file',
                    'deleted':   'deleted-file',
                    'unchanged': 'file'
                };
                const classMap = {
                    'modified':  'file-modified',
                    'new':       'file-new',
                    'deleted':   'file-deleted',
                    'unchanged': ''
                };
                const suffixMap = {
                    'modified':  ' [Modified]',
                    'new':       ' [New]',
                    'deleted':   ' [Deleted]',
                    'unchanged': ''
                };

                const nodeId = 'file_' + Math.random().toString(36).substring(2, 11);
                const cls    = classMap[status];

                const fileNode = {
                    'id':           nodeId,
                    'text':         file.name + (suffixMap[status] || ''),
                    'type':         typeMap[status] || 'file',
                    'fullPath':     file.path,
                    'relativePath': file.relativePath,
                    'fileStatus':   status,
                    'a_attr':       cls ? { 'class': cls } : {}
                };

                if (hasChanges && firstModifiedId === null) {
                    firstModifiedId = nodeId;
                }

                nodes.push(fileNode);
            });
        }

        return nodes;
    }

    function countModifiedFiles(folder) {
        let count = 0;

        if (folder.files) {
            folder.files.forEach(function(file) {
                const s = file.status || '';
                if (s === 'modified' || s === 'new' || s === 'deleted') count++;
            });
        }

        if (folder.folders) {
            Object.keys(folder.folders).forEach(function(folderName) {
                count += countModifiedFiles(folder.folders[folderName]);
            });
        }

        return count;
    }

    function countTotalFiles(folder) {
        let count = 0;

        if (folder.files) count += folder.files.length;

        if (folder.folders) {
            Object.keys(folder.folders).forEach(function(folderName) {
                count += countTotalFiles(folder.folders[folderName]);
            });
        }

        return count;
    }

    function displayDiff(filePath, diffCode, relativePath, status) {
        currentFilePath = filePath;
        currentDiffData = diffCode || '';

        const fileName = relativePath || filePath.split('/').pop();
        $('#diffFileName').text(fileName);

        const diffLines = (diffCode || '').split('\n');
        let additions   = 0;
        let deletions   = 0;

        diffLines.forEach(function(line) {
            if (line.startsWith('+') && !line.startsWith('+++')) additions++;
            if (line.startsWith('-') && !line.startsWith('---')) deletions++;
        });

        const diffContent = $('#diffContent');
        diffContent.empty();

        const header = $('<div class="diff-header">' +
            '<span>' + escapeHtml(fileName) + '</span>' +
            '<div class="diff-stats">' +
            '<span class="stat-additions">+' + additions + '</span>' +
            '<span class="stat-deletions">-' + deletions + '</span>' +
            '</div>' +
            '</div>');
        diffContent.append(header);

        const table = $('<table class="diff-table"></table>');

        if (!diffCode || diffCode.trim() === '') {
            const msg = status === 'new'      ? 'New file — no diff available' :
                        status === 'deleted'  ? 'File deleted in parent repository' :
                        status === 'binary'   ? 'Binary file — diff not shown' :
                        status === 'toolarge' ? 'File exceeds 5 MB — diff not shown' :
                                               'No differences found';
            table.append(
                '<tr class="context">' +
                '<td class="ln-base"></td><td class="ln-parent"></td>' +
                '<td class="diff-cell">' + escapeHtml(msg) + '</td>' +
                '</tr>'
            );
        } else {
            let baseLineNo   = 1;
            let parentLineNo = 1;

            diffLines.forEach(function(line) {
                const isFileHdr = line.startsWith('---') || line.startsWith('+++');
                const isHunkHdr = line.startsWith('@@');
                const isHeader  = isFileHdr || isHunkHdr;
                const isAdd     = !isHeader && line.startsWith('+');
                const isDel     = !isHeader && line.startsWith('-');

                let rowClass = 'context';
                let bNum     = '';
                let pNum     = '';
                let content  = line;

                if (isHeader) {
                    rowClass = 'diff-header-row';
                    // Reset the line counters from the hunk header so numbers stay
                    // correct even when identical chunks are skipped (large files).
                    if (isHunkHdr) {
                        var hunk = line.match(/^@@\s*-(\d+)(?:,\d+)?\s*\+(\d+)(?:,\d+)?\s*@@/);
                        if (hunk) {
                            baseLineNo   = parseInt(hunk[1], 10);
                            parentLineNo = parseInt(hunk[2], 10);
                        }
                    }
                } else if (isAdd) {
                    rowClass = 'addition';
                    pNum     = parentLineNo++;
                    content  = line.substring(1);
                } else if (isDel) {
                    rowClass = 'deletion';
                    bNum     = baseLineNo++;
                    content  = line.substring(1);
                } else {
                    bNum    = baseLineNo++;
                    pNum    = parentLineNo++;
                    content = line.substring(1);
                }

                table.append(
                    '<tr class="' + rowClass + '">' +
                    '<td class="ln-base">'   + bNum + '</td>' +
                    '<td class="ln-parent">' + pNum + '</td>' +
                    '<td class="diff-cell">' + escapeHtml(content) + '</td>' +
                    '</tr>'
                );
            });
        }

        diffContent.append(table);
        $('#noSelection').addClass('d-none');
        $('#diffLegend').removeClass('d-none');
        $('#diffViewer').removeClass('d-none');
    }

    function escapeHtml(text) {
        const div    = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Tree search with debounce
    var searchTimeout;
    $('#treeSearch').on('keyup', function() {
        clearTimeout(searchTimeout);
        var val = $(this).val();
        searchTimeout = setTimeout(function() {
            $('#fileTree').jstree('search', val);
        }, 250);
    });

    window.expandAll = function() {
        $('#fileTree').jstree('open_all');
    };

    window.collapseAll = function() {
        $('#fileTree').jstree('close_all');
    };

    window.copyDiff = function() {
        if (currentDiffData !== null) {
            if (navigator.clipboard) {
                navigator.clipboard.writeText(currentDiffData)
                    .then(function() { showToast('Diff copied!'); })
                    .catch(function(err) { showErrorToast('Copy failed: ' + err.message); });
            } else {
                const ta = document.createElement('textarea');
                ta.value = currentDiffData;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                showToast('Diff copied!');
            }
        }
    };

    window.copyPath = function() {
        if (currentFilePath) {
            if (navigator.clipboard) {
                navigator.clipboard.writeText(currentFilePath)
                    .then(function() { showToast('Path copied!'); })
                    .catch(function(err) { showErrorToast('Copy failed: ' + err.message); });
            } else {
                const ta = document.createElement('textarea');
                ta.value = currentFilePath;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                showToast('Path copied!');
            }
        }
    };

    function showToast(message, type) {
        type = type || 'success';
        if (!$('#toast-container').length) {
            $('body').append('<div id="toast-container" class="position-fixed top-0 end-0 p-3" style="z-index: 1050;"></div>');
        }

        const bgClass = type === 'error' ? 'bg-danger' : 'bg-success';
        const icon    = type === 'error' ? 'fas fa-exclamation-circle' : 'fas fa-check-circle';

        const toast = $('<div class="toast" role="alert">' +
            '<div class="toast-body ' + bgClass + ' text-white">' +
            '<i class="' + icon + ' me-1"></i>' + escapeHtml(message) +
            '</div>' +
            '</div>');

        $('#toast-container').append(toast);

        const bsToast = new bootstrap.Toast(toast[0]);
        bsToast.show();

        toast.on('hidden.bs.toast', function() {
            $(this).remove();
        });
    }

    function showErrorToast(message) {
        showToast(message, 'error');
    }
});
