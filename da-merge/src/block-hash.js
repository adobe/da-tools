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
import { ADDED_TAG } from './markup.js';

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;

const HLX_AEM_URL_REGEX = /\.hlx\.page\/|\.hlx\.live\/|\.aem\.page\//g;

export const sectionBlock = {
  isSection: true,
  outerHTML: 'spoofedSectionHtml',
};

const findConfigValue = (json, key) => {
  const foundRow = json?.config?.data.find((row) => row.key === key);
  return foundRow?.value;
};

export const getEquivalentSites = (config) => {
  const hostnames = findConfigValue(config, 'source.fragment.hostnames')?.split?.(',') || [];
  return new Set([...hostnames.map((hostname) => hostname.split('--')[1]), ...(config?.equivalentSites || [])]);
};

/**
 * Recursively trims whitespace in all text nodes of a DOM element.
 * @param {Node} node
 */
function trimTextNodes(node) {
  if (node.nodeType === TEXT_NODE) {
    node.textContent = node.textContent.trim();
  } else if (node.nodeType === ELEMENT_NODE) {
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
    if (child.nodeType === ELEMENT_NODE) {
      inner += getOuterHTMLWithSortedAttributes(child);
    } else if (child.nodeType === TEXT_NODE) {
      inner += escapeHTML(child.textContent);
    } else if (child.nodeType === COMMENT_NODE) {
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

export function normalizeLinks(doc, site, equivalentSites) {
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

export function groupBlocks(blocks) {
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

export const isNotEmptyParagraphEl = (el) => !(el.nodeName === 'P' && !el.childNodes.length && el.textContent === '');

const preText = (el) => (el.matches?.('pre') ? [el] : [...(el.querySelectorAll?.('pre') || [])])
  .map((pre) => pre.textContent).join('\u0000');

export function hashBlock(block, { smart = false } = {}) {
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

export const shortHash = (hash) => hash.substring(0, HASH_LENGTH);

export const dropDiffAttrs = (el) => [...el.attributes]
  .filter(({ name }) => name === ADDED_TAG || name.startsWith('data-diff-'))
  .forEach(({ name }) => el.removeAttribute(name));

/**
 * The hash a merge review records for a unit (a block, a list item, or a block group), as the
 * next copy reads it: links normalized, diff markup attributes dropped.
 * @param {Element | Element[]} unit
 * @param {{ site?: String, config?: Object }} [options]
 * @returns {String}
 */
export function reviewHash(unit, { site, config } = {}) {
  const sites = getEquivalentSites(config);
  const clean = (el) => {
    if (el.isSection) return el;
    const box = el.ownerDocument.createElement('div');
    box.append(el.cloneNode(true));
    normalizeLinks(box, site, sites);
    [...box.querySelectorAll('*')].forEach(dropDiffAttrs);
    return box.firstElementChild;
  };
  const units = Array.isArray(unit) ? unit.filter(isNotEmptyParagraphEl).map(clean) : clean(unit);
  return shortHash(hashBlock(units));
}
