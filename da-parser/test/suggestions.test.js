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
import { getSchema } from '../src/doc/schema.js';

const collapseTagWhitespace = (str) => str.replace(/>\s+</g, '><');
const collapseWhitespace = (str) => collapseTagWhitespace(str.replace(/\s+/g, ' ')).trim();

const roundTrip = (html) => {
  const ydoc = new Y.Doc();
  aem2doc(html, ydoc);
  return collapseWhitespace(doc2aem(ydoc));
};

const page = (inner) => `
  <body>
    <header></header>
    <main><div>${inner}</div></main>
    <footer></footer>
  </body>`;

describe('Suggestion marks', () => {
  it('registers both marks in the schema', () => {
    const schema = getSchema();
    expect(schema.marks.suggestion_insert).to.exist;
    expect(schema.marks.suggestion_delete).to.exist;
  });

  it('round trips an insertion', () => {
    const html = page('<p>Hello <da-suggestion-added data-username="ada" data-mdast="ignore">brave </da-suggestion-added>world</p>');
    expect(roundTrip(html)).to.equal(collapseWhitespace(html));
  });

  it('round trips a deletion', () => {
    const html = page('<p>Hello <da-suggestion-deleted data-username="ada">cruel </da-suggestion-deleted>world</p>');
    expect(roundTrip(html)).to.equal(collapseWhitespace(html));
  });

  it('round trips the suggestion timestamp', () => {
    const html = page('<p>Hello <da-suggestion-added data-username="ada" data-created-at="1760000000000" data-mdast="ignore">brave </da-suggestion-added>world</p>');
    expect(roundTrip(html)).to.equal(collapseWhitespace(html));
  });

  it('round trips an insertion and deletion side by side', () => {
    const html = page('<p>Hello <da-suggestion-deleted data-username="ada">cruel</da-suggestion-deleted><da-suggestion-added data-username="ada" data-mdast="ignore">brave</da-suggestion-added> world</p>');
    expect(roundTrip(html)).to.equal(collapseWhitespace(html));
  });

  it('keeps the suggestion inside other marks', () => {
    const html = page('<p><strong>Hello <da-suggestion-added data-username="ada" data-mdast="ignore">there</da-suggestion-added></strong></p>');
    expect(roundTrip(html)).to.equal(collapseWhitespace(html));
  });

  it('survives a document with no suggestions', () => {
    const html = page('<p>Hello world</p>');
    expect(roundTrip(html)).to.equal(collapseWhitespace(html));
  });
});

const picture = (src, imgAttrs = '') => `<picture><source srcset="${src}"><source srcset="${src}" media="(min-width: 600px)"><img src="${src}"${imgAttrs} loading="lazy"></picture>`;

describe('Image suggestions', () => {
  it('round trips a suggested image', () => {
    const html = page(`<p>Hi ${picture('https://x.com/a.png', ' data-suggestion="insert" data-suggestion-username="ada" data-suggestion-created-at="1760000000000" data-mdast="ignore"')}</p>`);
    expect(roundTrip(html)).to.equal(collapseWhitespace(html));
  });

  it('round trips an image suggested for deletion', () => {
    const html = page(`<p>Hi ${picture('https://x.com/a.png', ' data-suggestion="delete" data-suggestion-username="ada"')}</p>`);
    expect(roundTrip(html)).to.equal(collapseWhitespace(html));
  });

  it('round trips a replaced image as a delete next to an insert', () => {
    const html = page(`<p>Hi ${picture('https://x.com/old.png', ' data-suggestion="delete" data-suggestion-username="ada"')}${picture('https://x.com/new.png', ' data-suggestion="insert" data-suggestion-username="ada" data-mdast="ignore"')}</p>`);
    expect(roundTrip(html)).to.equal(collapseWhitespace(html));
  });

  it('round trips a suggested link-img', () => {
    const html = page('<p><a href="https://x.com/a.png" data-edit-as="image" data-suggestion="insert" data-suggestion-username="ada" data-mdast="ignore">https://x.com/a.png</a></p>');
    expect(roundTrip(html)).to.equal(collapseWhitespace(html));
  });

  it('drops an unknown suggestion value', () => {
    const html = page(`<p>Hi ${picture('https://x.com/a.png', ' data-suggestion="bogus"')}</p>`);
    expect(roundTrip(html)).to.equal(collapseWhitespace(page(`<p>Hi ${picture('https://x.com/a.png')}</p>`)));
  });
});

describe('Block suggestions', () => {
  it('round trips a block suggested for insertion', () => {
    const html = page('<div class="hero" data-suggestion="insert" data-suggestion-username="ada" data-suggestion-created-at="1760000000000" data-mdast="ignore"><div><div><p>Hi</p></div></div></div>');
    expect(roundTrip(html)).to.equal(collapseWhitespace(html));
  });

  it('round trips a block suggested for deletion', () => {
    const html = page('<div class="hero dark" data-suggestion="delete" data-suggestion-username="ada"><div><div><p>Hi</p></div></div></div>');
    expect(roundTrip(html)).to.equal(collapseWhitespace(html));
  });

  it('leaves blocks without a suggestion untouched', () => {
    const html = page('<div class="hero"><div><div><p>Hi</p></div></div></div>');
    expect(roundTrip(html)).to.equal(collapseWhitespace(html));
  });

  it('parses the suggestion onto the table node', () => {
    const ydoc = new Y.Doc();
    aem2doc(page('<div class="hero" data-suggestion="delete" data-suggestion-username="ada"><div><div>Hi</div></div></div>'), ydoc);
    const table = ydoc.getXmlFragment('prosemirror').toArray().find((el) => el.nodeName === 'table');
    expect(table.getAttribute('suggestion')).to.equal('delete');
    expect(table.getAttribute('suggestionUsername')).to.equal('ada');
  });
});
