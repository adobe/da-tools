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
import { hashContent, HASH_LENGTH } from './hashes.js';
import threeWayMerge from './smart-merge.js';
import {
  BASE_TAG, KIND, REASON, SIDE, attrString, createGroupIds, groupAttrs, markGroups, setGroupAttrs,
} from './markup.js';

const MIN_LIST_ITEMS_IN_COMMON = 2;
const ADDED = 'added';
const ADDED_TAG = 'da-diff-added';
const DELETED = 'deleted';
const DELETED_TAG = 'da-diff-deleted';
// Matches what the editor saves, so a preview before the page is opened leaves upstream blocks out.
const DELETED_OPEN = `<${DELETED_TAG} data-mdast="ignore">`;
const SAME = 'same';

const HLX_AEM_URL_REGEX = /\.hlx\.page\/|\.hlx\.live\/|\.aem\.page\//g;

const sectionBlock = {
  isSection: true,
  outerHTML: 'spoofedSectionHtml',
};

const isList = (block) => ['OL', 'UL'].includes(block.nodeName);

const findConfigValue = (json, key) => {
  const foundRow = json?.config?.data.find((row) => row.key === key);
  return foundRow?.value;
};

// List items wrap added content in a <da-diff-added> element instead of using the attribute.
export const LOC_MARKERS = `${DELETED_TAG}, ${ADDED_TAG}, [${ADDED_TAG}], da-loc-added, da-loc-deleted, [loc-temp-dom]`;

export const isSnapshotPath = (path) => path.includes('/.snapshots/');

const OPEN_MARKUP = `${LOC_MARKERS}, ${BASE_TAG}`;

// Remove all diff tags - document is updated to only keep local changes, upstream is deleted
export const removeLocTags = (html) => {
  // TODO: Remove da-loc-deleted once we've migrated all regional edits to the new loc tags
  const locElsToRemove = html.querySelectorAll(`${DELETED_TAG}, [loc-temp-dom], da-loc-deleted, ${BASE_TAG}`);
  locElsToRemove.forEach((el) => el.remove());

  // Keep added content: old regional edits (da-loc-added) and list items (<li><da-diff-added>)
  const daLocAddedEls = html.querySelectorAll(`da-loc-added, ${ADDED_TAG}`);
  daLocAddedEls.forEach((el) => {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) {
      parent.insertBefore(el.firstChild, el);
    }
    parent.removeChild(el);
  });

  html.querySelectorAll('*').forEach((el) => [...el.attributes]
    .filter(({ name }) => name === ADDED_TAG || name.startsWith('data-diff-'))
    .forEach(({ name }) => el.removeAttribute(name)));
};

