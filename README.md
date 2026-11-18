# Markdown Review Studio

A local desktop app for reviewing and revising large Markdown documents. It shows a structure tree, a read-only original, an editable revision, word-level diff highlighting, GitHub-style split/unified diff, and synchronized scrolling.

## Requirements

- Node.js 22+
- Windows (developed on Windows 11)

## Run

```powershell
npm install
npm run dev
```

## Production-style run

```powershell
npm run build
npm run preview
```

## Notes

- `npm install` must include dev dependencies. If `NODE_ENV=production` is set in your shell, run `npm install --include=dev`.
- The `dev`/`preview` scripts pass `--noSandbox` because Chromium's sandbox crashes in this environment. User data is stored in `.userdata/` inside the project (gitignored).

## Features

- Open a Markdown file, or load the bundled sample.
- Structure tree (H1–H6) with branch collapse and heading navigation.
- Section folding: gutter chevrons plus Fold all / Unfold all.
- Editable revision that never modifies the original.
- Save revision / Save as (the original path is never a save target).
- Side-by-side diff with added/removed/modified highlighting and word-level changes.
- Dedicated GitHub-style diff: split and unified modes, with Change navigation.
- Synchronized scrolling with an on/off toggle.

## Test fixtures

- `samples/sample.md` — small document with H1–H4 structure.
- `samples/large.md` — 10 topics, 49 headings, all Markdown element types.
- `samples/chatgpt-style.md` — bold pseudo-headings that must not become tree nodes.
- `samples/edge-cases.md` — skipped heading levels and out-of-order sections.

## Markdown parsing

The parser is local and deterministic: ATX and setext headings, CRLF/LF, Unicode/emoji, inline formatting, links and code in headings, closing `#` sequences, fenced/indented code protection, and `<think>` reasoning blocks. Diagnostics (skipped levels, duplicates, missing H1, unclosed fences, ambiguous `#Heading` lines) are reported without rewriting the document. Original/revision headings are matched by stable id, text, structural path, and section similarity, so renames keep their correspondence and deleted sections are marked unmatched.

## Tests

```powershell
npm test
```

