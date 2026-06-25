<?php
ini_set('memory_limit', '256M');
set_time_limit(120);

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');

$baseRepository   = isset($_POST['baseRepository'])   ? $_POST['baseRepository']   : '';
$parentRepository = isset($_POST['parentRepository']) ? $_POST['parentRepository'] : '';

$resolvedBase   = realpath(trim($baseRepository));
$resolvedParent = realpath(trim($parentRepository));

if (!$resolvedBase || !$resolvedParent || !is_dir($resolvedBase) || !is_dir($resolvedParent)) {
    echo json_encode(array('status' => '0', 'message' => 'One or both repository paths could not be resolved'));
    exit;
}

// MODE 2: single-file diff (called when user clicks a file in the tree)
$filePath = isset($_POST['filePath']) ? $_POST['filePath'] : '';
if ($filePath !== '') {
    $result = getSingleFileDiff($resolvedBase, $resolvedParent, $filePath);
    echo json_encode($result);
    exit;
}

// MODE 1: build file tree with statuses only — no diff content generated
$result = compareRepositories($resolvedBase, $resolvedParent);
echo json_encode(array(
    'status'  => '1',
    'message' => 'Repository compared successfully',
    'data'    => $result
));

// ─── MODE 2 ──────────────────────────────────────────────────────────────────

function getSingleFileDiff($baseRepo, $parentRepo, $filePath) {
    // Normalise path separators and strip leading slashes
    $filePath  = ltrim(str_replace('\\', '/', $filePath), '/');
    $absBase   = realpath($baseRepo   . '/' . $filePath);
    $absParent = realpath($parentRepo . '/' . $filePath);

    // Reject path traversal attempts on either side
    if ($absBase && strpos($absBase, $baseRepo) !== 0) {
        return array('status' => '0', 'message' => 'Invalid file path');
    }
    if ($absParent && strpos($absParent, $parentRepo) !== 0) {
        return array('status' => '0', 'message' => 'Invalid file path');
    }

    $baseExists   = $absBase   && file_exists($absBase);
    $parentExists = $absParent && file_exists($absParent);

    if (!$baseExists && !$parentExists) {
        return array('status' => '0', 'message' => 'File not found in either repository');
    }

    $maxBytes = 5 * 1024 * 1024;

    // New file — present in the parent repository only. Show its whole content as additions.
    if (!$baseExists) {
        if (isBinaryFile($absParent)) {
            return array('status' => '1', 'diff' => '', 'fileStatus' => 'binary');
        }
        if (filesize($absParent) > $maxBytes) {
            return array('status' => '1', 'diff' => '', 'fileStatus' => 'toolarge');
        }
        return array('status' => '1', 'diff' => generateOneSidedDiff($absParent, '+'), 'fileStatus' => 'new');
    }

    // Deleted file — present in the base repository only. Show its whole content as deletions.
    if (!$parentExists) {
        if (isBinaryFile($absBase)) {
            return array('status' => '1', 'diff' => '', 'fileStatus' => 'binary');
        }
        if (filesize($absBase) > $maxBytes) {
            return array('status' => '1', 'diff' => '', 'fileStatus' => 'toolarge');
        }
        return array('status' => '1', 'diff' => generateOneSidedDiff($absBase, '-'), 'fileStatus' => 'deleted');
    }

    // Skip binary files
    if (isBinaryFile($absBase)) {
        return array('status' => '1', 'diff' => '', 'fileStatus' => 'binary');
    }

    // Skip files over 5 MB
    if (filesize($absBase) > $maxBytes || filesize($absParent) > $maxBytes) {
        return array('status' => '1', 'diff' => '', 'fileStatus' => 'toolarge');
    }

    $diff = generateDiff($absBase, $absParent);
    return array(
        'status'     => '1',
        'diff'       => $diff,
        'fileStatus' => $diff !== '' ? 'modified' : 'unchanged'
    );
}

// Build a one-sided diff: every line of a single file marked as added ('+') or deleted ('-').
function generateOneSidedDiff($file, $sign) {
    $content = file_get_contents($file);
    $name    = basename($file);
    $lines   = explode("\n", $content);
    unset($content);

    if ($sign === '+') {
        $diff = array('--- /dev/null', "+++ $name");
    } else {
        $diff = array("--- $name", '+++ /dev/null');
    }

    foreach ($lines as $line) {
        $diff[] = $sign . $line;
    }

    return implode("\n", $diff);
}

