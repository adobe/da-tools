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

// Regression coverage for the silent-data-loss path tracked in COR-27 / COR-30.
// Typed-string attrs deposited by buggy clients (or direct Yjs writes) must not
// be allowed to brick doc2aem.

import * as Y from 'yjs';
import { prosemirrorToYXmlFragment } from 'y-prosemirror';
import { expect } from './test-utils.js';
import { doc2aem } from '../src/doc/parser.js';
import { getSchema } from '../src/doc/schema.js';

const collapseTagWhitespace = (str) => str.replace(/>\s+</g, '><');
const collapseWhitespace = (str) => collapseTagWhitespace(str.replace(/\s+/g, ' ')).trim();

const baseImageAttrs = {
  src: 'https://example.com/foo.jpg',
  alt: 'ok',
  title: null,
  href: null,
  dataFocalX: null,
  dataFocalY: null,
  dataId: null,
  daDiffAdded: null,
};

function buildYDocWithImage(overrides) {
  const schema = getSchema();
  const image = schema.nodes.image.create({ ...baseImageAttrs, ...overrides });
  const para = schema.nodes.paragraph.create(null, [image]);
  const doc = schema.nodes.doc.create(null, [para]);
  const ydoc = new Y.Doc();
  prosemirrorToYXmlFragment(doc, ydoc.getXmlFragment('prosemirror'));
  return ydoc;
}

function findYXmlElement(yFragment, nodeName) {
  if (!yFragment) return null;
  if (yFragment.nodeName === nodeName) return yFragment;
  if (typeof yFragment.toArray !== 'function') return null;
  // eslint-disable-next-line no-restricted-syntax
  for (const child of yFragment.toArray()) {
    const found = findYXmlElement(child, nodeName);
    if (found) return found;
  }
  return null;
}

function corruptImageAttr(ydoc, attrName, badValue) {
  const xmlFragment = ydoc.getXmlFragment('prosemirror');
  const image = findYXmlElement(xmlFragment, 'image');
  if (!image) throw new Error('test setup: image Y.XmlElement not found');
  image.setAttribute(attrName, badValue);
  return ydoc;
}

describe('doc2aem typed-string attr coercion', () => {
  it('does not throw when image.alt is an object', () => {
    const ydoc = buildYDocWithImage();
    corruptImageAttr(ydoc, 'alt', { malformed: true });
    expect(() => doc2aem(ydoc)).to.not.throw();
  });

  it('emits no alt attribute when alt was coerced from object', () => {
    const ydoc = buildYDocWithImage();
    corruptImageAttr(ydoc, 'alt', { malformed: true });
    const result = collapseWhitespace(doc2aem(ydoc));
    expect(result).to.not.match(/alt="\[object Object\]"/);
    expect(result).to.not.match(/alt="\{/);
    expect(/<img[^>]*alt="[^"]*"[^>]*>/.test(result)).to.equal(
      false,
      'alt should be dropped when coerced from a non-string non-null value',
    );
  });

  it('does not throw when image.title is an object', () => {
    const ydoc = buildYDocWithImage();
    corruptImageAttr(ydoc, 'title', { weird: 1 });
    expect(() => doc2aem(ydoc)).to.not.throw();
  });

  it('does not throw when image.href is an array', () => {
    const ydoc = buildYDocWithImage();
    corruptImageAttr(ydoc, 'href', [1, 2, 3]);
    expect(() => doc2aem(ydoc)).to.not.throw();
  });

  it('does not throw when image.dataFocalX is a number', () => {
    const ydoc = buildYDocWithImage();
    corruptImageAttr(ydoc, 'dataFocalX', 0.5);
    expect(() => doc2aem(ydoc)).to.not.throw();
  });

  it('does not throw when image.dataFocalY is a boolean', () => {
    const ydoc = buildYDocWithImage();
    corruptImageAttr(ydoc, 'dataFocalY', true);
    expect(() => doc2aem(ydoc)).to.not.throw();
  });

  it('does not throw when image.src is a non-string non-null value', () => {
    const ydoc = buildYDocWithImage();
    corruptImageAttr(ydoc, 'src', { weird: true });
    expect(() => doc2aem(ydoc)).to.not.throw();
  });

  it('preserves valid alt strings', () => {
    const ydoc = buildYDocWithImage({ alt: 'a cat photo' });
    const result = doc2aem(ydoc);
    expect(result).to.include('alt="a cat photo"');
  });

  it('preserves valid title strings', () => {
    const ydoc = buildYDocWithImage({ alt: 'cat', title: 'tabby' });
    const result = doc2aem(ydoc);
    expect(result).to.include('title="tabby"');
  });

  it('preserves null alt as non-emitted attribute (round-trip)', () => {
    const ydoc = buildYDocWithImage({ alt: null });
    const result = doc2aem(ydoc);
    expect(/<img[^>]*alt="[^"]*"[^>]*>/.test(result)).to.equal(
      false,
      'null alt should remain dropped',
    );
  });

  it('coerces top-level attrs (dataId) on block nodes', () => {
    const schema = getSchema();
    const para = schema.nodes.paragraph.create({ dataId: null, daDiffAdded: null });
    const doc = schema.nodes.doc.create(null, [para]);
    const ydoc = new Y.Doc();
    prosemirrorToYXmlFragment(doc, ydoc.getXmlFragment('prosemirror'));

    const xmlFragment = ydoc.getXmlFragment('prosemirror');
    const paraNode = findYXmlElement(xmlFragment, 'paragraph');
    expect(paraNode, 'paragraph Y.XmlElement').to.exist;
    paraNode.setAttribute('dataId', { not: 'a string' });
    expect(() => doc2aem(ydoc)).to.not.throw();
  });

  it('warns once per (doc,nodeType,attr) for malformed values', () => {
    const ydoc = buildYDocWithImage();
    corruptImageAttr(ydoc, 'alt', { malformed: true });
    const original = console.warn;
    const calls = [];
    // eslint-disable-next-line no-console
    console.warn = (...args) => calls.push(args.join(' '));
    try {
      doc2aem(ydoc);
      doc2aem(ydoc); // second call should NOT re-warn for the same (doc,type,attr)
    } finally {
      // eslint-disable-next-line no-console
      console.warn = original;
    }
    const altWarns = calls.filter((c) => c.includes('alt') && c.includes('image'));
    expect(altWarns.length, 'exactly one warn for the same (doc,type,attr)').to.equal(1);
  });
});
