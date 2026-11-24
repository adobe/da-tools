/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { LOC_MARKERS, isSnapshotPath, removeLocTags } from './regional-diff.js';
import {
  DA_METADATA_SELECTOR, REVIEW_KEYS, MAX_UNITS, readMetadata, getRolloutBase, formatRolloutBase,
  readRolloutOrder, isEmptyMain, withMetadataRow, withBaselineRow, countLocalBlocks,
} from './smart-overwrite.js';
import { ROLLOUT_BASE_KEY, ROLLOUT_ORDER_KEY } from './hashes.js';
import getElementMetadata from './metadata.js';
import { BASE_TAG, REASON, diffSummary } from './markup.js';

export const BEHAVIORS = ['overwrite', 'merge', 'smart-overwrite', 'create-only'];

export const OUTCOME = {
  written: 'written',
  unchanged: 'unchanged',
  skipped: 'skipped',
  needsReview: 'needs-review',
};

const LABEL_KEYS = { local: 'diff-label-local', upstream: 'diff-label-upstream' };
const STORED_HASH_KEYS = ['acceptedhashes', 'rejectedhashes'];

export function toPageHtml(main, metadata = {}) {
  const rows = Object.entries(metadata)
    .map(([key, value]) => `<div><div>${key}</div><div>${value ?? ''}</div></div>`).join('');
  const metadataHtml = rows ? `\n  <div class="da-metadata">${rows}</div>\n` : '';
  return `
      <body>
        <header></header>
        <main>${main}</main>
        ${metadataHtml}<footer></footer>
      </body>
    `;
}

const mainHtml = (doc) => doc.querySelector('body > main')?.innerHTML ?? '';
const collapsed = (html) => html.replace(/\s+/g, ' ');

function withLabels(metadata, labels = {}) {
  Object.entries(LABEL_KEYS).forEach(([side, key]) => {
    if (labels[side]) metadata[key] = labels[side];
  });
  return metadata;
}

function dropOrphanBases(doc) {
  doc.querySelectorAll(BASE_TAG).forEach((base) => {
    const id = base.getAttribute('data-diff-group');
    if (!id || !doc.querySelector(`[data-diff-group="${id}"]:not(${BASE_TAG})`)) base.remove();
  });
}

function setMetadataText(doc, key, value) {
  const rows = [...doc.querySelectorAll(`${DA_METADATA_SELECTOR} > div`)];
  const row = rows.find((el) => el.children[0]?.textContent.trim().toLowerCase() === key);
  if (row?.children[1]) row.children[1].textContent = value;
}

