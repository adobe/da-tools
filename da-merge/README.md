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

To also resolve reviews, pass `aem2doc(html) → { state, metadata }` and `doc2aem(doc, metadata) → html` instead of `canonicalize`. `daParserAdapter` builds all three from da-parser, so every caller wires it the same way. Without `canonicalize`, the engine canonicalizes with `doc2aem(aem2doc(html))`.

```javascript
import * as Y from 'yjs';
import { EditorState } from 'prosemirror-state';
import {
  aem2doc, doc2aem, getSchema, yDocToProsemirror, prosemirrorToYXmlFragment,
} from '@adobe/da-parser';
import DaMerge, { daParserAdapter } from '@adobe/da-merge';

const parser = daParserAdapter({
  Y, EditorState, aem2doc, doc2aem, getSchema, yDocToProsemirror, prosemirrorToYXmlFragment,
});
const merge = new DaMerge({ DOMParser, Node, document, ...parser });
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
| `smart-overwrite` | Compares the source and the target with the baseline (3-way). It applies changes made on one side only, and marks only conflicts. Groups that are still open stay as they are. In a list with open items, the other items are merged one by one. |

`report` holds `outcome` (`written`, `unchanged`, `skipped`, `needs-review`), the fallback `reason`, `counts` (`applied`, `keptLocal`, `needsReview`), the conflict `groups`, `skipped` (conflicts left as the page has them), `removedUpstream` (source deletions of units the page edited), `contentChanged`, and `legacyHashes` (stored hashes matched from before canonicalizing).

`outcome` is `needs-review` whenever the page has open groups after the copy, even when `html` is `null`. Use `html === null` to tell that nothing was written. `counts.needsReview` counts the open groups on the page to save, or on the target when `html` is `null`. `contentChanged` is `true` when `html` changes the page content, not only its metadata.

Before it compares, the engine checks that canonicalizing keeps each page's content. It compares the text, the `da-metadata` values by key, and the number of `img`, `video`, and `a[href]` elements, outside `header` and `footer`. If they differ, `applyCopy` and `markInSync` throw an error with `code` `canonicalize-loss` (`CANONICALIZE_LOSS`), and nothing is written. The error's `side` names the page: `source`, `target`, or `baseline` (the `baselineHtml` page). Opening and saving the page in the editor makes it canonical.

Metadata keys are read without regard to case. When the engine rewrites the `da-metadata` rows, each existing row keeps its key as written (for example `rejectedHashes`). Rows the engine adds use its own spelling (`rolloutbase`, `rolloutorder`, `diff-label-local`, `diff-label-upstream`). Rows whose keys differ only by case are merged into the first one, with their values joined by commas.

`merge` treats a target with an empty `main` as missing and writes the source. A `merge` or `overwrite` without `recordBaseline` removes the target's baseline. When `path` or `sourcePath` contains `/.snapshots/`, the baseline rows (`rolloutbase`, `rolloutorder`) stay instead, and no new baseline is recorded. `overwrite` keeps the source's rows. `merge` keeps the target's rows. `smart-overwrite` does not merge against the baseline. It reviews every difference with reason `no-baseline`, and keeps the target's rows, or the source's rows when there is no target.

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
| `data-diff-kind` | `changed` (both sides), `added` (one side), `removed` (local side only: the source removed these units) |
| `data-diff-reason` | on the first source unit of a group, or on the first local unit when the group has no source side: `differs`, `both-changed`, `no-baseline`, `page-too-large`, `reviewing-open-markup` |

`<da-diff-base>` is written only when `baselineHtml` is given. The editors must run a `@adobe/da-parser` that keeps this markup, or their first save drops it.

## Resolve a review

Resolving turns a choice into a ProseMirror transaction, and records the review hashes that the next copy reads. It needs a da-parser schema with diff markup v2 (`diff_added`, `diff_deleted`, `diff_base` with `diffGroup` attributes). It throws a `TypeError` on a schema without them.

```javascript
import {
  createResolve, daParserAdapter, CHOICE, groups, findGroup, recordHashes, HASHES_META,
} from '@adobe/da-merge/resolve';

const parser = daParserAdapter({ Y, EditorState, aem2doc, doc2aem, getSchema, yDocToProsemirror, prosemirrorToYXmlFragment });
const engine = createResolve({ DOMParser, ...parser });

