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

/**
 * Environment-specific HTML parsing that outputs a HAST-like tree structure.
 * - Browser: Uses native DOMParser (built-in, zero bundle size)
 * - Node.js/Workers: Uses hast-util-from-html (imported once at module load)
 */

// For Workers/Node.js: import hast-util-from-html at module load time (not per-call)
// This is tree-shaken out in browser builds since the code path isn't used
let hastUtilFromHtmlModule;
if (typeof DOMParser === 'undefined') {
  hastUtilFromHtmlModule = import('hast-util-from-html');
}

/**
 * Minimal CSS selector matcher for simple selectors used in ProseMirror schema.
 * Supports: tag names ('p', 'div') and attribute presence ('img[src]', 'a[href]')
 */
export function matches(selector, node) {
  if (!node || node.type !== 'element') return false;

  // Handle attribute selector: tag[attr]
  const attrMatch = selector.match(/^(\w+)\[(\w+)\]$/);
  if (attrMatch) {
    const [, tag, attr] = attrMatch;
    return node.tagName === tag && node.properties?.[attr] != null;
  }

  // Simple tag match
  return node.tagName === selector.toLowerCase();
}

/**
 * Convert a DOM node to HAST-like tree structure
 */
function domToHast(domNode) {
  if (domNode.nodeType === 3) {
    // Text node
    return { type: 'text', value: domNode.textContent };
  }

  if (domNode.nodeType === 8) {
    // Comment node
    return { type: 'comment', value: domNode.textContent };
  }

  if (domNode.nodeType === 1) {
    // Element node
    const properties = {};
    for (const attr of domNode.attributes || []) {
      // Convert class to className array (HAST convention)
      if (attr.name === 'class') {
        properties.className = attr.value.split(/\s+/).filter(Boolean);
      } else if (attr.name.startsWith('data-')) {
        // Convert data-* attributes to camelCase (HAST convention)
        const camelName = attr.name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        properties[camelName] = attr.value;
      } else if (attr.name === 'colspan' || attr.name === 'rowspan') {
        // Convert colspan/rowspan to camelCase (HAST convention from parse5)
        const camelName = attr.name === 'colspan' ? 'colSpan' : 'rowSpan';
        properties[camelName] = attr.value;
      } else {
        properties[attr.name] = attr.value;
      }
    }

    const children = [];
    for (const child of domNode.childNodes || []) {
      const hastChild = domToHast(child);
      if (hastChild) children.push(hastChild);
    }

    return {
      type: 'element',
      tagName: domNode.tagName.toLowerCase(),
      properties,
      children,
    };
  }

  return null;
}

/**
 * Parse HTML using native DOMParser (browser environment)
 */
function parseWithDOMParser(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, 'text/html');
  const body = doc.body;

  // Convert to HAST-like structure
  return {
    type: 'root',
    children: Array.from(body.childNodes).map(domToHast).filter(Boolean),
  };
}

/**
 * Parse HTML - auto-selects best parser for the environment
 * Workers/Node.js: uses pre-loaded hast-util-from-html (async)
 * Browser: uses native DOMParser (sync)
 */
async function parseHTML(html) {
  if (hastUtilFromHtmlModule) {
    // Workers/Node.js path - module is pre-loaded, await resolves immediately after first call
    const { fromHtml } = await hastUtilFromHtmlModule;
    return fromHtml(html, { fragment: true });
  }
  // Browser path - sync DOMParser
  return parseWithDOMParser(html);
}

export { parseHTML };
