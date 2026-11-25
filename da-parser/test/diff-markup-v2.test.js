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
import * as Y from 'yjs';
import { expect } from './test-utils.js';
import { aem2doc, doc2aem } from '../src/doc/parser.js';

const collapseWhitespace = (str) => str.replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim();

const page = (body) => collapseWhitespace(`
<body>
  <header></header>
  <main><div>${body}</div></main>
  <footer></footer>
</body>`);

const roundTrip = (html) => {
  const yDoc = new Y.Doc();
  aem2doc(html, yDoc);
  return collapseWhitespace(doc2aem(yDoc));
};

const SRC = 'data-diff-group="g1" data-diff-side="source" data-diff-kind="changed" data-diff-reason="differs"';
const LOCAL = 'data-diff-group="g1" data-diff-side="local" data-diff-kind="changed"';

describe('Diff markup v2', () => {
  it('round trips v2 attributes on a deleted and added paragraph', () => {
    const html = page(`<da-diff-deleted data-mdast="ignore" ${SRC}><p>Source</p></da-diff-deleted><p da-diff-added="" ${LOCAL}>Mine</p>`);
    expect(roundTrip(html)).to.equal(html);
  });

  it('round trips v2 attributes on an added heading', () => {
    const html = page(`<h2 da-diff-added="" ${LOCAL}>Mine</h2>`);
    expect(roundTrip(html)).to.equal(html);
  });

  it('round trips v2 attributes on an added and a deleted block', () => {
    const html = page(`<da-diff-deleted data-mdast="ignore" ${SRC}><div class="cards"><div><div><p>Source</p></div></div></div></da-diff-deleted><div class="cards" da-diff-added="" ${LOCAL}><div><div><p>Mine</p></div></div></div>`);
    expect(roundTrip(html)).to.equal(html);
  });

  it('round trips v2 attributes on added and deleted list items', () => {
    const html = page(`<ul><da-diff-deleted data-mdast="ignore" ${SRC}><li>Source</li></da-diff-deleted><li da-diff-added="" ${LOCAL}>Mine</li><li>Same</li></ul>`);
    expect(roundTrip(html)).to.equal(html);
  });

  it('keeps v2 attributes on every unit of an added block group', () => {
    const html = page(`<div class="block-group-start" da-diff-added="" ${LOCAL}><div><div><p>Start</p></div></div></div><div class="columns"><div><div><p>Col</p></div></div></div><div class="block-group-end" da-diff-added=""><div><div><p>End</p></div></div></div>`);
    const first = roundTrip(html);
    expect(first).to.include(`<div class="block-group-start" da-diff-added="" ${LOCAL}>`);
    expect(first).to.include(`<div class="columns" da-diff-added="" ${LOCAL}>`);
    expect(first).to.include(`<div class="block-group-end" da-diff-added="" ${LOCAL}>`);
    expect(roundTrip(first)).to.equal(first);
  });

  it('round trips da-diff-base with a paragraph and a block', () => {
    const html = page(`<da-diff-base data-mdast="ignore" data-diff-group="g1"><p>Was</p><div class="cards"><div><div><p>Old</p></div></div></div></da-diff-base><da-diff-deleted data-mdast="ignore" ${SRC}><p>Source</p></da-diff-deleted><p da-diff-added="" ${LOCAL}>Mine</p>`);
    expect(roundTrip(html)).to.equal(html);
  });

  it('round trips da-diff-base holding a list', () => {
    const html = page('<da-diff-base data-mdast="ignore" data-diff-group="g2"><ul><li>Old item</li></ul></da-diff-base><p>After</p>');
    expect(roundTrip(html)).to.equal(html);
  });

  it('round trips v2 attributes on an added linked picture', () => {
    const html = page(`<a href="https://new.example.com" title="New" da-diff-added="" ${LOCAL}><picture><source srcset="https://new.example.com/image.jpg"><source srcset="https://new.example.com/image.jpg" media="(min-width: 600px)"><img src="https://new.example.com/image.jpg" alt="New"></picture></a>`);
    expect(roundTrip(html)).to.equal(html);
  });

  it('round trips the diff marker and v2 attributes on an added picture', () => {
    const html = page(`<picture da-diff-added="" ${LOCAL}><source srcset="https://new.example.com/image.jpg"><source srcset="https://new.example.com/image.jpg" media="(min-width: 600px)"><img src="https://new.example.com/image.jpg" alt="New" loading="lazy"></picture>`);
    expect(roundTrip(html)).to.equal(html);
  });

  it('keeps v2 attributes on an added edit-as image link', () => {
    const html = page(`<a href="https://new.example.com/image.jpg" title="New" data-edit-as="image" da-diff-added="" ${LOCAL}>https://new.example.com/image.jpg</a>`);
    const first = roundTrip(html);
    expect(first).to.include(`<p da-diff-added="" ${LOCAL}>`);
    expect(roundTrip(first)).to.equal(first);
  });

  describe('keeping added content', () => {
    const keepAdded = (html) => {
      const yDoc = new Y.Doc();
      aem2doc(html, yDoc);
      const fragment = yDoc.getXmlFragment('prosemirror');
      const wrappers = fragment.toArray().filter((node) => node.nodeName === 'diff_added');
      const nested = wrappers.flatMap((node) => node.toArray())
        .flatMap((child) => [...child.createTreeWalker(() => true)])
        .filter((node) => node.getAttribute?.('daDiffAdded') != null)
        .map((node) => node.nodeName);
      fragment.toArray().forEach((node, idx) => {
        if (node.nodeName !== 'diff_added') return;
        const kept = node.toArray().map((child) => child.clone());
        kept.forEach((child) => child.removeAttribute('daDiffAdded'));
        fragment.delete(idx, 1);
        fragment.insert(idx, kept);
      });
      return { wrappers, nested, kept: collapseWhitespace(doc2aem(yDoc)) };
    };

    [
      ['a linked picture', `<a href="https://new.example.com" title="New" da-diff-added="" ${LOCAL}><picture><source srcset="https://new.example.com/image.jpg"><source srcset="https://new.example.com/image.jpg" media="(min-width: 600px)"><img src="https://new.example.com/image.jpg" alt="New"></picture></a>`],
      ['a picture', `<picture da-diff-added="" ${LOCAL}><source srcset="https://new.example.com/image.jpg"><source srcset="https://new.example.com/image.jpg" media="(min-width: 600px)"><img src="https://new.example.com/image.jpg" alt="New" loading="lazy"></picture>`],
      ['a paragraph', `<p da-diff-added="" ${LOCAL}>Mine</p>`],
    ].forEach(([name, body]) => {
      it(`leaves no diff marker below the wrapper's units or after keeping ${name}`, () => {
        const { wrappers, nested, kept } = keepAdded(page(body));
        expect(wrappers).to.have.length(1);
        expect(nested).to.deep.equal([]);
        expect(kept).to.not.include('da-diff-added');
        expect(kept).to.not.include('data-diff-');
      });
    });
  });

  it('keeps v1 markup unchanged', () => {
    const html = page('<da-diff-deleted data-mdast="ignore"><p>Source</p></da-diff-deleted><p da-diff-added="">Mine</p>');
    expect(roundTrip(html)).to.equal(html);
  });
});
