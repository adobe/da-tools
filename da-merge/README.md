# DA Merge

The merge engine for DA copies (loc and MSM). It compares a source page with a target page and writes the result as page HTML, with diff markup where an author must review a change.

It does not read or write DA. The caller reads the pages, calls the engine, and saves the result.

## Install

```bash
npm install @adobe/da-merge
```

## Create an engine

The engine works on DOM documents. Pass in the DOM implementation once, when you create it.

In the browser:

```javascript
import DaMerge from '@adobe/da-merge';

const merge = new DaMerge({ DOMParser, Node, document });
```

In a worker or Node.js, use [linkedom](https://github.com/WebReflection/linkedom):

```javascript
import { parseHTML } from 'linkedom';
import DaMerge from '@adobe/da-merge';

const { DOMParser, Node, document } = parseHTML('<!DOCTYPE html><html><body></body></html>');
const merge = new DaMerge({ DOMParser, Node, document });
```

## Use it

```javascript
const source = merge.parse(sourceHtml);
const target = merge.parse(targetHtml);

// Merge: mark every difference for review.
const main = await merge.regionalDiff(source, target, acceptedHashes, rejectedHashes, { site, config });

// Smart overwrite: a 3-way merge against the baseline in the target's rolloutbase.
const result = await merge.smartRollout({
  source, dest: target, destHtml, destMarked, empty, path, site, config,
});
```

`parse` accepts a full HTML document or a body-only DA page.

### Instance methods

| Method | Does |
|---|---|
| `parse(html)` | Parses HTML into a document |
| `regionalDiff(source, target, accepted, rejected, options)` | 2-way merge with diff markup |
| `smartMerge({ base, source, dest, rejected, site, config })` | 3-way merge of blocks against a baseline |
| `smartRollout({ source, dest, ... })` | Smart-overwrite: picks a copy, a 3-way merge, or a first merge |
| `getBlockHashes({ doc, site, config })` | Block hashes, as stored in `rolloutbase` |
| `getContentHashes({ doc, site, config })` | Block hashes without section breaks |
| `removeRejectedBlocks({ doc, rejected, site, config })` | A copy of the document without rejected blocks |
| `normalizeLinks(doc, site, equivalentSites)` | Rewrites preview and live links to one site |
| `getSectionedMain(doc)` | `main`, or `null` when it holds content outside `main > div` |

### Other exports

These need no DOM implementation: `removeLocTags`, `LOC_MARKERS`, `isSnapshotPath`, `threeWayMerge`, `getElementMetadata`, `readMetadata`, `getRolloutBase`, `formatRolloutBase`, `formatRolloutOrder`, `readRolloutOrder`, `isEmptyMain`, `withMetadataRow`, `withBaselineRow`, `countLocalBlocks`, the hash helpers (`hashContent`, `getDiffHash`, `HASH_LENGTH`), and the metadata keys (`ROLLOUT_BASE_KEY`, `ROLLOUT_ORDER_KEY`, `ACCEPTED_KEY`, `REJECTED_KEY`, `REVIEW_KEYS`, `DA_METADATA_SELECTOR`).

## Merge rules

The rules come from da-nx: [smart overwrite](https://github.com/adobe/da-nx/blob/main/docs/rollout-smart-overwrite.md) and [loc copy](https://github.com/adobe/da-nx/blob/main/docs/loc-copy.md).

## Tests

```bash
npm test
```

The same tests run in Chrome and in Node.js with linkedom.