export default function createRegionalDiff({ Node, document }) {
  /**
   * Recursively trims whitespace in all text nodes of a DOM element.
   * @param {Node} node
   */
  function trimTextNodes(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      node.textContent = node.textContent.trim();
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      node.childNodes.forEach(trimTextNodes);
    }
  }

  /**
   * Recursively serializes an element and its children,
   * sorting all attributes alphabetically for every element.
   * Escapes attribute values and text nodes for HTML safety.
   * Handles element, text, and comment nodes.
   * @param {Element} element - The DOM element to serialize.
   * @returns {string} - The HTML string with sorted attributes for all elements.
   */
  function getOuterHTMLWithSortedAttributes(element) {
    function escapeHTML(str) {
      return str.replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    const tagName = element.tagName.toLowerCase();
    const attrs = Array.from(element.attributes)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((attr) => `${attr.name}="${escapeHTML(attr.value)}"`)
      .join(' ');
    const voidElements = new Set([
      'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
      'link', 'meta', 'param', 'source', 'track', 'wbr',
    ]);
    if (voidElements.has(tagName)) {
      return `<${tagName}${attrs ? ` ${attrs}` : ''}>`;
    }
    let inner = '';
    for (const child of element.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        inner += getOuterHTMLWithSortedAttributes(child);
      } else if (child.nodeType === Node.TEXT_NODE) {
        inner += escapeHTML(child.textContent);
      } else if (child.nodeType === Node.COMMENT_NODE) {
        // Sanitize comment content to avoid '-->'
        inner += `<!--${child.textContent.replace(/-->/g, '--&gt;')}-->`;
      }
    }
    return `<${tagName}${attrs ? ` ${attrs}` : ''}>${inner}</${tagName}>`;
  }

  /**
   * Normalizes HTML by trimming whitespace in text nodes and removing whitespace between tags.
   * @param {Element} element - DOM element to normalize
   * @returns {string} - Normalized HTML string
   */
  function normalizeHTMLFromElement(element) {
    if (element.outerHTML === 'spoofedSectionHtml') {
      return element.outerHTML;
    }
    // Clone to avoid mutating the original
    const clone = element.cloneNode(true);
    trimTextNodes(clone);
    // Remove whitespace between tags
    let html = getOuterHTMLWithSortedAttributes(clone).replace(/>\s+</g, '><');
    // Remove all line breaks and tabs
    html = html.replace(/[\n\r\t]/g, '');
    // Optionally, collapse multiple spaces
    html = html.replace(/\s{2,}/g, ' ');
    return html.trim();
  }

  async function normalizeLinks(doc, site, equivalentSites) {
    // convert all urls with .hlx.page, .hlx.live, .aem.page, .aem.live to .aem.live
    const links = doc.querySelectorAll('a[href*=".hlx.page/"], a[href*=".hlx.live/"], a[href*=".aem.page/"], a[href*=".aem.live/"], source[srcset*=".hlx.page/"], source[srcset*=".hlx.live/"], source[srcset*=".aem.page/"], source[srcset*=".aem.live/"], img[src*=".hlx.page/"], img[src*=".hlx.live/"], img[src*=".aem.page/"], img[src*=".aem.live/"]');
    const tagToAttr = { A: 'href', IMG: 'src', SOURCE: 'srcset' };
    links.forEach((el) => {
      const urlAttr = tagToAttr[el.tagName];
      if (!urlAttr) return;
      let url = el[urlAttr];
      url = url.replace(HLX_AEM_URL_REGEX, '.aem.live/');
      const linkSite = url.split('--')[1];
      if (equivalentSites.has(linkSite)) {
        url = url.replace(`--${linkSite}--`, `--${site}--`);
      }
      el[urlAttr] = url;
    });
    return doc;
  }

  function getLists(result) {
    const addedLists = [];
    const deletedLists = [];
    result.forEach((item) => {
      if (item.type === ADDED && isList(item.block)) {
        addedLists.push(item);
      }
      if (item.type === DELETED && isList(item.block)) {
        deletedLists.push(item);
      }
    });
    return [addedLists, deletedLists];
  }

  function getListHashes(list) {
    return [...list.children].map((child) => {
      child.hash = hashContent(child.outerHTML);
      return child.hash;
    });
  }

  const listElToBlockMap = (listItems) => [...listItems].map((item) => ({
    hash: item.hash,
    block: item,
  }));

  function createWrapper(tag) {
    const wrapper = document.createElement(tag);
    if (tag === DELETED_TAG) wrapper.setAttribute('data-mdast', 'ignore');
    return wrapper;
  }

  function wrapContentWithElement(targetElement, wrapperElementTag) {
    const wrapperElement = createWrapper(wrapperElementTag);
    while (targetElement.firstChild) {
      wrapperElement.appendChild(targetElement.firstChild);
    }
    targetElement.appendChild(wrapperElement);
  }

  const convertToHtmlList = (mergedList) => mergedList
    .map((item) => {
      if (item.type === ADDED) {
        // LI's have the inner content wrapped, unlike other els that are wrapped outside
        wrapContentWithElement(item.block, ADDED_TAG);
      } else if (item.type === DELETED) {
        wrapContentWithElement(item.block, DELETED_TAG);
      }
      return item.block.outerHTML;
    }).join('');

  function checkLists(res) {
    let result = res;
    const [addedLists, deletedLists] = getLists(result);
    // see if any of the added lists children match with any deleted list children
    addedLists.forEach((addedList) => {
      const addedItemHashes = getListHashes(addedList.block);
      deletedLists.forEach((deletedList) => {
        if (addedList.block.nodeName !== deletedList.block.nodeName) {
          return;
        }
        const deletedItemHashes = getListHashes(deletedList.block);
        const commonHashes = addedItemHashes.filter((hash) => deletedItemHashes.includes(hash));

        if (commonHashes.length >= MIN_LIST_ITEMS_IN_COMMON) {
          // lists have 2+ common listItems, so we assume that the langstore list has been modified

          // remove the deleted list
          result = result.filter((item) => item.hash !== deletedList.hash);

          const addedListItems = listElToBlockMap(addedList.block.children);
          const deletedListItems = listElToBlockMap(deletedList.block.children);

          // eslint-disable-next-line no-use-before-define
          const mergedList = blockDiff(deletedListItems, addedListItems, { isListCheck: true });
          addedList.block.innerHTML = convertToHtmlList(mergedList);
          addedList.type = SAME;
        }
      });
    });
    return result;
  }

  const isDeletedItem = (item) => item.type === DELETED;

  // When two section breaks are matched, keep the deleted blocks in the section they came from
  function pairSectionBreak(result, i, deletedFirst) {
    const before = result.slice(0, i);
    const between = result.slice(i + 1);
    const deleted = between.filter(isDeletedItem);
    const others = between.filter((item) => !isDeletedItem(item));
    const pairedBreak = { ...result[i], type: SAME };
    return deletedFirst
      ? [...before, ...others, pairedBreak, ...deleted]
      : [...before, ...deleted, pairedBreak, ...others];
  }

  function addToResult(result, newItem, type) {
    for (let i = 0; i < result.length; i += 1) {
      const resultItem = result[i];
      if (resultItem.hash !== newItem.hash || resultItem.type === SAME) {
        // eslint-disable-next-line no-continue
        continue;
      }
      if (newItem.sectionNumber && type !== SAME && resultItem.type !== type) {
        return pairSectionBreak(result, i, resultItem.type === DELETED);
      }
      if (resultItem.type === DELETED) {
        if (type === ADDED) {
          // remove the deleted item from the result, since it was moved
          return [...result.slice(0, i), ...result.slice(i + 1), { ...newItem, type: SAME }];
        }
        if (type === DELETED) {
          // item was deleted in both arrays
          return [...result, { ...newItem, type: DELETED }];
        }
      }
      if (resultItem.type === ADDED) {
        if (type === ADDED) {
          // item was added in both arrays
          return [...result, { ...newItem, type: ADDED }];
        }
        if (type === DELETED) {
          resultItem.type = SAME;
          return result;
        }
      }
    }
    result.push({ ...newItem, type });
    return result;
  }

  function blockDiff(A, B, { isListCheck = false } = {}) {
    let result = [];
    const length = Math.min(A.length, B.length);
    let i = 0;
    for (i; i < length; i += 1) {
      if (A[i].hash === B[i].hash) {
        result = addToResult(result, A[i], SAME);
      } else {
        result = addToResult(result, A[i], DELETED);
        result = addToResult(result, B[i], ADDED);
      }
    }

    // Add any remaining items
    if (i < A.length) {
      for (; i < A.length; i += 1) {
        result = addToResult(result, A[i], DELETED);
      }
    }
    if (i < B.length) {
      for (; i < B.length; i += 1) {
        result = addToResult(result, B[i], ADDED);
      }
    }

    if (!isListCheck) {
      result = checkLists(result);
    }

    return result;
  }

  function groupBlocks(blocks) {
    const { groupedBlocks, currentGroup } = blocks.reduce((acc, block) => {
      if (block.className?.toLowerCase().startsWith('block-group-start')) {
        acc.isGrouping = true;
        acc.currentGroup.push(block);
      } else if (block.className?.toLowerCase().startsWith('block-group-end')) {
        acc.currentGroup.push(block);
        acc.groupedBlocks.push(acc.currentGroup);
        acc.currentGroup = [];
        acc.isGrouping = false;
      } else if (acc.isGrouping) {
        acc.currentGroup.push(block);
      } else {
        acc.groupedBlocks.push(block);
      }
      return acc;
    }, { groupedBlocks: [], currentGroup: [], isGrouping: false });

    if (currentGroup.length > 0) {
      groupedBlocks.push(currentGroup);
    }

    return groupedBlocks;
  }

  const isNotEmptyParagraphEl = (el) => !(el.nodeName === 'P' && !el.childNodes.length && el.textContent === '');

  const preText = (el) => (el.matches?.('pre') ? [el] : [...(el.querySelectorAll?.('pre') || [])])
    .map((pre) => pre.textContent).join('\u0000');

  const isOpenMarkup = (block) => {
    const first = Array.isArray(block) ? block[0] : block;
    if (!first || first.isSection) return false;
    if (first.matches?.(OPEN_MARKUP)) return true;
    return ['UL', 'OL'].includes(first.nodeName) && !!first.querySelector(OPEN_MARKUP);
  };

  function fixOpenGroups(blocks) {
    return blocks.reduce((acc, block) => {
      if (!isOpenMarkup(block)) {
        acc.push(block);
        return acc;
      }
      const units = Array.isArray(block) ? block : [block];
      const prev = acc[acc.length - 1];
      if (prev?.fixed) {
        prev.push(...units);
        return acc;
      }
      const fixed = [...units];
      fixed.fixed = true;
      acc.push(fixed);
      return acc;
    }, []);
  }

  // `smart` (smart-overwrite) needs a lossless block list: every section break, every element, and
  // whitespace inside <pre> counted as content.
  // keepAllBreaks: also keep the breaks of empty sections at the top of the page
  function getBlocks(dom, { smart = false, keepAllBreaks = false } = {}) {
    const sections = [...dom.querySelectorAll('main > div')];

    // flatten sections so that they are just dividers between blocks
    const blocks = sections.reduce((acc, section, index) => {
      const sectionBlocks = smart ? [...section.children] : [...section.children]
        .filter(isNotEmptyParagraphEl);
      const marker = smart
        ? { ...sectionBlock, openTag: section.cloneNode(false).outerHTML.replace(/<\/div>$/, '') }
        : sectionBlock;
      const sectionArr = smart || (keepAllBreaks ? index : acc.length) ? [marker] : [];
      return [...acc, ...sectionArr, ...sectionBlocks];
    }, []);
    const grouped = groupBlocks(blocks);
    return smart ? fixOpenGroups(grouped) : grouped;
  }

  function hashBlock(block, { smart = false } = {}) {
    const toHashString = (el) => {
      const normalized = normalizeHTMLFromElement(el);
      if (!smart) return normalized;
      if (el.isSection) return `${normalized}${el.openTag}`;
      const pre = preText(el);
      return pre ? `${normalized}${pre}` : normalized;
    };
    const stringToHash = Array.isArray(block)
      ? block.map(toHashString).join('')
      : toHashString(block);
    return hashContent(stringToHash);
  }

  const countSectionBreaks = (blocks) => blocks.filter((block) => block.isSection).length;

  // alignSections: both documents have the same number of section breaks, so they line up in order
  function getBlockMap(blocks, alignSections) {
    return blocks.map((block, index) => {
      // Number each section break so the 1st break only matches the 1st break,
      // the 2nd the 2nd, etc.
      if (block.isSection && alignSections) {
        const sectionNumber = countSectionBreaks(blocks.slice(0, index + 1));
        return { block, sectionNumber, hash: hashContent(`${block.outerHTML}-${sectionNumber}`) };
      }
      return { block, hash: hashBlock(block) };
    });
  }

  // Smart hashes never number section breaks, so adding a section doesn't change other baselines.
  function getSmartBlockMap(dom) {
    const options = { smart: true };
    return getBlocks(dom, options).map((block) => ({ block, hash: hashBlock(block, options) }));
  }

  function htmldiff(originalDOM, modifiedDOM) {
    const originalBlocks = getBlocks(originalDOM, { keepAllBreaks: true });
    const modifiedBlocks = getBlocks(modifiedDOM, { keepAllBreaks: true });
    const alignSections = countSectionBreaks(originalBlocks) === countSectionBreaks(modifiedBlocks);
    const original = alignSections ? originalBlocks : getBlocks(originalDOM);
    const modified = alignSections ? modifiedBlocks : getBlocks(modifiedDOM);
    const diffArr = blockDiff(
      getBlockMap(original, alignSections),
      getBlockMap(modified, alignSections),
    );
    return diffArr;
  }

  function wrapElement(targetElement, wrapperElementTag) {
    const wrapperElement = createWrapper(wrapperElementTag);
    wrapperElement.appendChild(targetElement);
    return wrapperElement;
  }

  const SECTION_DIV_BREAK = '</div><div>';
  const DIFF_INNER_SECTION_MARK = '<hr />';

  /**
   * @param {Array<Element | typeof sectionBlock>} blockGroup
   * @param {{ sectionSeparator?: string }} [options]
   */
  function getGroupInnerHtml(blockGroup, { sectionSeparator = SECTION_DIV_BREAK } = {}) {
    let htmlText = '';
    blockGroup.forEach((block) => {
      if (block.isSection) {
        htmlText += sectionSeparator;
        return;
      }
      htmlText += block.outerHTML;
    });
    return htmlText;
  }

  function diffEntryNeedsSectionBreakBefore(diff, index) {
    if (index === 0) return false;
    const prev = diff[index - 1];
    // A changed group before this one has already added a break after itself
    const prevIsChangedGroup = Array.isArray(prev?.block) && prev.type !== SAME;
    return Boolean(prev && !prev.block?.isSection && !prevIsChangedGroup);
  }

  function diffEntryNeedsSectionBreakAfter(diff, index, consumedCount) {
    const afterIndex = index + consumedCount;
    if (afterIndex >= diff.length) return false;
    const after = diff[afterIndex];
    return Boolean(after && !after.block?.isSection);
  }

  function appendPairedDiffedBlockGroupsHtml({
    htmlText, deletedGroup, addedGroup,
  }) {
    const diffSep = { sectionSeparator: DIFF_INNER_SECTION_MARK };
    const deletedInner = getGroupInnerHtml(deletedGroup, diffSep);
    addedGroup[0]?.setAttribute(ADDED_TAG, '');
    const addedInner = getGroupInnerHtml(addedGroup, diffSep);
    return `${htmlText}${DELETED_OPEN}${deletedInner}</${DELETED_TAG}>${addedInner}`;
  }

  function appendSingleDiffedBlockGroupHtml({ htmlText, type, blockGroup }) {
    const diffSep = { sectionSeparator: DIFF_INNER_SECTION_MARK };
    if (type === DELETED) {
      const inner = getGroupInnerHtml(blockGroup, diffSep);
      return `${htmlText}${DELETED_OPEN}${inner}</${DELETED_TAG}>`;
    }
    blockGroup[0]?.setAttribute(ADDED_TAG, '');
    const inner = getGroupInnerHtml(blockGroup, diffSep);
    return `${htmlText}${inner}`;
  }

  function buildHtmlFromDiff(diff, modified, acceptedHashes, rejectedHashes, markup) {
    let htmlText = '<div>';
    for (let i = 0; i < diff.length; i += 1) {
      const item = diff[i];
      let modifiedBlock = item.block;
      const hash = item.hash.substring(0, HASH_LENGTH);

      if (item.block.isSection) {
        htmlText += SECTION_DIV_BREAK;
        // eslint-disable-next-line no-continue
        continue;
      }

      if (Array.isArray(item.block)) {
        if (item.type === SAME) {
          htmlText += getGroupInnerHtml(item.block);
          // eslint-disable-next-line no-continue
          continue;
        }

        const next = diff[i + 1];
        const isPairedDiff = item.type === DELETED
          && next?.type === ADDED
          && Array.isArray(next.block);

        if (isPairedDiff) {
          if (diffEntryNeedsSectionBreakBefore(diff, i)) {
            htmlText += SECTION_DIV_BREAK;
          }
          htmlText = appendPairedDiffedBlockGroupsHtml({
            htmlText,
            deletedGroup: item.block,
            addedGroup: next.block,
          });
          if (diffEntryNeedsSectionBreakAfter(diff, i, 2)) {
            htmlText += SECTION_DIV_BREAK;
          }
          i += 1;
          // eslint-disable-next-line no-continue
          continue;
        }

        if (diffEntryNeedsSectionBreakBefore(diff, i)) {
          htmlText += SECTION_DIV_BREAK;
        }
        htmlText = appendSingleDiffedBlockGroupHtml({
          htmlText,
          type: item.type,
          blockGroup: item.block,
        });
        if (diffEntryNeedsSectionBreakAfter(diff, i, 1)) {
          htmlText += SECTION_DIV_BREAK;
        }
        // eslint-disable-next-line no-continue
        continue;
      }

      // Rejected hashes only skip incoming blocks, never the target's own (ADDED) blocks
      if (item.type === ADDED) {
        if (!acceptedHashes.includes(hash)) {
          modifiedBlock.setAttribute(ADDED_TAG, '');
        }
      } else if (item.type === DELETED) {
        if (rejectedHashes.includes(hash)) {
          // eslint-disable-next-line no-continue
          continue;
        }
        if (!acceptedHashes.includes(hash)) {
          modifiedBlock = wrapElement(item.block, DELETED_TAG);
        }
      }
      htmlText += modifiedBlock.outerHTML;
    }
    htmlText += '</div>';

    const main = modified.documentElement.querySelector('main');
    main.innerHTML = htmlText;
    markGroups(main, markup);
    return modified;
  }

  const getEquivalentSites = (config) => {
    const hostnames = findConfigValue(config, 'source.fragment.hostnames')?.split?.(',') || [];
    return new Set([...hostnames.map((hostname) => hostname.split('--')[1]), ...(config?.equivalentSites || [])]);
  };

  const shortHash = (item) => item.hash.substring(0, HASH_LENGTH);

  // Like merge, rejections only apply to single upstream blocks (never to groups or list items).
  const isSingleBlock = (block) => !block.isSection && !Array.isArray(block);

  function localHashes(unit) {
    if (unit.some((el) => el.isSection)) return null;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `<main><div>${unit.map((el) => el.outerHTML).join('')}</div></main>`;
    removeLocTags(wrapper);
    return getSmartBlockMap(wrapper).filter(({ block }) => !block.isSection).map(shortHash);
  }

  const smartHash = (el) => shortHash({ hash: hashBlock(el, { smart: true }) });

  const dropDiffAttrs = (el) => [...el.attributes]
    .filter(({ name }) => name === ADDED_TAG || name.startsWith('data-diff-'))
    .forEach(({ name }) => el.removeAttribute(name));

  // An open list item: <li><da-diff-added>, <li da-diff-added>, <li><da-diff-deleted>, or
  // <da-diff-deleted><li>. Returns the item without its markers, and which side it is from.
  function listItem(child) {
    const tag = child.nodeName.toLowerCase();
    const li = tag === DELETED_TAG ? child.firstElementChild : child;
    if (li?.nodeName !== 'LI' || (tag === DELETED_TAG && child.children.length !== 1)) return null;
    const clean = li.cloneNode(true);
    const inner = clean.firstElementChild;
    const wrapped = inner && clean.childElementCount === 1
      && [ADDED_TAG, DELETED_TAG].includes(inner.nodeName.toLowerCase()) ? inner : null;
    if (wrapped) clean.replaceChildren(...wrapped.childNodes);
    dropDiffAttrs(clean);
    let side = SAME;
    if (tag === DELETED_TAG || wrapped?.nodeName.toLowerCase() === DELETED_TAG) side = DELETED;
    else if (wrapped || li.hasAttribute(ADDED_TAG)) side = ADDED;
    return { clean, side };
  }

  // The items of a list as merge units. Open items keep their markup and their own hashes;
  // `base` is the list's hash without the local side, which is what the last copy wrote.
  function listUnits(list, normalized) {
    const children = [...normalized.children];
    const items = children.map(listItem);
    if (items.some((item) => !item)) return null;
    const sourceSide = items.filter(({ side }) => side !== ADDED);
    const base = normalized.cloneNode(false);
    sourceSide.forEach(({ clean }) => base.append(clean.cloneNode(true)));
    return {
      base: smartHash(base),
      baseItems: sourceSide.map(({ clean }) => smartHash(clean)),
      items: items.map(({ clean, side }, idx) => ({
        block: list.children[idx],
        hash: side === SAME ? smartHash(clean) : smartHash(children[idx]),
        open: side !== SAME,
      })),
    };
  }

  function getListUnits(block, normalized) {
    const [list, normalizedList] = block.fixed ? [block[0], normalized[0]] : [block, normalized];
    if ((block.fixed && block.length !== 1) || !list || !isList(list)) return null;
    return listUnits(list, normalizedList);
  }

  // Merges a list item by item when its open review is the only local change to it.
  function mergeList({ dest, source }) {
    const sameTag = dest.block[0].nodeName === source.block.nodeName;
    if (!sameTag || !source.list || source.list.items.some(({ open }) => open)) return null;
    const result = threeWayMerge({
      base: dest.list.baseItems,
      source: source.list.items,
      dest: dest.list.items,
      fixed: new Set(dest.list.items.filter(({ open }) => open).map(({ hash }) => hash)),
    });
    if (result.review || result.blocks.some(({ mark }) => mark)) return null;
    const list = dest.block[0].cloneNode(false);
    result.blocks.forEach(({ block }) => list.append(block.cloneNode(true)));
    const block = [list];
    block.fixed = true;
    return {
      entry: { block, hash: smartHash(list) },
      skipped: result.skipped,
      removedUpstream: result.removedUpstream,
    };
  }

  // Hashes (and merge's reviewHash, single blocks only) come from a link-normalized copy.
  async function getHashedBlocks(doc, { site, config, withReviewHash = false }) {
    const options = { smart: true };
    const normalized = await normalizeLinks(doc.cloneNode(true), site, getEquivalentSites(config));
    const hashed = getSmartBlockMap(normalized);
    return getBlocks(doc, options).map((block, idx) => ({
      block,
      hash: shortHash(hashed[idx]),
      list: getListUnits(block, hashed[idx].block),
      ...(block.fixed ? { local: localHashes(hashed[idx].block) } : {}),
      ...(withReviewHash && isSingleBlock(block)
        ? { reviewHash: shortHash({ hash: hashBlock(hashed[idx].block) }) } : {}),
    }));
  }

  const isRejectedBlock = (rejected) => ({ reviewHash }) => !!reviewHash
    && rejected.includes(reviewHash);

  async function removeRejectedBlocks({
    doc, rejected = [], site, config,
  }) {
    const copy = doc.cloneNode(true);
    if (!rejected.length) return copy;
    const blocks = await getHashedBlocks(copy, { site, config, withReviewHash: true });
    blocks.filter(isRejectedBlock(rejected)).forEach(({ block }) => {
      const section = block.parentElement;
      block.remove();
      const emptied = section && !section.children.length && !section.textContent.trim();
      // The last section stays: a saved empty page still has one.
      if (emptied && section.parentElement.children.length > 1) section.remove();
    });
    return copy;
  }

  async function getBlockHashes({ doc, site, config }) {
    const blocks = await getHashedBlocks(doc, { site, config });
    return blocks.map(({ hash }) => hash);
  }

  async function getContentHashes({ doc, site, config }) {
    const blocks = await getHashedBlocks(doc, { site, config });
    return blocks.filter(({ block }) => !block.isSection).map(({ hash }) => hash);
  }

  async function getReviewHashes({ doc, site, config }) {
    const blocks = await getHashedBlocks(doc, { site, config, withReviewHash: true });
    return blocks.map(({ reviewHash }) => reviewHash ?? null);
  }

  const partHtml = (part) => (Array.isArray(part) ? getGroupInnerHtml(part) : part.outerHTML);

  // Like merge, each added block (or block group) carries the attribute on its first element.
  const addedHtml = (part, group) => {
    const [first, ...rest] = Array.isArray(part) ? part : [part];
    const added = first.cloneNode(true);
    added.setAttribute(ADDED_TAG, '');
    setGroupAttrs(added, group);
    return partHtml([added, ...rest]);
  };

  function markedHtml({ parts, mark, group }) {
    if (mark !== 'upstream') {
      return parts.map((part, idx) => addedHtml(part, idx ? { ...group, reason: null } : group)).join('');
    }
    const open = `<${DELETED_TAG} data-mdast="ignore"${attrString(groupAttrs(group))}>`;
    return `${open}${parts.map(partHtml).join('')}</${DELETED_TAG}>`;
  }

  const baseHtml = (id, blocks) => `<${BASE_TAG} data-mdast="ignore" data-diff-group="${id}">${
    blocks.map(partHtml).join('')}</${BASE_TAG}>`;

  function getBaseContent(baseRange, { base, baselineBlocks }) {
    if (!baselineBlocks) return null;
    const [start, end] = baseRange;
    const hashes = base.slice(start, end);
    const found = baselineBlocks.slice(start, end);
    const matches = hashes.length && found.length === hashes.length
      && found.every((entry, idx) => entry.hash === hashes[idx]);
    return matches ? found.filter(({ block }) => !block.isSection).map(({ block }) => block) : null;
  }

  function describeGroups(entries, { nextId, reason, baseline }) {
    const groups = new Map();
    entries.filter(({ mark }) => mark).forEach(({
      group, mark, baseRange, removed,
    }) => {
      if (!groups.has(group)) {
        groups.set(group, {
          id: nextId(), marks: new Set(), baseRange, removed,
        });
      }
      groups.get(group).marks.add(mark);
    });
    groups.forEach((group) => {
      group.reason = reason;
      if (group.removed) group.kind = KIND.removed;
      else group.kind = group.marks.size > 1 ? KIND.changed : KIND.added;
      group.reasonMark = group.marks.has('upstream') ? 'upstream' : 'local';
      group.base = baseline && getBaseContent(group.baseRange, baseline);
    });
    return groups;
  }

  function markedEntryHtml(entry, groups) {
    const { mark, parts } = entry;
    const group = groups.get(entry.group);
    const writeReason = mark === group.reasonMark && !group.reasonWritten;
    if (writeReason) group.reasonWritten = true;
    const marked = markedHtml({
      parts,
      mark,
      group: {
        id: group.id,
        side: mark === 'upstream' ? SIDE.source : SIDE.local,
        kind: group.kind,
        reason: writeReason ? group.reason : null,
      },
    });
    if (!group.base || group.baseWritten) return marked;
    group.baseWritten = true;
    return `${baseHtml(group.id, group.base)}${marked}`;
  }

  const groupMarks = (blocks) => blocks.reduce((groups, entry) => {
    const prev = groups.at(-1);
    if (!entry.mark) return [...groups, entry];
    if (prev?.mark !== entry.mark || prev.group !== entry.group) {
      return [...groups, { ...entry, parts: [entry.block] }];
    }
    return [...groups.slice(0, -1), { ...prev, parts: [...prev.parts, entry.block] }];
  }, []);

  function buildHtmlFromBlocks(blocks, markup) {
    const entries = groupMarks(blocks);
    const groups = describeGroups(entries, markup);
    const inner = entries.reduce((html, entry, idx) => {
      const { block, mark } = entry;
      if (block.isSection) return `${html}${idx ? '</div>' : ''}${block.openTag || '<div>'}`;
      if (mark) return `${html}${markedEntryHtml(entry, groups)}`;
      if (Array.isArray(block)) {
        const group = block.map((el) => (el.isSection ? `</div>${el.openTag || '<div>'}` : el.outerHTML));
        return `${html}${group.join('')}`;
      }
      return `${html}${block.outerHTML}`;
    }, '');
    return blocks[0]?.block.isSection ? `${inner}</div>` : `<div>${inner}</div>`;
  }

  /**
   * Block-level three-way merge. Applies upstream (source) changes made since the
   * base to the destination, keeping destination edits. When both sides changed
   * the same region, the conflict is marked with `da-diff-*` markers in `html` and counted in
   * `review`, or kept as the destination has it and counted as skipped (see README.md).
   * @param {Object} params
   * @param {String[]} params.base ordered block hashes of the source at the last rollout
   * @param {Document} params.source the current upstream document
   * @param {Document} params.dest the current destination document
   * @param {String[]} [params.rejected] block hashes the author rejected in a merge review
   * @param {String} params.site the DA site, used for link normalization
   * @param {Object} params.config the translation config (equivalent fragment hostnames)
   * @returns {Promise<{ html: String, skipped: Number, review: Boolean, removedUpstream: Number,
   *   reordered: Boolean, swaps: String[], swapsAsBase: String[], sourceHashes: String[] }>}
   *   sourceHashes is the next baseline. Other fields: see threeWayMerge.
   */
  async function smartMerge({
    base, source, dest, rejected = [], site, config, baselineDoc = null,
    reason = REASON.bothChanged, nextId = createGroupIds(dest),
  }) {
    const withReviewHash = rejected.length > 0;
    const sourceBlocks = await getHashedBlocks(source, { site, config, withReviewHash });
    const destBlocks = await getHashedBlocks(dest, { site, config });
    const rejectedBlocks = sourceBlocks.filter(isRejectedBlock(rejected));
    const baselineBlocks = baselineDoc && await getHashedBlocks(baselineDoc, { site, config });
    const {
      blocks, skipped, review, removedUpstream, reordered, swaps, swapsAsBase, baseline,
    } = threeWayMerge({
      base,
      source: sourceBlocks,
      dest: destBlocks,
      rejected: new Set(rejectedBlocks.map(({ hash }) => hash)),
      fixed: new Set(destBlocks.filter(({ block }) => block.fixed).map(({ hash }) => hash)),
      mergeList,
    });
    return {
      html: buildHtmlFromBlocks(blocks, {
        nextId, reason, baseline: baselineBlocks && { base, baselineBlocks },
      }),
      skipped,
      review: review > 0,
      removedUpstream,
      reordered,
      swaps,
      swapsAsBase,
      sourceHashes: baseline,
    };
  }

  async function regionalDiff(
    original,
    modified,
    acceptedHashes,
    rejectedHashes,
    {
      normalizeImages, site, config, reason = REASON.differs,
    } = {},
  ) {
    const equivalentSites = getEquivalentSites(config);

    const normalizedOriginal = await normalizeLinks(original, site, equivalentSites);
    const normalizedModified = await normalizeLinks(modified, site, equivalentSites);
    // optional connector hook
    if (normalizeImages) normalizeImages(normalizedOriginal, normalizedModified);
    const diff = htmldiff(normalizedOriginal, normalizedModified);
    const output = buildHtmlFromDiff(
      diff,
      normalizedModified,
      acceptedHashes || [],
      rejectedHashes || [],
      { reason, nextId: createGroupIds(normalizedModified) },
    );
    return output.body.querySelector('main');
  }

  return {
    normalizeLinks,
    removeRejectedBlocks,
    getBlockHashes,
    getContentHashes,
    getReviewHashes,
    smartMerge,
    regionalDiff,
  };
}
