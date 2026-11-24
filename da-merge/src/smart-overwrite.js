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
import getElementMetadata from './metadata.js';
import { LOC_MARKERS, isSnapshotPath, removeLocTags } from './regional-diff.js';
import { REASON } from './markup.js';
import { ROLLOUT_BASE_KEY, ROLLOUT_ORDER_KEY, getDiffHash } from './hashes.js';

export const DA_METADATA_SELECTOR = 'body > .da-metadata';
const EMPTY_TAGS = new Set(['DIV', 'P', 'BR']);
export const MAX_UNITS = 2000;

const toBasePath = (path) => path.toLowerCase();

// Keeps metadata values exactly as authored (getElementMetadata's `text` is lowercased).
export const readMetadata = (el) => Object.fromEntries(Object.entries(getElementMetadata(el))
  .map(([key, { content }]) => [key, content.innerHTML]));

export function getRolloutBase(metadataEl, path) {
  const value = getElementMetadata(metadataEl)[ROLLOUT_BASE_KEY]?.content.textContent.trim();
  const parts = value?.split('|') || [];
  if (parts.length !== 2) return null;
  const [basePath, hashes] = parts;
  if (toBasePath(basePath) !== toBasePath(path)) return null;
  const list = hashes ? hashes.split(',') : [];
  return list.every((hash) => /^[0-9a-f]{12}$/.test(hash)) ? list : null;
}

export const formatRolloutBase = (path, hashes) => `${toBasePath(path)}|${hashes.join(',')}`;

// Fingerprint of the blocks upstream swapped, so an unchanged reorder is listed once.
export const formatRolloutOrder = (path, hashes) => `${toBasePath(path)}|${getDiffHash(hashes.join(','))}`;

export const readRolloutOrder = (metadataEl) => getElementMetadata(metadataEl)[ROLLOUT_ORDER_KEY]
  ?.content.textContent.trim();

export const isEmptyMain = (main) => !main.textContent.trim()
  && [...main.querySelectorAll('*')].every((el) => EMPTY_TAGS.has(el.nodeName) && !el.attributes.length);

export const REVIEW_KEYS = ['acceptedhashes', 'rejectedhashes'];

const getRejected = (el) => (getElementMetadata(el).rejectedhashes?.text || '')
  .split(',').map((hash) => hash.trim()).filter(Boolean);

export function withMetadataRow(doc, { key, value, dropKeys = [] }) {
  const page = doc.cloneNode(true);
  let metadata = page.querySelector(DA_METADATA_SELECTOR);
  if (!metadata && value) {
    metadata = page.createElement('div');
    metadata.className = 'da-metadata';
    page.body.insertBefore(metadata, page.querySelector('body > footer'));
  }
  const removed = [key, ...dropKeys];
  [...metadata?.children || []]
    .filter((el) => removed.includes(el.children[0]?.textContent.trim().toLowerCase()))
    .forEach((el) => el.remove());
  if (value) {
    const row = page.createElement('div');
    row.append(page.createElement('div'), page.createElement('div'));
    row.firstElementChild.textContent = key;
    row.lastElementChild.textContent = value;
    metadata.append(row);
  }
  if (!doc.sourceShape?.html && !doc.head?.childNodes.length) return page.body.outerHTML;
  const doctype = doc.sourceShape?.doctype ? '<!DOCTYPE html>\n' : '';
  return `${doctype}${page.documentElement.outerHTML}`;
}

// A new sync point also drops the recorded upstream order, which only described the old one.
export const withBaselineRow = (doc, value, { dropKeys = [] } = {}) => withMetadataRow(doc, {
  key: ROLLOUT_BASE_KEY, value, dropKeys: [ROLLOUT_ORDER_KEY, ...dropKeys],
});

// Destination blocks with no matching upstream block (repeated blocks are matched one for one).
export function countLocalBlocks(sourceHashes, destHashes) {
  const available = new Map();
  sourceHashes.forEach((hash) => available.set(hash, (available.get(hash) || 0) + 1));
  return destHashes.filter((hash) => {
    const left = available.get(hash) || 0;
    available.set(hash, left - 1);
    return left <= 0;
  }).length;
}