const metadata = ydoc.getMap('daMetadata');
const tr = engine.resolve({
  state: view.state, groupId: 'g1', choice: CHOICE.mine,
  metadata, transact: (fn) => ydoc.transact(fn, ySyncPluginKey), site, config,
});
if (tr) view.dispatch(tr);
```

`@adobe/da-merge/resolve` holds only the resolve code, the markup constants, and the hash functions. It does not bundle da-parser. A `DaMerge` created with `aem2doc` and `doc2aem` has the same methods.

| Method | Does |
|---|---|
| `resolve({ state, groupId, choice, metadata, transact, site, config })` | Resolves every marker and base of one group. Returns the transaction, or `null` when the group isn't there. |
| `resolveAll({ state, choice, … })` | Resolves every marker, grouped or not, and every base. |
| `resolveMarkers({ state, positions, choice, … })` | Resolves the markers at `positions`: a legacy single marker or pair. A group's base goes when its last marker goes. |
| `resolveHtml(html, groupId, choice, { site, config })` | `resolve` on a page: returns the page to save, with its hashes in the metadata, or `null`. |
| `resolveAllHtml(html, choice, { site, config })` | `resolveAll` on a page. |
| `reviewSummary(doc)` | `diffSummary` of a document |
| `groups(doc)`, `findGroup(doc, id)` | `{ id, markers: [{ node, pos, side }], bases: [{ node, pos }] }` |
| `recordHashes(metadata, { accepted, rejected }, { transact })` | Adds hashes to the review keys. |

| `choice` | Source side | Local side |
|---|---|---|
| `source` | kept | dropped |
| `mine` | dropped | kept |
| `both` | kept | kept |
| `neither` | dropped | dropped |

`state` needs only `doc`, `schema`, and `tr`: an `EditorState`, or `{ doc, schema, tr: new Transform(doc) }`.

- **Keep:** the marker is replaced by its content, with `da-diff-added` removed from every node in it, linked images included. An empty marker is deleted.
- **Drop:** the marker is deleted. When it is the only child of a list item, the list item is deleted too, and a list left empty is deleted. A list item with other content stays.
- **Bases:** a group's `da-diff-base` is deleted once the group has no markers left.

### Review hashes

Each kept unit is added to `acceptedHashes`, and each dropped unit to `rejectedHashes`. A unit is a block, a list item (for a marker in a list), or a whole block group. The hash is what the next copy reads: the unit as `doc2aem` saves it, with links normalized for `site` and `config` and diff attributes removed (`reviewHash`).

`metadata` is Map-like: `get`, `set`, and `keys` or `forEach`, for example a `Y.Map`. Keys are matched without regard to case, and hashes are added to the existing key without duplicates. `transact(fn)` runs the writes, so a Yjs undo manager can fold them into the same undo step as the transaction. Add the metadata map to the undo manager's scope, and dispatch the transaction right away. Without `metadata`, the hashes are only on the transaction: `tr.getMeta(HASHES_META)` is `{ accepted, rejected }`, ready for `recordHashes` after the dispatch.

The next copy honors the hashes:

| Unit | `merge` | `smart-overwrite` |
|---|---|---|
| Block | A rejected source block is left out. An accepted block is not marked. | A rejected source block is left out, unless the baseline holds it. |
| List item | Same, for items of two lists merged item by item. | Same, when a list with open items is merged item by item, and on an emptied page. |
| Block group | Same, for the whole group. | Same, for the whole group. |

Rejected hashes never remove the page's own units.

## Other methods

| Method | Does |
|---|---|
| `markInSync({ source, target, path, site, config, equivalentSites, dryRun })` | Records the current source as the baseline of a target. Returns `sync` and the page to save. |
| `diffSummary(html)` | Groups and counts from a page's markup, without the editor |
| `parse(html)` | Parses a full HTML document or a body-only DA page |

The lower-level functions (`regionalDiff`, `smartMerge`, `smartRollout`, `getBlockHashes`, …) and helpers such as `removeLocTags` and `LOC_MARKERS` are exported too. They work on parsed documents and do not canonicalize.

## Smart-overwrite conflicts

A conflict is a place where the source and the page both changed since the baseline. The engine asks only about content the author hasn't seen. Notation: baseline → source / page.

| Case (example) | Result |
|---|---|
| Both edited the same unit (`A B C` → `A G C` / `A L C`) | One group with both sides: `G` as source, `L` as local, kind `changed`. |
| The page deleted a unit the source edited (`A B C` → `A B2 C` / `A C`) | The page's version, no markers. Counts in `report.skipped`. |
| The source deleted a unit the page edited (`A B C` → `A C` / `A L C`) | `L` as a local-only group, kind `removed`. Counts in `report.removedUpstream`. |
| The source moved and edited a unit the page edited | No move detection: a deletion (as above) plus an insert, which is applied. |
| The source removed one of two identical units, and the page edited one | As a deletion: the page's unit is marked, the twin stays. |
| The source's change spans units the page didn't touch (`A B C` → `A2 Y B C` / `L B C`) | One group with both sides. The source side holds only units new to the page: units from the baseline that the page deleted stay deleted (`\| H A B` → `\| H A Y B` / `\| H` offers only `Y`, kind `added`). |
| The source added units to a section the page removed | The new units as a source-only group, kind `added`, at the end of the section before it. |
| The source deleted a section the page edited (`\| A \| B C` → `\| A` / `\| A \| Bl C`) | The page's units in that section as a local-only group, kind `removed`. One group per section. |
| The page added a section break between units it edited, and the source edited them too (`A B C` → `A Bs Cs` / `A Bl \| Cl`) | One group per section, each unit with its own source side and base (`Bs` / `Bl`, `Cs` / `Cl`). |
| The same, but the source's units can't be split at the page's section break (`A B C` → `A X` / `A Bl \| Cl`) | The page's version, no markers. Counts in `report.skipped`. |
| A conflict where the source's change adds or removes a section break | The page's version, no markers. Counts in `report.skipped`. |
| Both inserted at one spot, and one insert holds a section break | The page's version, no markers. Counts in `report.skipped`. |
| New source units would land before the page's first section | The page's version, no markers. Counts in `report.skipped`. |

- Every group has reason `both-changed`.
- Markers stay inside the page's existing `main > div` sections. Section breaks are never marked. A group never spans a section break.
- A conflict that touches an open group keeps the page as it is there, and counts in `report.skipped`.
- Each source change is offered once: the next baseline holds it.

## Merge rules

The other rules come from da-nx: [smart overwrite](https://github.com/adobe/da-nx/blob/main/docs/rollout-smart-overwrite.md) and [loc copy](https://github.com/adobe/da-nx/blob/main/docs/loc-copy.md).

## Tests

```bash
npm test
```

The same tests run in Chrome and in Node.js with linkedom.

The resolve tests need diff markup v2 in da-parser ([adobe/da-tools#48](https://github.com/adobe/da-tools/pull/48)). Until it is released, they use a copy of its parser in `test/mocks/da-parser-v2` (`f10d615`).
