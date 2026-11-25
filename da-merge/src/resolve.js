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
import { ACCEPTED_KEY, REJECTED_KEY } from './hashes.js';
import { SIDE, diffSummary } from './markup.js';
import {
  groupBlocks, isNotEmptyParagraphEl, reviewHash, sectionBlock,
} from './block-hash.js';

export const CHOICE = Object.freeze({
  source: 'source', mine: 'mine', both: 'both', neither: 'neither',
});

export const HASHES_META = 'daMerge/hashes';

const SIDE_OF_TYPE = { diff_deleted: SIDE.source, diff_added: SIDE.local };
const LISTS = ['bullet_list', 'ordered_list'];

const isMarker = (node) => !!SIDE_OF_TYPE[node.type.name];
const isBase = (node) => node.type.name === 'diff_base';
const isListItem = (node) => node.type.name === 'list_item';
const isList = (node) => LISTS.includes(node.type.name);

function collect(doc, { marker, base }) {
  const markers = [];
  const bases = [];
  doc.descendants((node, pos) => {
    if (isMarker(node)) {
      if (marker(node)) markers.push({ node, pos, side: SIDE_OF_TYPE[node.type.name] });
      return false;
    }
    if (isBase(node)) {
      if (base(node)) bases.push({ node, pos });
      return false;
    }
    return true;
  });
  return { markers, bases };
}

/**
 * Diff groups of a document, in document order. Markers without a group are left out.
 * @returns {{ id: String, markers: { node, pos: Number, side: String }[],
 *   bases: { node, pos: Number }[] }[]}
 */
export function groups(doc) {
  const { markers, bases } = collect(doc, {
    marker: (node) => !!node.attrs.diffGroup, base: (node) => !!node.attrs.diffGroup,
  });
  const byId = new Map();
  markers.forEach((entry) => {
    const id = entry.node.attrs.diffGroup;
    if (!byId.has(id)) byId.set(id, { id, markers: [], bases: [] });
    byId.get(id).markers.push(entry);
  });
  bases.forEach((entry) => byId.get(entry.node.attrs.diffGroup)?.bases.push(entry));
  return [...byId.values()];
}

export function findGroup(doc, id) {
  const ofGroup = (node) => node.attrs.diffGroup === id;
  return { id, ...collect(doc, { marker: ofGroup, base: ofGroup }) };
}

function keysOf(metadata) {
  if (metadata.keys) return [...metadata.keys()];
  const keys = [];
  metadata.forEach((_, key) => keys.push(key));
  return keys;
}

const splitHashes = (value) => (value ? String(value).split(',') : [])
  .map((hash) => hash.trim()).filter(Boolean);

/**
 * Adds accepted and rejected review hashes to a page's metadata.
 * @param {Map|Object} metadata Map-like (get, set, and keys or forEach): a Y.Map or a Map
 * @param {{ accepted?: String[], rejected?: String[] }} hashes
 * @param {{ transact?: Function }} [options] runs the writes, for example in one Yjs transaction
 */
export function recordHashes(metadata, { accepted = [], rejected = [] } = {}, { transact } = {}) {
  const keys = keysOf(metadata);
  const writes = [[ACCEPTED_KEY, accepted], [REJECTED_KEY, rejected]].map(([key, hashes]) => {
    const name = keys.find((existing) => existing.toLowerCase() === key.toLowerCase()) ?? key;
    const current = splitHashes(metadata.get(name));
    const next = [...new Set([...current, ...hashes])];
    return next.length === current.length ? null : [name, next.join(',')];
  }).filter(Boolean);
  if (!writes.length) return;
  const write = () => writes.forEach(([name, value]) => metadata.set(name, value));
  if (transact) transact(write);
  else write();
}

const cleanAttrs = (node) => (node.attrs.daDiffAdded != null
  ? { ...node.attrs, daDiffAdded: null } : node.attrs);

function strip(node) {
  if (node.isText) return node;
  const children = [];
  node.content.forEach((child) => children.push(strip(child)));
  const changed = children.some((child, idx) => child !== node.child(idx));
  const attrs = cleanAttrs(node);
  if (!changed && attrs === node.attrs) return node;
  return node.type.create(attrs, changed ? children : node.content, node.marks);
}

const childrenOf = (node) => {
  const children = [];
  node.content.forEach((child) => children.push(strip(child)));
  return children;
};

// List items outside a list (a marker can hold them at section level) go into a bullet list.
function inParent(children, parent) {
  if (isList(parent) || !children.some(isListItem)) return children;
  const list = parent.type.schema.nodes.bullet_list;
  return children.reduce((acc, child) => {
    const prev = acc[acc.length - 1];
    if (!isListItem(child)) return [...acc, child];
    if (prev?.type !== list) return [...acc, list.create(null, [child])];
    return [...acc.slice(0, -1), list.create(null, [...childrenOf(prev), child])];
  }, []);
}

function keeps(choice, side) {
  if (!Object.values(CHOICE).includes(choice)) throw new TypeError(`Unknown choice: ${choice}`);
  if (choice === CHOICE.both) return true;
  if (choice === CHOICE.neither) return false;
  return (choice === CHOICE.mine) === (side === SIDE.local);
}

function drop(tr, node, pos) {
  const $pos = tr.doc.resolve(pos);
  const { parent, depth } = $pos;
  if (isListItem(parent) && parent.childCount === 1 && depth > 1) {
    const list = $pos.node(depth - 1);
    const at = list.childCount === 1 ? depth - 1 : depth;
    tr.delete($pos.before(at), $pos.after(at));
  } else if (isList(parent) && parent.childCount === 1 && depth > 0) {
    tr.delete($pos.before(), $pos.after());
  } else {
    tr.delete(pos, pos + node.nodeSize);
  }
}