export default function createApplyCopy({
  parse, canonicalize, regional, smart,
}) {
  const {
    regionalDiff, getBlockHashes, getContentHashes, getReviewHashes,
  } = regional;
  const { getSectionedMain, smartRollout } = smart;

  const toDoc = (html) => parse(canonicalize(html));

  function legacyMap(raw, canonical) {
    const map = new Map();
    if (raw.length !== canonical.length) return map;
    raw.forEach((hash, idx) => {
      if (hash && canonical[idx] && hash !== canonical[idx]) map.set(hash, canonical[idx]);
    });
    return map;
  }

  async function hashPairs({ raw, canonical }, hashing) {
    const pair = async (getHashes) => {
      const canonicalHashes = await getHashes({ doc: canonical, ...hashing });
      const rawHashes = await getHashes({ doc: raw, ...hashing });
      return { known: new Set(canonicalHashes), legacy: legacyMap(rawHashes, canonicalHashes) };
    };
    return { block: await pair(getBlockHashes), review: await pair(getReviewHashes) };
  }

  async function remapStoredHashes({ docs, target, path, hashing }) {
    const hashSets = await Promise.all(docs.map((doc) => hashPairs(doc, hashing)));
    const lookup = (kind, hash) => {
      if (hashSets.some((set) => set[kind].known.has(hash))) return null;
      return hashSets.map((set) => set[kind].legacy.get(hash)).find(Boolean);
    };
    let remapped = 0;
    const remap = (kind) => (hash) => {
      const found = lookup(kind, hash);
      if (!found) return hash;
      remapped += 1;
      return found;
    };
    const metadata = getElementMetadata(target.querySelector(DA_METADATA_SELECTOR));
    const base = metadata[ROLLOUT_BASE_KEY]?.content.textContent.trim();
    if (base && getRolloutBase(target.querySelector(DA_METADATA_SELECTOR), path)) {
      const [basePath, hashes] = base.split('|');
      const remappedBase = hashes.split(',').map(remap('block')).join(',');
      setMetadataText(target, ROLLOUT_BASE_KEY, `${basePath}|${remappedBase}`);
    }
    STORED_HASH_KEYS.forEach((key) => {
      const value = metadata[key]?.content.textContent.trim();
      if (value) setMetadataText(target, key, value.split(',').map(remap('review')).join(','));
    });
    return remapped;
  }

  async function countUnits({
    html, sourceHashes, base, hashing,
  }) {
    const doc = parse(html);
    removeLocTags(doc);
    const hashes = await getContentHashes({ doc, ...hashing });
    const sourceSet = new Set(sourceHashes);
    const baseSet = new Set(base);
    return {
      applied: hashes.filter((hash) => sourceSet.has(hash) && !baseSet.has(hash)).length,
      keptLocal: hashes.filter((hash) => !sourceSet.has(hash)).length,
    };
  }

  function finish({
    html, outcome, reason = null, baseline = null, counts = {}, extra = {},
  }) {
    const summary = html ? diffSummary(parse(html)) : { groups: [] };
    const needsReview = summary.groups.length;
    const marked = !!html && !!parse(html).querySelector(LOC_MARKERS);
    const finalOutcome = outcome === OUTCOME.written && marked ? OUTCOME.needsReview : outcome;
    return {
      html,
      baseline,
      report: {
        outcome: finalOutcome,
        reason,
        counts: {
          applied: 0, keptLocal: 0, ...counts, needsReview,
        },
        groups: summary.groups.map(({
          id, reason: groupReason, sides, kinds,
        }) => ({
          id, reason: groupReason, sides, kinds,
        })),
        skipped: 0,
        removedUpstream: 0,
        reordered: false,
        baselineContent: 'n/a',
        legacyHashes: 0,
        ...extra,
      },
    };
  }

  async function overwrite({
    source, path, recordBaseline, labels, hashing, reason = null,
  }) {
    const copy = source.cloneNode(true);
    removeLocTags(copy);
    const metadata = readMetadata(copy.querySelector(DA_METADATA_SELECTOR));
    [...REVIEW_KEYS, ROLLOUT_BASE_KEY, ROLLOUT_ORDER_KEY].forEach((key) => delete metadata[key]);
    let baseline = null;
    let fallback = reason;
    if (recordBaseline && !isSnapshotPath(path)) {
      if (getSectionedMain(copy)) {
        baseline = formatRolloutBase(path, await getBlockHashes({ doc: copy, ...hashing }));
        metadata[ROLLOUT_BASE_KEY] = baseline;
      } else {
        fallback = REASON.noSyncPoint;
      }
    }
    const html = toPageHtml(mainHtml(copy), withLabels(metadata, labels));
    const applied = (await getContentHashes({ doc: copy, ...hashing })).length;
    return finish({
      html, outcome: OUTCOME.written, reason: fallback, baseline, counts: { applied },
    });
  }

  async function merge({
    source, target, path, recordBaseline, labels, hashing, normalizeImages, reason, extra,
  }) {
    const hadMarkup = !!target.querySelector(LOC_MARKERS);
    const unmarked = target.cloneNode(true);
    const cleanSource = source.cloneNode(true);
    removeLocTags(unmarked);
    removeLocTags(cleanSource);
    const metadataEl = target.querySelector(DA_METADATA_SELECTOR);
    const sectioned = !!getSectionedMain(cleanSource);
    const record = recordBaseline && !isSnapshotPath(path);
    const baseline = record && sectioned
      ? formatRolloutBase(path, await getBlockHashes({ doc: cleanSource, ...hashing }))
      : null;
    const fallback = reason ?? (record && !sectioned ? REASON.noSyncPoint : null);
    const same = record
      ? !hadMarkup && collapsed(mainHtml(cleanSource)) === collapsed(mainHtml(unmarked))
      : cleanSource.body.outerHTML === unmarked.body.outerHTML;
    if (same) {
      const current = readMetadata(metadataEl)[ROLLOUT_BASE_KEY];
      const html = record && (baseline ?? undefined) !== current
        ? withBaselineRow(target, baseline) : null;
      return finish({
        html, outcome: OUTCOME.unchanged, reason: fallback, baseline, extra,
      });
    }
    const stored = getElementMetadata(metadataEl);
    const list = (key) => stored[key]?.text?.split(',').map((hash) => hash.trim()).filter(Boolean) || [];
    const diffed = await regionalDiff(cleanSource, unmarked, list('acceptedhashes'), list('rejectedhashes'), {
      ...hashing,
      normalizeImages,
      reason: fallback ?? (hadMarkup ? REASON.reviewingOpenMarkup : REASON.differs),
    });
    const metadata = readMetadata(metadataEl);
    delete metadata[ROLLOUT_ORDER_KEY];
    if (baseline) metadata[ROLLOUT_BASE_KEY] = baseline;
    else delete metadata[ROLLOUT_BASE_KEY];
    const html = toPageHtml(diffed.innerHTML, withLabels(metadata, labels));
    return finish({
      html, outcome: OUTCOME.written, reason: fallback, baseline, extra,
    });
  }

  async function smartOverwrite({
    source, target, path, labels, hashing, normalizeImages, baselineHtml, maxUnits, extra,
  }) {
    const unsectioned = !getSectionedMain(source) || (target && !getSectionedMain(target));
    if (unsectioned) {
      if (!target) {
        return overwrite({
          source, path, labels, hashing, reason: REASON.noSyncPoint,
        });
      }
      return merge({
        source, target, path, labels, hashing, normalizeImages, reason: REASON.noSyncPoint, extra,
      });
    }
    const cleanSource = source.cloneNode(true);
    removeLocTags(cleanSource);
    const metadataEl = target?.querySelector(DA_METADATA_SELECTOR);
    const destMetadata = readMetadata(metadataEl);
    const keptBase = destMetadata[ROLLOUT_BASE_KEY];
    const keptOrder = readRolloutOrder(metadataEl);
    const baselineDoc = baselineHtml ? toDoc(baselineHtml) : null;
    const result = await smartRollout({
      source: cleanSource, dest: target, path, ...hashing, baselineDoc, maxUnits,
    });
    const newlyReordered = !!result.reordered && result.seenOrder !== keptOrder;
    const reportExtra = {
      ...extra,
      skipped: result.skipped || 0,
      removedUpstream: result.removedUpstream || 0,
      reordered: newlyReordered,
    };
    if (result.unchanged) {
      const value = result.reordered ? result.order : null;
      const html = (value ?? undefined) === keptOrder
        ? null : withMetadataRow(target, { key: ROLLOUT_ORDER_KEY, value });
      return finish({
        html, outcome: OUTCOME.unchanged, baseline: keptBase ?? null, extra: reportExtra,
      });
    }
    const metadata = result.daMetadata;
    let baseline = keptBase ?? null;
    if (!isSnapshotPath(path)) {
      baseline = formatRolloutBase(path, result.sourceHashes);
      metadata[ROLLOUT_BASE_KEY] = baseline;
      if (result.reordered) metadata[ROLLOUT_ORDER_KEY] = result.order;
      else delete metadata[ROLLOUT_ORDER_KEY];
    } else {
      if (keptBase) metadata[ROLLOUT_BASE_KEY] = keptBase;
      else delete metadata[ROLLOUT_BASE_KEY];
      if (keptOrder) metadata[ROLLOUT_ORDER_KEY] = destMetadata[ROLLOUT_ORDER_KEY];
      else delete metadata[ROLLOUT_ORDER_KEY];
    }
    const html = toPageHtml(result.html, withLabels(metadata, labels));
    const base = getRolloutBase(metadataEl, path) || [];
    const counts = await countUnits({
      html, sourceHashes: result.sourceHashes, base, hashing,
    });
    const hasGroups = !!parse(html).querySelector('[data-diff-group]');
    let baselineContent = 'n/a';
    if (hasGroups && result.reason !== REASON.noBaseline) {
      baselineContent = parse(html).querySelector(BASE_TAG) ? 'embedded' : 'missing';
    }
    return finish({
      html,
      outcome: OUTCOME.written,
      reason: result.reason ?? null,
      baseline,
      counts,
      extra: { ...reportExtra, baselineContent },
    });
  }

  async function applyCopy({
    source, target = null, behavior, path, site, config, equivalentSites = [], recordBaseline,
    labels = {}, baselineHtml = null, normalizeImages, maxUnits = MAX_UNITS,
  }) {
    if (!BEHAVIORS.includes(behavior)) throw new TypeError(`Unknown behavior: ${behavior}`);
    if (typeof source !== 'string' || !path) throw new TypeError('applyCopy requires source HTML and a path');
    if (behavior !== 'smart-overwrite' && typeof recordBaseline !== 'boolean') {
      throw new TypeError(`applyCopy requires recordBaseline for ${behavior}`);
    }
    const hashing = { site, config: { ...config, equivalentSites } };
    const sourceDoc = toDoc(source);
    const targetDoc = target ? toDoc(target) : null;
    let legacyHashes = 0;
    if (targetDoc) {
      dropOrphanBases(targetDoc);
      legacyHashes = await remapStoredHashes({
        docs: [
          { raw: parse(source), canonical: sourceDoc },
          { raw: parse(target), canonical: targetDoc },
        ],
        target: targetDoc,
        path,
        hashing,
      });
    }
    const extra = { legacyHashes };
    const targetMain = targetDoc && getSectionedMain(targetDoc);
    const missing = !targetDoc || (targetMain && isEmptyMain(targetMain));
    const options = {
      source: sourceDoc, target: targetDoc, path, recordBaseline, labels, hashing, normalizeImages,
    };
    if (behavior === 'smart-overwrite') {
      return smartOverwrite({
        ...options, baselineHtml, maxUnits, extra,
      });
    }
    if (behavior === 'create-only' && targetDoc) {
      return finish({ html: null, outcome: OUTCOME.skipped, reason: 'exists' });
    }
    if (behavior === 'merge' && !missing) return merge({ ...options, extra });
    const written = await overwrite(options);
    return { ...written, report: { ...written.report, ...extra } };
  }

  async function markInSync({
    source, target, path, site, config, equivalentSites = [], dryRun = false,
  }) {
    if (!path.toLowerCase().endsWith('.html')) return { sync: 'sheet' };
    if (isSnapshotPath(path)) return { sync: 'snapshot' };
    if (!target) return { sync: 'missing' };
    const hashing = { site, config: { ...config, equivalentSites } };
    const targetDoc = parse(target);
    const main = getSectionedMain(targetDoc);
    if (!main) throw new Error('Unexpected destination content');
    if (isEmptyMain(main)) return { sync: 'missing' };
    if (targetDoc.querySelector(LOC_MARKERS)) return { sync: 'unresolved' };
    if (getRolloutBase(targetDoc.querySelector(DA_METADATA_SELECTOR), path)) return { sync: 'in-sync' };
    const sourceDoc = toDoc(source);
    if (!getSectionedMain(sourceDoc)) throw new Error('Source content not found or malformed');
    removeLocTags(sourceDoc);
    if (dryRun) {
      const differences = countLocalBlocks(
        await getContentHashes({ doc: sourceDoc, ...hashing }),
        await getContentHashes({ doc: toDoc(target), ...hashing }),
      );
      return { sync: 'to-mark', differences };
    }
    const baseline = formatRolloutBase(path, await getBlockHashes({ doc: sourceDoc, ...hashing }));
    return { sync: 'marked', baseline, html: withBaselineRow(targetDoc, baseline) };
  }

  return { applyCopy, markInSync };
}
