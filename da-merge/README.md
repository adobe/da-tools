# DA Merge

The merge engine for DA copies (loc and MSM). It compares a source page with a target page and returns the page to save. Where an author must decide, the page holds diff markup that the editor shows as a review.

It does not read or write DA. The caller reads the pages, calls the engine, and saves the result.

## Install

```bash
npm install @adobe/da-merge
```

## Create an engine

Pass in a DOM implementation and a canonicalizer once, when you create the engine.

- **DOM:** the browser's globals, or [linkedom](https://github.com/WebReflection/linkedom) in a worker or Node.js.
- **canonicalize:** turns page HTML into the form the editor saves. Pages are compared in this form, so an unedited page never shows false local edits. It must return the content in `main > div` sections, as da-parser does. Use [`@adobe/da-parser`](../da-parser), the same version the editors run.

```javascript
import * as Y from 'yjs';
import { aem2doc, doc2aem } from '@adobe/da-parser';
import DaMerge from '@adobe/da-merge';

const canonicalize = (html) => {
  const ydoc = new Y.Doc();
  aem2doc(html, ydoc);
  return doc2aem(ydoc);
};

// Browser
const merge = new DaMerge({ DOMParser, Node, document, canonicalize });

// Worker or Node.js
import { parseHTML } from 'linkedom';
const dom = parseHTML('<!DOCTYPE html><html><body></body></html>');
const workerMerge = new DaMerge({
  DOMParser: dom.DOMParser, Node: dom.Node, document: dom.document, canonicalize,
});
```

## Copy a page

```javascript
const { html, baseline, report } = await merge.applyCopy({
  source,             // source page HTML
  target,             // target page HTML, or null when it doesn't exist
  behavior,           // 'smart-overwrite' | 'merge' | 'overwrite' | 'create-only'
  path,               // target path, for example /org/site/page.html
  sourcePath,         // optional: source path, to detect a copy from a snapshot
  site, config,       // target site, and its translation config (equivalent hostnames)
  equivalentSites,    // optional: more site names whose links count as the target site's
  recordBaseline,     // required except for smart-overwrite: also write a baseline for smart-overwrite
  labels,             // { local, upstream }: review tab labels
  baselineHtml,       // smart-overwrite: the page as of the last copy, to show what each conflict was
  normalizeImages,    // optional connector hook (sourceDoc, targetDoc)
});
if (html) await save(path, html);
```

`html` is the full page to save, or `null` when there is nothing to save.

| Behavior | Result |
|---|---|
| `create-only` | Writes the source when the target is missing. Otherwise `skipped`, even when the target is empty. |
| `overwrite` | Writes the source. Local edits are lost. |
| `merge` | Marks every difference for review (2-way). |
| `smart-overwrite` | Compares the source and the target with the baseline (3-way). It applies changes made on one side only, and marks only conflicts. Groups that are still open stay as they are. |

`report` holds `outcome` (`written`, `unchanged`, `skipped`, `needs-review`), the fallback `reason`, `counts` (`applied`, `keptLocal`, `needsReview`), the conflict `groups`, and `legacyHashes` (stored hashes matched from before canonicalizing).

`merge` treats a target with an empty `main` as missing and writes the source. A `merge` or `overwrite` without `recordBaseline` removes the target's baseline. When `path` or `sourcePath` contains `/.snapshots/`, the baseline rows (`rolloutbase`, `rolloutorder`) stay instead, and no new baseline is recorded. `overwrite` keeps the source's rows. `merge` keeps the target's rows.

`smart-overwrite` falls back to a merge with a reason: `no-baseline` (no baseline yet) or `page-too-large` (more than `MAX_UNITS` units on one side).

## Diff markup

Each conflict group has an id. Every marked unit says which side it is from.

```html
<da-diff-base data-mdast="ignore" data-diff-group="g1"><p>Original</p></da-diff-base>
<da-diff-deleted data-mdast="ignore" data-diff-group="g1" data-diff-side="source"
  data-diff-kind="changed" data-diff-reason="both-changed"><p>Incoming</p></da-diff-deleted>
<p da-diff-added="" data-diff-group="g1" data-diff-side="local" data-diff-kind="changed">Mine</p>
```

| Attribute | Values |
|---|---|
| `data-diff-group` | `g1`, `g2`, … unique in the page |
| `data-diff-side` | `source`, `local` |
| `data-diff-kind` | `changed` (both sides), `added` (one side) |
| `data-diff-reason` | on the first source unit of a group: `differs`, `both-changed`, `no-baseline`, `page-too-large`, `reviewing-open-markup` |

`<da-diff-base>` is written only when `baselineHtml` is given. The editors must run a `@adobe/da-parser` that keeps this markup, or their first save drops it.

## Other methods

| Method | Does |
|---|---|
| `markInSync({ source, target, path, site, config, equivalentSites, dryRun })` | Records the current source as the baseline of a target. Returns `sync` and the page to save. |
| `diffSummary(html)` | Groups and counts from a page's markup, without the editor |
| `parse(html)` | Parses a full HTML document or a body-only DA page |

The lower-level functions (`regionalDiff`, `smartMerge`, `smartRollout`, `getBlockHashes`, …) and helpers such as `removeLocTags` and `LOC_MARKERS` are exported too. They work on parsed documents and do not canonicalize.

## Merge rules

The rules come from da-nx: [smart overwrite](https://github.com/adobe/da-nx/blob/main/docs/rollout-smart-overwrite.md) and [loc copy](https://github.com/adobe/da-nx/blob/main/docs/loc-copy.md).

## Tests

```bash
npm test
```

The same tests run in Chrome and in Node.js with linkedom.
