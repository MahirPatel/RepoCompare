# Repository Compare Tool

A lightweight web tool for comparing two local filesystem repositories side by side.
It walks both directory trees, classifies every file as **modified**, **new**, **deleted**,
or **unchanged**, and renders a colour-coded, line-by-line diff for any file you select.

No build step, no database, no external services — just PHP on the server and
jQuery in the browser.

---

## Features

- **Folder-by-folder tree view** — an interactive [jsTree](https://www.jstree.com/) with
  per-folder change counts, status colours, and a live filter box.
- **Summary bar** — total, modified, new, deleted, and unchanged counts at a glance.
- **Line-numbered diff viewer** — additions, deletions, and context lines with separate
  base/parent line-number gutters and `+ / -` statistics.
- **Full content for new & deleted files** — new files render as all-additions and deleted
  files as all-deletions, not just a placeholder.
- **Lazy diffing** — the initial scan only hashes files (fast); a diff is generated on
  demand when you click a file, and cached client-side.
- **Copy helpers** — copy the diff text or the absolute file path with one click.
- **Safe by design** — path-traversal protection, binary-file skipping, and a 5 MB
  per-file diff cap.

---

## Tech stack

| Layer    | Technology                                              |
|----------|---------------------------------------------------------|
| Backend  | PHP **5.6** (no Composer, no framework)                 |
| Frontend | jQuery 3.7.1, Bootstrap 5.3, jsTree 3.3.16, Font Awesome 6 |
| Transport| `POST` requests returning JSON                          |

> **PHP 5.6 note:** the backend is intentionally written for PHP 5.6 compatibility —
> it uses `array()` literals and `isset()` ternaries instead of `[]` and `??`. Keep new
> code 5.6-compatible.

---

## Requirements

- A web server able to run **PHP 5.6+** (Apache, Nginx + PHP-FPM, or PHP's built-in server).
- Read access for the PHP process to both repository paths you want to compare.
- A modern browser (the CDN-hosted frontend libraries require internet access).

---

## Installation

1. Copy this folder into your web root, e.g. `/var/www/html/RepoCompair`.
2. Make sure the PHP process can read the directories you intend to compare.
3. Open the tool in a browser:

   ```
   http://localhost/RepoCompair/index.html
   ```

To run it without a full web server, use PHP's built-in server from the project root:

```bash
php -S localhost:8000
# then visit http://localhost:8000/index.html
```

---

## Usage

1. Enter the **Base Repository Path** and the **Parent Repository Path** (absolute paths
   on the server, e.g. `/var/www/html/inventory`).
2. Click **Compare Repositories**.
3. Browse the directory tree on the left. Changed files are highlighted; the first changed
   file is selected automatically.
4. Click any **modified / new / deleted** file to view its diff on the right.
5. Use the filter box, **Expand**/**Collapse**, and the **Copy Code** / **Copy Path**
   buttons as needed.

### Base vs. Parent — what the statuses mean

The **Base** repository is treated as the original/left side and the **Parent** repository
as the comparison/right side:

| Status      | Meaning                                                        |
|-------------|----------------------------------------------------------------|
| `unchanged` | Identical contents in both repositories                        |
| `modified`  | Present in both, but the contents differ                       |
| `deleted`   | Present in the **base** only (missing from the parent)         |
| `new`       | Present in the **parent** only (added relative to the base)    |

---

## API

The single endpoint `api_v1/repodiff.php` accepts `POST` form fields and returns JSON.
It operates in two modes.

### Mode 1 — Compare repositories (build the tree)

Send the two repository paths; omit `filePath`.

| Field              | Required | Description                       |
|--------------------|----------|-----------------------------------|
| `baseRepository`   | yes      | Absolute path to the base repo    |
| `parentRepository` | yes      | Absolute path to the parent repo  |

Returns a `Summary` (status counts) and a nested `FileTree` of `folders` and `files`.
See [`Response Example/success_response.json`](Response%20Example/success_response.json).

### Mode 2 — Single-file diff

Add `filePath` (relative to the repository root) to get the diff for one file.

| Field              | Required | Description                              |
|--------------------|----------|------------------------------------------|
| `baseRepository`   | yes      | Absolute path to the base repo           |
| `parentRepository` | yes      | Absolute path to the parent repo         |
| `filePath`         | yes      | File path relative to the repo root      |

The response includes a unified-style `diff` string and a `fileStatus` of `modified`,
`new`, `deleted`, `unchanged`, `binary`, or `toolarge`.
See [`Response Example/single_file_diff_response.json`](Response%20Example/single_file_diff_response.json).

### Response envelope

Every response carries a string `status`: `"1"` on success, `"0"` on failure (with a
human-readable `message`).

---

## How it works

1. **Scan (Mode 1):** both trees are walked recursively, skipping `.git`, `node_modules`,
   `vendor`, and `.DS_Store`. Files are compared by `md5_file()` hash only — content is
   never loaded — so the initial scan stays fast even on large repositories.
2. **Diff (Mode 2):** on click, the selected file is diffed on the server. Files under
   ~800 lines use a true **LCS** (longest-common-subsequence) diff; larger files fall back
   to a chunked diff for performance. The browser renders the result with line numbers and
   `+ / -` stats, and caches it.

---

## Project structure

```
RepoCompair/
├── index.html                       # Page layout
├── css/
│   └── style.css                    # Custom styling (tree, diff viewer, responsive)
├── js/
│   └── app.js                       # AJAX, jsTree rendering, diff display, toasts
├── api_v1/
│   └── repodiff.php                 # Backend: scan, hash-compare, diff generation
└── Response Example/
    ├── success_response.json        # Example Mode 1 (tree) response
    └── single_file_diff_response.json  # Example Mode 2 (diff) response
```

---

## Configuration & limits

Tunable in `api_v1/repodiff.php`:

- **Memory / time:** `ini_set('memory_limit', '256M')` and `set_time_limit(120)`.
- **Ignored paths:** the `$ignorePatterns` array in `getFiles()`.
- **Max diff size:** 5 MB per file (`$maxBytes`); larger files report `toolarge`.
- **Chunked-diff threshold:** files over 800 lines use the chunked path.

---

## Limitations & notes

- Compares **local filesystem paths only** — it does not clone or fetch from Git remotes.
- Both repositories must be readable by the PHP process on the same machine/server.
- Binary files are detected (NUL-byte sniff) and skipped in the diff view.
- The chunked diff for very large files is approximate (chunk-local), favouring speed.
- The endpoint sends permissive CORS headers (`Access-Control-Allow-Origin: *`); restrict
  these before any untrusted deployment.

---

## Security

- File paths are resolved with `realpath()` and validated to stay inside the configured
  repository roots, blocking path-traversal (`../`) attempts on both sides.
- This tool exposes server filesystem contents to whoever can reach it. **Run it only in
  trusted/internal environments**, and place it behind authentication if exposed.
