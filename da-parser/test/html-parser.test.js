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
/* eslint-disable no-unused-expressions */

import { expect, isNode } from './test-utils.js';
import { matches, parseHTML, domToHast } from '../src/html-parser.js';

/**
 * Create a mock DOM text node
 */
function createTextNode(text) {
  return {
    nodeType: 3, // TEXT_NODE
    textContent: text,
  };
}

/**
 * Create a mock DOM comment node
 */
function createCommentNode(text) {
  return {
    nodeType: 8, // COMMENT_NODE
    textContent: text,
  };
}

/**
 * Create a mock DOM element node
 */
function createElementNode(tagName, attributes = {}, children = []) {
  const attrs = Object.entries(attributes).map(([name, value]) => ({ name, value }));
  return {
    nodeType: 1, // ELEMENT_NODE
    tagName: tagName.toUpperCase(),
    attributes: attrs,
    childNodes: children,
  };
}

/**
 * Create an unsupported node type (e.g., document fragment)
 */
function createUnsupportedNode() {
  return {
    nodeType: 11, // DOCUMENT_FRAGMENT_NODE
  };
}

describe('html-parser.js test suite', () => {
  describe('matches() function', () => {
    it('returns false for null node', () => {
      expect(matches('p', null)).to.be.false;
    });

    it('returns false for undefined node', () => {
      expect(matches('p', undefined)).to.be.false;
    });

    it('returns false for non-element nodes', () => {
      const textNode = { type: 'text', value: 'hello' };
      expect(matches('p', textNode)).to.be.false;
    });

    it('matches simple tag selectors', () => {
      const pNode = { type: 'element', tagName: 'p', properties: {} };
      expect(matches('p', pNode)).to.be.true;
      expect(matches('div', pNode)).to.be.false;
    });

    it('matches tag selectors case-insensitively', () => {
      const divNode = { type: 'element', tagName: 'div', properties: {} };
      expect(matches('DIV', divNode)).to.be.true;
      expect(matches('Div', divNode)).to.be.true;
    });

    it('matches attribute presence selectors', () => {
      const imgWithSrc = { type: 'element', tagName: 'img', properties: { src: 'test.jpg' } };
      expect(matches('img[src]', imgWithSrc)).to.be.true;
      expect(matches('img[alt]', imgWithSrc)).to.be.false;
    });

    it('matches attribute selector with null/undefined properties', () => {
      const imgNoProps = { type: 'element', tagName: 'img' };
      expect(matches('img[src]', imgNoProps)).to.be.false;
    });

    it('matches attribute selector with empty string value', () => {
      const imgWithEmptySrc = { type: 'element', tagName: 'img', properties: { src: '' } };
      // Empty string is still a value, so it should match
      expect(matches('img[src]', imgWithEmptySrc)).to.be.true;
    });

    it('matches attribute selector with zero value', () => {
      const nodeWithZero = { type: 'element', tagName: 'input', properties: { value: 0 } };
      expect(matches('input[value]', nodeWithZero)).to.be.true;
    });

    it('returns false for attribute selector with wrong tag', () => {
      const divWithSrc = { type: 'element', tagName: 'div', properties: { src: 'test.jpg' } };
      expect(matches('img[src]', divWithSrc)).to.be.false;
    });

    it('handles a[href] selector', () => {
      const linkWithHref = { type: 'element', tagName: 'a', properties: { href: 'https://example.com' } };
      expect(matches('a[href]', linkWithHref)).to.be.true;
    });

    it('handles various attribute selectors', () => {
      const inputWithType = { type: 'element', tagName: 'input', properties: { type: 'text' } };
      expect(matches('input[type]', inputWithType)).to.be.true;

      const divWithClass = { type: 'element', tagName: 'div', properties: { className: ['foo'] } };
      expect(matches('div[className]', divWithClass)).to.be.true;
    });
  });

  describe('parseHTML() function', () => {
    it('parses simple paragraph HTML', () => {
      const result = parseHTML('<p>Hello World</p>');
      expect(result.type).to.equal('root');
      expect(result.children.length).to.be.greaterThan(0);
    });

    it('parses nested HTML structure', () => {
      const result = parseHTML('<div><p>Nested</p></div>');
      expect(result.type).to.equal('root');
      expect(result.children.length).to.be.greaterThan(0);
    });

    it('parses HTML with attributes', () => {
      const result = parseHTML('<a href="https://example.com">Link</a>');
      expect(result.type).to.equal('root');

      // Find the anchor element
      const findElement = (node, tagName) => {
        if (node.tagName === tagName) return node;
        if (node.children) {
          for (const child of node.children) {
            const found = findElement(child, tagName);
            if (found) return found;
          }
        }
        return null;
      };

      const anchor = findElement(result, 'a');
      expect(anchor).to.not.be.null;
      expect(anchor.properties.href).to.equal('https://example.com');
    });

    it('parses empty HTML', () => {
      const result = parseHTML('');
      expect(result.type).to.equal('root');
    });

    it('parses HTML with comments', () => {
      const result = parseHTML('<!-- comment --><p>Text</p>');
      expect(result.type).to.equal('root');
    });

    it('parses HTML with multiple root elements', () => {
      const result = parseHTML('<p>First</p><p>Second</p>');
      expect(result.type).to.equal('root');
      expect(result.children.length).to.be.greaterThanOrEqual(2);
    });
  });

  // Browser-only tests for DOMParser code path
  // These tests exercise domToHast and parseWithDOMParser indirectly
  describe('Browser DOMParser path (browser only)', () => {
    // Skip these tests in Node.js since DOMParser isn't available
    before(function skipInNode() {
      if (isNode) {
        this.skip();
      }
    });

    it('converts text nodes correctly', () => {
      const result = parseHTML('Hello World');
      expect(result.type).to.equal('root');
      // Should have a text node in the tree
      const hasTextNode = (node) => {
        if (node.type === 'text' && node.value.includes('Hello World')) return true;
        if (node.children) {
          return node.children.some(hasTextNode);
        }
        return false;
      };
      expect(hasTextNode(result)).to.be.true;
    });

    it('converts elements with class attribute to className array', () => {
      const result = parseHTML('<div class="foo bar baz">Content</div>');

      const findDiv = (node) => {
        if (node.tagName === 'div') return node;
        if (node.children) {
          for (const child of node.children) {
            const found = findDiv(child);
            if (found) return found;
          }
        }
        return null;
      };

      const div = findDiv(result);
      expect(div).to.not.be.null;
      expect(div.properties.className).to.deep.equal(['foo', 'bar', 'baz']);
    });

    it('converts data-* attributes to camelCase', () => {
      const result = parseHTML('<div data-test-value="123" data-id="abc">Content</div>');

      const findDiv = (node) => {
        if (node.tagName === 'div') return node;
        if (node.children) {
          for (const child of node.children) {
            const found = findDiv(child);
            if (found) return found;
          }
        }
        return null;
      };

      const div = findDiv(result);
      expect(div).to.not.be.null;
      expect(div.properties.dataTestValue).to.equal('123');
      expect(div.properties.dataId).to.equal('abc');
    });

    it('converts colspan and rowspan to camelCase', () => {
      // Wrap td in table structure - browsers strip td elements outside tables
      const result = parseHTML('<table><tr><td colspan="2" rowspan="3">Cell</td></tr></table>');

      const findTd = (node) => {
        if (node.tagName === 'td') return node;
        if (node.children) {
          for (const child of node.children) {
            const found = findTd(child);
            if (found) return found;
          }
        }
        return null;
      };

      const td = findTd(result);
      expect(td).to.not.be.null;
      expect(td.properties.colSpan).to.equal('2');
      expect(td.properties.rowSpan).to.equal('3');
    });

    it('preserves regular attributes as-is', () => {
      const result = parseHTML('<img src="test.jpg" alt="Test image">');

      const findImg = (node) => {
        if (node.tagName === 'img') return node;
        if (node.children) {
          for (const child of node.children) {
            const found = findImg(child);
            if (found) return found;
          }
        }
        return null;
      };

      const img = findImg(result);
      expect(img).to.not.be.null;
      expect(img.properties.src).to.equal('test.jpg');
      expect(img.properties.alt).to.equal('Test image');
    });

    it('handles deeply nested structures', () => {
      const result = parseHTML('<div><ul><li><a href="#">Link</a></li></ul></div>');

      const findElement = (node, tagName) => {
        if (node.tagName === tagName) return node;
        if (node.children) {
          for (const child of node.children) {
            const found = findElement(child, tagName);
            if (found) return found;
          }
        }
        return null;
      };

      expect(findElement(result, 'div')).to.not.be.null;
      expect(findElement(result, 'ul')).to.not.be.null;
      expect(findElement(result, 'li')).to.not.be.null;
      expect(findElement(result, 'a')).to.not.be.null;
    });

    it('handles elements with no attributes', () => {
      const result = parseHTML('<span>Text</span>');

      const findSpan = (node) => {
        if (node.tagName === 'span') return node;
        if (node.children) {
          for (const child of node.children) {
            const found = findSpan(child);
            if (found) return found;
          }
        }
        return null;
      };

      const span = findSpan(result);
      expect(span).to.not.be.null;
      expect(span.properties).to.deep.equal({});
    });

    it('handles HTML comments', () => {
      const result = parseHTML('<!-- This is a comment --><p>Text</p>');
      expect(result.type).to.equal('root');

      // Check if comment node exists
      const hasComment = (node) => {
        if (node.type === 'comment') return true;
        if (node.children) {
          return node.children.some(hasComment);
        }
        return false;
      };

      expect(hasComment(result)).to.be.true;
    });

    it('handles empty class attribute', () => {
      const result = parseHTML('<div class="">Content</div>');

      const findDiv = (node) => {
        if (node.tagName === 'div') return node;
        if (node.children) {
          for (const child of node.children) {
            const found = findDiv(child);
            if (found) return found;
          }
        }
        return null;
      };

      const div = findDiv(result);
      expect(div).to.not.be.null;
      // Empty class should result in empty className array
      expect(div.properties.className).to.deep.equal([]);
    });

    it('handles mixed content with text and elements', () => {
      const result = parseHTML('<p>Text <strong>bold</strong> more text</p>');

      const findP = (node) => {
        if (node.tagName === 'p') return node;
        if (node.children) {
          for (const child of node.children) {
            const found = findP(child);
            if (found) return found;
          }
        }
        return null;
      };

      const p = findP(result);
      expect(p).to.not.be.null;
      expect(p.children.length).to.be.greaterThan(1);
    });

    it('handles whitespace-only text nodes', () => {
      const result = parseHTML('<div>   </div>');

      const findDiv = (node) => {
        if (node.tagName === 'div') return node;
        if (node.children) {
          for (const child of node.children) {
            const found = findDiv(child);
            if (found) return found;
          }
        }
        return null;
      };

      const div = findDiv(result);
      expect(div).to.not.be.null;
    });
  });

  // Tests using mock DOM objects to directly test domToHast logic
  // These work in both Node.js and browser environments
  describe('domToHast() direct tests with mock DOM', () => {
    it('converts text node (nodeType 3)', () => {
      const textNode = createTextNode('Hello World');
      const result = domToHast(textNode);
      expect(result).to.deep.equal({ type: 'text', value: 'Hello World' });
    });

    it('converts comment node (nodeType 8)', () => {
      const commentNode = createCommentNode('This is a comment');
      const result = domToHast(commentNode);
      expect(result).to.deep.equal({ type: 'comment', value: 'This is a comment' });
    });

    it('converts element node (nodeType 1) with no attributes', () => {
      const elementNode = createElementNode('div');
      const result = domToHast(elementNode);
      expect(result).to.deep.equal({
        type: 'element',
        tagName: 'div',
        properties: {},
        children: [],
      });
    });

    it('converts element node with simple attributes', () => {
      const elementNode = createElementNode('a', { href: 'https://example.com', title: 'Example' });
      const result = domToHast(elementNode);
      expect(result.type).to.equal('element');
      expect(result.tagName).to.equal('a');
      expect(result.properties.href).to.equal('https://example.com');
      expect(result.properties.title).to.equal('Example');
    });

    it('converts class attribute to className array', () => {
      const elementNode = createElementNode('div', { class: 'foo bar baz' });
      const result = domToHast(elementNode);
      expect(result.properties.className).to.deep.equal(['foo', 'bar', 'baz']);
    });

    it('handles empty class attribute', () => {
      const elementNode = createElementNode('div', { class: '' });
      const result = domToHast(elementNode);
      expect(result.properties.className).to.deep.equal([]);
    });

    it('handles class with extra whitespace', () => {
      const elementNode = createElementNode('div', { class: '  foo   bar  ' });
      const result = domToHast(elementNode);
      expect(result.properties.className).to.deep.equal(['foo', 'bar']);
    });

    it('converts data-* attributes to camelCase', () => {
      const elementNode = createElementNode('div', {
        'data-test-value': '123',
        'data-id': 'abc',
        'data-foo-bar-baz': 'xyz',
      });
      const result = domToHast(elementNode);
      expect(result.properties.dataTestValue).to.equal('123');
      expect(result.properties.dataId).to.equal('abc');
      expect(result.properties.dataFooBarBaz).to.equal('xyz');
    });

    it('converts colspan to colSpan (camelCase)', () => {
      const elementNode = createElementNode('td', { colspan: '2' });
      const result = domToHast(elementNode);
      expect(result.properties.colSpan).to.equal('2');
      expect(result.properties.colspan).to.be.undefined;
    });

    it('converts rowspan to rowSpan (camelCase)', () => {
      const elementNode = createElementNode('td', { rowspan: '3' });
      const result = domToHast(elementNode);
      expect(result.properties.rowSpan).to.equal('3');
      expect(result.properties.rowspan).to.be.undefined;
    });

    it('preserves regular attributes as-is', () => {
      const elementNode = createElementNode('img', {
        src: 'test.jpg',
        alt: 'Test image',
        loading: 'lazy',
      });
      const result = domToHast(elementNode);
      expect(result.properties.src).to.equal('test.jpg');
      expect(result.properties.alt).to.equal('Test image');
      expect(result.properties.loading).to.equal('lazy');
    });

    it('handles element with children', () => {
      const childText = createTextNode('Hello');
      const childElement = createElementNode('strong', {}, [createTextNode('World')]);
      const parentElement = createElementNode('p', {}, [childText, childElement]);

      const result = domToHast(parentElement);
      expect(result.type).to.equal('element');
      expect(result.tagName).to.equal('p');
      expect(result.children.length).to.equal(2);
      expect(result.children[0]).to.deep.equal({ type: 'text', value: 'Hello' });
      expect(result.children[1].type).to.equal('element');
      expect(result.children[1].tagName).to.equal('strong');
    });

    it('handles deeply nested elements', () => {
      const deepChild = createTextNode('Deep text');
      const level3 = createElementNode('span', {}, [deepChild]);
      const level2 = createElementNode('em', {}, [level3]);
      const level1 = createElementNode('strong', {}, [level2]);
      const root = createElementNode('p', {}, [level1]);

      const result = domToHast(root);
      // Navigate through: p > strong > em > span > text
      expect(result.children[0].children[0].children[0].children[0].value).to.equal('Deep text');
    });

    it('returns null for unsupported node types', () => {
      const unsupportedNode = createUnsupportedNode();
      const result = domToHast(unsupportedNode);
      expect(result).to.be.null;
    });

    it('filters out null children from unsupported nodes', () => {
      const textNode = createTextNode('Valid');
      const unsupportedNode = createUnsupportedNode();
      const parentElement = createElementNode('div', {}, [textNode, unsupportedNode]);

      const result = domToHast(parentElement);
      expect(result.children.length).to.equal(1);
      expect(result.children[0].value).to.equal('Valid');
    });

    it('handles element with null/undefined childNodes', () => {
      const elementNode = {
        nodeType: 1,
        tagName: 'BR',
        attributes: [],
        childNodes: null,
      };
      const result = domToHast(elementNode);
      expect(result.type).to.equal('element');
      expect(result.tagName).to.equal('br');
      expect(result.children).to.deep.equal([]);
    });

    it('handles element with undefined attributes', () => {
      const elementNode = {
        nodeType: 1,
        tagName: 'DIV',
        attributes: undefined,
        childNodes: [],
      };
      const result = domToHast(elementNode);
      expect(result.type).to.equal('element');
      expect(result.properties).to.deep.equal({});
    });

    it('converts tagName to lowercase', () => {
      const elementNode = createElementNode('DIV');
      // Force uppercase tagName
      elementNode.tagName = 'DIV';
      const result = domToHast(elementNode);
      expect(result.tagName).to.equal('div');
    });
  });

  // Tests for parseWithDOMParser path using mock DOMParser
  // Note: In Node.js, parseHTML uses fromHtml, so we test domToHast directly
  // The browser tests above will cover parseWithDOMParser when run in browser
  describe('parseWithDOMParser coverage via browser tests', () => {
    // These tests only run in browser environment where DOMParser is available
    before(function skipInNode() {
      if (isNode) {
        this.skip();
      }
    });

    it('parseWithDOMParser is called when DOMParser exists', () => {
      // This test exercises parseWithDOMParser through parseHTML in browser
      const result = parseHTML('<div><p>Test content</p></div>');
      expect(result.type).to.equal('root');
      expect(result.children.length).to.be.greaterThan(0);
    });

    it('parseWithDOMParser wraps content in body tag', () => {
      const result = parseHTML('<span>Wrapped</span>');
      expect(result.type).to.equal('root');
      // Content should be parsed and converted to HAST
    });

    it('parseWithDOMParser handles complex HTML', () => {
      const html = `
        <div class="container" data-id="main">
          <h1>Title</h1>
          <p class="intro">Paragraph with <strong>bold</strong> text</p>
          <ul>
            <li>Item 1</li>
            <li>Item 2</li>
          </ul>
        </div>
      `;
      const result = parseHTML(html);
      expect(result.type).to.equal('root');
    });
  });

  describe('parseHTML() general tests', () => {
    it('parseHTML returns correct structure for simple HTML', () => {
      const result = parseHTML('<p>Test</p>');
      expect(result).to.have.property('type', 'root');
      expect(result).to.have.property('children');
    });

    it('parseHTML handles tables with colspan/rowspan', () => {
      const html = '<table><tr><td colspan="2" rowspan="2">Cell</td></tr></table>';
      const result = parseHTML(html);
      expect(result.type).to.equal('root');
    });

    it('parseHTML handles complex nested structure', () => {
      const html = `
        <div class="container">
          <header>
            <h1 data-id="title">Title</h1>
          </header>
          <main>
            <p>Content</p>
          </main>
        </div>
      `;
      const result = parseHTML(html);
      expect(result.type).to.equal('root');
    });

    it('parseHTML handles self-closing tags', () => {
      const result = parseHTML('<br><hr><img src="test.jpg">');
      expect(result.type).to.equal('root');
    });

    it('parseHTML handles special characters in text', () => {
      const result = parseHTML('<p>&lt;script&gt; &amp; &quot;quotes&quot;</p>');
      expect(result.type).to.equal('root');
    });
  });
});