function keep(tr, node, pos) {
  if (!node.content.size) {
    drop(tr, node, pos);
    return;
  }
  tr.replaceWith(pos, pos + node.nodeSize, inParent(childrenOf(node), tr.doc.resolve(pos).parent));
}

export default function createResolve({ DOMParser, aem2doc, doc2aem }) {
  const parser = new DOMParser();
  const parse = (html) => parser.parseFromString(/<html[\s>]/i.test(html) ? html : `<html>${html}</html>`, 'text/html');

  function unitsOf(doc, { node, pos }) {
    const $pos = doc.resolve(pos);
    const { parent } = $pos;
    const content = childrenOf(node);
    if (isListItem(parent) && $pos.depth > 1) {
      const items = [];
      parent.forEach((child, _, idx) => {
        if (idx === $pos.index()) items.push(...content);
        else items.push(strip(child));
      });
      const list = $pos.node($pos.depth - 1);
      const item = parent.type.create(cleanAttrs(parent), items);
      return { items: true, nodes: [list.type.create(cleanAttrs(list), [item])] };
    }
    if (isList(parent)) {
      return { items: true, nodes: [parent.type.create(cleanAttrs(parent), content)] };
    }
    const nodes = inParent(content, parent);
    return { items: nodes.some(isList) && nodes.length === 1 && content.every(isListItem), nodes };
  }

  function unitHashes(doc, marker, hashing) {
    const { items, nodes } = unitsOf(doc, marker);
    const unitDoc = doc.type.create(null, nodes);
    const main = parse(doc2aem(unitDoc)).querySelector('main');
    const sections = [...(main?.querySelectorAll(':scope > div') || [])];
    if (items) {
      return sections.flatMap((section) => [...section.querySelectorAll(':scope > ul > li, :scope > ol > li')])
        .map((li) => reviewHash(li, hashing));
    }
    const blocks = sections.reduce((acc, section) => [
      ...acc,
      ...(acc.length ? [sectionBlock] : []),
      ...[...section.children].filter(isNotEmptyParagraphEl),
    ], []);
    return groupBlocks(blocks)
      .filter((block) => !block.isSection)
      .map((block) => reviewHash(block, hashing));
  }

  function apply({
    state, markers, bases, choice, metadata, transact, site, config,
  }) {
    if (!state.schema.nodes.diff_added) {
      throw new TypeError('resolve needs a schema with diff markup nodes (diff_added, diff_deleted)');
    }
    const steps = markers.map((entry) => ({ ...entry, keep: keeps(choice, entry.side) }));
    if (!steps.length && !bases.length) return null;
    const accepted = new Set();
    const rejected = new Set();
    steps.forEach((step) => {
      const hashes = unitHashes(state.doc, step, { site, config });
      hashes.forEach((hash) => (step.keep ? accepted : rejected).add(hash));
    });
    const { tr } = state;
    [...steps, ...bases].sort((a, b) => b.pos - a.pos).forEach((step) => {
      const { pos, deleted } = tr.mapping.mapResult(step.pos);
      const node = !deleted && tr.doc.nodeAt(pos);
      if (node?.type !== step.node.type) return;
      if (step.keep) keep(tr, node, pos);
      else drop(tr, node, pos);
    });
    const hashes = { accepted: [...accepted], rejected: [...rejected] };
    tr.setMeta?.(HASHES_META, hashes);
    if (metadata) recordHashes(metadata, hashes, { transact });
    return tr;
  }

  /**
   * Resolves one diff group: every marker of the group and its base.
   * @returns {Object|null} the transaction to dispatch, or null when the group isn't there
   */
  function resolve({
    state, groupId, choice, ...options
  }) {
    const { markers, bases } = findGroup(state.doc, groupId);
    return apply({
      state, markers, bases: markers.length ? bases : [], choice, ...options,
    });
  }

  function resolveAll({ state, choice, ...options }) {
    const { markers, bases } = collect(state.doc, { marker: () => true, base: () => true });
    return apply({
      state, markers, bases, choice, ...options,
    });
  }

  // Markers at the given positions: a legacy single marker or pair.
  function resolveMarkers({
    state, positions, choice, ...options
  }) {
    const at = new Set(positions);
    const { markers } = collect(state.doc, { marker: () => true, base: () => false });
    const targets = markers.filter(({ pos }) => at.has(pos));
    const touched = new Set(targets.map(({ node }) => node.attrs.diffGroup).filter(Boolean));
    const open = new Set(markers.filter(({ pos }) => !at.has(pos))
      .map(({ node }) => node.attrs.diffGroup).filter(Boolean));
    const { bases } = collect(state.doc, {
      marker: () => false,
      base: (node) => touched.has(node.attrs.diffGroup) && !open.has(node.attrs.diffGroup),
    });
    return apply({
      state, markers: targets, bases, choice, ...options,
    });
  }

  const reviewSummary = (doc) => diffSummary(parse(doc2aem(doc)));

  function resolvePage(html, run, options) {
    const { state, metadata } = aem2doc(html);
    const tr = run({ state, metadata, ...options });
    return tr ? doc2aem(tr.doc, metadata) : null;
  }

  const resolveHtml = (html, groupId, choice, options = {}) => resolvePage(
    html,
    (args) => resolve({ ...args, groupId, choice }),
    options,
  );

  const resolveAllHtml = (html, choice, options = {}) => resolvePage(
    html,
    (args) => resolveAll({ ...args, choice }),
    options,
  );

  return {
    resolve, resolveAll, resolveMarkers, reviewSummary, resolveHtml, resolveAllHtml,
  };
}
