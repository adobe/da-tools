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

export const ADDED_TAG = 'da-diff-added';
export const DELETED_TAG = 'da-diff-deleted';
export const BASE_TAG = 'da-diff-base';

export const SIDE = { source: 'source', local: 'local' };
export const KIND = { added: 'added', changed: 'changed' };

export const REASON = {
  differs: 'differs',
  noBaseline: 'no-baseline',
  pageTooLarge: 'page-too-large',
  bothChanged: 'both-changed',
  reviewingOpenMarkup: 'reviewing-open-markup',
};

const GROUP_ATTR = 'data-diff-group';
const SIDE_ATTR = 'data-diff-side';
const KIND_ATTR = 'data-diff-kind';
const REASON_ATTR = 'data-diff-reason';

const PREVIEW_LENGTH = 200;

export function groupAttrs({
  id, side, kind, reason,
}) {
  return {
    [GROUP_ATTR]: id,
    [SIDE_ATTR]: side,
    [KIND_ATTR]: kind,
    ...(reason ? { [REASON_ATTR]: reason } : {}),
  };
}

export const attrString = (attrs) => Object.entries(attrs)
  .map(([name, value]) => ` ${name}="${value}"`).join('');

export function setGroupAttrs(el, group) {
  Object.entries(groupAttrs(group)).forEach(([name, value]) => el.setAttribute(name, value));
}

export function createGroupIds(doc) {
  const used = new Set([...doc.querySelectorAll(`[${GROUP_ATTR}]`)]
    .map((el) => el.getAttribute(GROUP_ATTR)));
  let next = 0;
  return () => {
    let id;
    do {
      next += 1;
      id = `g${next}`;
    } while (used.has(id));
    used.add(id);
    return id;
  };
}

const isDeleted = (el) => el?.nodeName === DELETED_TAG.toUpperCase();
const isAdded = (el) => el?.nodeName === ADDED_TAG.toUpperCase() || !!el?.hasAttribute?.(ADDED_TAG);

const sideOf = (el) => {
  if (isDeleted(el)) return SIDE.source;
  if (isAdded(el)) return SIDE.local;
  return null;
};

const markerOf = (el) => {
  if (sideOf(el)) return el;
  if (el.nodeName === 'LI' && sideOf(el.firstElementChild)) return el.firstElementChild;
  return null;
};

function markRuns(children, { reason, nextId }) {
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const id = nextId();
    const sides = new Set(run.map(sideOf));
    const kind = sides.size > 1 ? KIND.changed : KIND.added;
    const reasonEl = run.find(isDeleted) || run[0];
    run.forEach((marker) => setGroupAttrs(marker, {
      id, side: sideOf(marker), kind, reason: marker === reasonEl ? reason : null,
    }));
    run = [];
  };
  children.forEach((child) => {
    const marker = markerOf(child);
    if (marker && !marker.hasAttribute(GROUP_ATTR)) {
      run.push(marker);
      return;
    }
    flush();
    if (child.nodeName === 'UL' || child.nodeName === 'OL') markRuns([...child.children], { reason, nextId });
  });
  flush();
}

export function markGroups(main, { reason, nextId }) {
  [...main.children].forEach((section) => markRuns([...section.children], { reason, nextId }));
}

const preview = (els) => els.map((el) => el.textContent).join(' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, PREVIEW_LENGTH);

const MARKER_SELECTOR = `${DELETED_TAG}, ${ADDED_TAG}, [${ADDED_TAG}]`;

export function diffSummary(doc) {
  const sections = [...doc.querySelectorAll('main > div')];
  const markers = [...doc.querySelectorAll(MARKER_SELECTOR)]
    .filter((el) => !el.parentElement?.closest(MARKER_SELECTOR));
  const byId = new Map();
  markers.forEach((el) => {
    const id = el.getAttribute(GROUP_ATTR);
    if (!id) return;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(el);
  });
  const groups = [...byId].map(([id, els]) => {
    const ofSide = (side) => els.filter((el) => el.getAttribute(SIDE_ATTR) === side);
    const base = doc.querySelector(`${BASE_TAG}[${GROUP_ATTR}="${id}"]`);
    return {
      id,
      reason: els.map((el) => el.getAttribute(REASON_ATTR)).find(Boolean) || null,
      sides: [SIDE.source, SIDE.local].filter((side) => ofSide(side).length),
      kinds: [...new Set(els.map((el) => el.getAttribute(KIND_ATTR)).filter(Boolean))],
      section: sections.findIndex((section) => section.contains(els[0])),
      preview: {
        source: preview(ofSide(SIDE.source)),
        local: preview(ofSide(SIDE.local)),
        ...(base ? { base: preview([base]) } : {}),
      },
    };
  });
  const count = (key) => groups.reduce((acc, group) => {
    [group[key]].flat().filter(Boolean).forEach((value) => {
      acc[value] = (acc[value] || 0) + 1;
    });
    return acc;
  }, {});
  return {
    groups,
    counts: { groups: groups.length, bySide: count('sides'), byReason: count('reason') },
    legacy: markers.length > 0 && markers.every((el) => !el.hasAttribute(GROUP_ATTR)),
  };
}