function isBinaryFile($path) {
    $fh    = fopen($path, 'rb');
    if (!$fh) return false;
    $chunk = fread($fh, 8192);
    fclose($fh);
    return strpos($chunk, "\x00") !== false;
}

// ─── MODE 1 ──────────────────────────────────────────────────────────────────

function compareRepositories($baseRepo, $parentRepo) {
    $baseFiles = getFiles($baseRepo);
    $fileTree  = array();

    foreach ($baseFiles as $file) {
        $relativePath = ltrim(str_replace($baseRepo, '', $file), '/');
        $parentFile   = $parentRepo . '/' . $relativePath;

        if (!file_exists($parentFile)) {
            $status = 'deleted';
        } else {
            // Fast hash comparison — no file content loaded into memory
            $status = (md5_file($file) !== md5_file($parentFile)) ? 'modified' : 'unchanged';
        }

        $fileTree[] = array(
            'path'         => $file,
            'relativePath' => $relativePath,
            'status'       => $status
        );
    }

    // Detect new files (exist in parent but not in base)
    $parentFiles = getFiles($parentRepo);
    foreach ($parentFiles as $file) {
        $relativePath = ltrim(str_replace($parentRepo, '', $file), '/');
        $baseFile     = $baseRepo . '/' . $relativePath;
        if (!file_exists($baseFile)) {
            $fileTree[] = array(
                'path'         => $file,
                'relativePath' => $relativePath,
                'status'       => 'new'
            );
        }
    }

    // Build summary counts
    $summary = array('total' => count($fileTree), 'modified' => 0, 'new' => 0, 'deleted' => 0, 'unchanged' => 0);
    foreach ($fileTree as $f) {
        $summary[$f['status']]++;
    }

    return array(
        'Repository' => array(
            'BaseRepository'   => $baseRepo,
            'ParentRepository' => $parentRepo
        ),
        'Summary'  => $summary,
        'FileTree' => buildTree($fileTree)
    );
}

function buildTree($files) {
    $tree = array();

    foreach ($files as $file) {
        $parts   = explode('/', $file['relativePath']);
        $current = &$tree;

        for ($i = 0; $i < count($parts); $i++) {
            $part = $parts[$i];

            if ($i === count($parts) - 1) {
                $current['files'][] = array(
                    'name'         => $part,
                    'path'         => $file['path'],
                    'relativePath' => $file['relativePath'],
                    'status'       => $file['status']
                );
            } else {
                if (!isset($current['folders'][$part])) {
                    $current['folders'][$part] = array(
                        'name'    => $part,
                        'folders' => array(),
                        'files'   => array()
                    );
                }
                $current = &$current['folders'][$part];
            }
        }
    }

    return $tree;
}

function getFiles($dir) {
    $files          = array();
    $ignorePatterns = array('.git', 'node_modules', 'vendor', '.DS_Store');

    if (is_dir($dir)) {
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($dir, RecursiveDirectoryIterator::SKIP_DOTS)
        );

        foreach ($iterator as $file) {
            if ($file->isFile()) {
                $filePath     = $file->getPathname();
                $shouldIgnore = false;

                foreach ($ignorePatterns as $pattern) {
                    if (strpos($filePath, $pattern) !== false) {
                        $shouldIgnore = true;
                        break;
                    }
                }

                if (!$shouldIgnore) {
                    $files[] = $filePath;
                }
            }
        }
    }

    return $files;
}

// ─── DIFF GENERATION (used by Mode 2 only) ───────────────────────────────────