export default function createSmartOverwrite({ Node, regional }) {
  const {
    regionalDiff, getBlockHashes, smartMerge, removeRejectedBlocks,
  } = regional;

  // Block extraction only reads `main > div` sections; anything else would be silently dropped.
  function getSectionedMain(doc) {
    const main = doc?.querySelectorAll('main').length === 1 && doc.querySelector('body > main');
    const isText = (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim();
    const isLoose = (node) => isText(node)
      || (node.nodeType === Node.ELEMENT_NODE && (node.nodeName !== 'DIV' || [...node.childNodes].some(isText)));
    return main && ![...main.childNodes].some(isLoose) ? main : null;
  }

  // An emptied page keeps its merge review decisions: rejected blocks stay out of the copy.
  async function copySource({
    source, site, config, destMetadataEl,
  }) {
    const rejected = getRejected(destMetadataEl);
    const copy = await removeRejectedBlocks({
      doc: source, rejected, site, config,
    });
    const html = copy.querySelector('main').innerHTML;
    const daMetadata = readMetadata(source.querySelector(DA_METADATA_SELECTOR));
    const destMetadata = readMetadata(destMetadataEl);
    REVIEW_KEYS.forEach((key) => {
      if (destMetadata[key]) daMetadata[key] = destMetadata[key];
      else delete daMetadata[key];
    });
    const sourceHashes = await getBlockHashes({ doc: copy, site, config });
    return { html, skipped: 0, sourceHashes, daMetadata };
  }

  async function mergeReview({
    source, dest, metadataEl, site, config, sourceHashes, reason,
  }) {
    const unmarked = dest.cloneNode(true);
    removeLocTags(unmarked);
    const reviewed = getElementMetadata(metadataEl);
    const accepted = reviewed.acceptedhashes?.text?.split(',') || [];
    const rejected = getRejected(metadataEl);
    const diffed = await regionalDiff(source, unmarked, accepted, rejected, {
      site, config, reason,
    });
    return {
      html: diffed.innerHTML,
      skipped: 0,
      sourceHashes,
      review: !!diffed.querySelector(LOC_MARKERS),
      reason,
    };
  }

  // No valid baseline yet: today's merge, so the author reviews every difference once.
  async function firstRollout({
    source, dest, metadataEl, site, config,
  }) {
    const sourceHashes = await getBlockHashes({ doc: source, site, config });
    if (!dest.querySelector(LOC_MARKERS)) {
      const destHashes = await getBlockHashes({ doc: dest, site, config });
      if (sourceHashes.join() === destHashes.join()) {
        return { html: dest.querySelector('body > main').innerHTML, skipped: 0, sourceHashes };
      }
    }
    return mergeReview({
      source, dest, metadataEl, site, config, sourceHashes, reason: REASON.noBaseline,
    });
  }

  async function smartRollout({
    source, dest, path, site, config, baselineDoc = null, maxUnits = MAX_UNITS,
    snapshot = isSnapshotPath(path),
  }) {
    if (!dest) return copySource({ source, site, config });
    const metadataEl = dest.querySelector(DA_METADATA_SELECTOR);
    const daMetadata = readMetadata(metadataEl);
    // A snapshot never merges against a sync point: it only keeps the live page's.
    const base = !snapshot && getRolloutBase(metadataEl, path);
    if (base) {
      const sourceHashes = await getBlockHashes({ doc: source, site, config });
      if (sourceHashes.join() === base.join()) return { unchanged: true, reordered: false };
      const destHashes = await getBlockHashes({ doc: dest, site, config });
      if (Math.max(sourceHashes.length, destHashes.length) > maxUnits) {
        const merged = await mergeReview({
          source, dest, metadataEl, site, config, sourceHashes, reason: REASON.pageTooLarge,
        });
        return { ...merged, reordered: false, daMetadata };
      }
      const merged = await smartMerge({
        base, source, dest, rejected: getRejected(metadataEl), site, config, baselineDoc,
      });
      const orders = {
        reordered: merged.reordered,
        order: formatRolloutOrder(path, merged.swaps),
        seenOrder: formatRolloutOrder(path, merged.swapsAsBase),
      };
      if (merged.sourceHashes.join() === base.join()) return { unchanged: true, ...orders };
      return { ...merged, ...orders, daMetadata };
    }
    const main = getSectionedMain(dest);
    if (main && isEmptyMain(main)) {
      return copySource({
        source, site, config, destMetadataEl: metadataEl,
      });
    }
    const merged = await firstRollout({
      source, dest, metadataEl, site, config,
    });
    return { ...merged, daMetadata };
  }

  return { getSectionedMain, smartRollout };
}