function generateDiff($baseFile, $parentFile) {
    if (!file_exists($baseFile) || !file_exists($parentFile)) {
        return '';
    }

    $baseContent   = file_get_contents($baseFile);
    $parentContent = file_get_contents($parentFile);

    if ($baseContent === $parentContent) {
        return '';
    }

    $baseLines   = explode("\n", $baseContent);
    $parentLines = explode("\n", $parentContent);
    $baseName    = basename($baseFile);
    $parentName  = basename($parentFile);

    // Free raw content from memory before running diff
    unset($baseContent, $parentContent);

    if (count($baseLines) > 800 || count($parentLines) > 800) {
        return generateChunkedDiff($baseLines, $parentLines, $baseName, $parentName);
    }

    return generateLCSDiff($baseLines, $parentLines, $baseName, $parentName);
}

function computeLCS(array $a, array $b) {
    $m  = count($a);
    $n  = count($b);
    $dp = array_fill(0, $m + 1, array_fill(0, $n + 1, 0));

    for ($i = 1; $i <= $m; $i++) {
        for ($j = 1; $j <= $n; $j++) {
            if ($a[$i - 1] === $b[$j - 1]) {
                $dp[$i][$j] = $dp[$i - 1][$j - 1] + 1;
            } else {
                $dp[$i][$j] = max($dp[$i - 1][$j], $dp[$i][$j - 1]);
            }
        }
    }

    $lcs = array();
    $i   = $m;
    $j   = $n;
    while ($i > 0 && $j > 0) {
        if ($a[$i - 1] === $b[$j - 1]) {
            array_unshift($lcs, array($i - 1, $j - 1));
            $i--;
            $j--;
        } elseif ($dp[$i - 1][$j] > $dp[$i][$j - 1]) {
            $i--;
        } else {
            $j--;
        }
    }

    return $lcs;
}

function generateLCSDiff(array $base, array $parent, $baseName, $parentName) {
    $lcs  = computeLCS($base, $parent);
    $diff = array("--- $baseName", "+++ $parentName");
    $bi   = 0;
    $pi   = 0;

    foreach ($lcs as $pair) {
        $bIdx = $pair[0];
        $pIdx = $pair[1];

        for (; $bi < $bIdx; $bi++) {
            $diff[] = '-' . $base[$bi];
        }
        for (; $pi < $pIdx; $pi++) {
            $diff[] = '+' . $parent[$pi];
        }
        $diff[] = ' ' . $base[$bIdx];
        $bi     = $bIdx + 1;
        $pi     = $pIdx + 1;
    }

    for (; $bi < count($base); $bi++) {
        $diff[] = '-' . $base[$bi];
    }
    for (; $pi < count($parent); $pi++) {
        $diff[] = '+' . $parent[$pi];
    }

    return implode("\n", $diff);
}

function generateChunkedDiff(array $base, array $parent, $baseName, $parentName) {
    $diff         = array("--- $baseName", "+++ $parentName");
    $chunkSize    = 50;
    $baseChunks   = array_chunk($base, $chunkSize);
    $parentChunks = array_chunk($parent, $chunkSize);
    $maxChunks    = max(count($baseChunks), count($parentChunks));

    for ($c = 0; $c < $maxChunks; $c++) {
        $bChunk = isset($baseChunks[$c])   ? $baseChunks[$c]   : array();
        $pChunk = isset($parentChunks[$c]) ? $parentChunks[$c] : array();

        if (md5(implode("\n", $bChunk)) === md5(implode("\n", $pChunk))) {
            continue;
        }

        $lineStart = $c * $chunkSize + 1;
        $diff[]    = "@@ -$lineStart +$lineStart @@";

        $chunkLCS = computeLCS($bChunk, $pChunk);
        $bi       = 0;
        $pi       = 0;

        foreach ($chunkLCS as $pair) {
            $bIdx = $pair[0];
            $pIdx = $pair[1];

            for (; $bi < $bIdx; $bi++) {
                $diff[] = '-' . $bChunk[$bi];
            }
            for (; $pi < $pIdx; $pi++) {
                $diff[] = '+' . $pChunk[$pi];
            }
            $diff[] = ' ' . $bChunk[$bIdx];
            $bi     = $bIdx + 1;
            $pi     = $pIdx + 1;
        }

        for (; $bi < count($bChunk); $bi++) {
            $diff[] = '-' . $bChunk[$bi];
        }
        for (; $pi < count($pChunk); $pi++) {
            $diff[] = '+' . $pChunk[$pi];
        }
    }

    return implode("\n", $diff);
}
