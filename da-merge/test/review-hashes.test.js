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
import { expect, daMerge, canonicalize } from './test-utils.js';
import { reviewHash } from '../src/block-hash.js';
import { formatRolloutBase } from '../src/index.js';

const PATH = '/org/site/page.html';
const site = 'site';
const config = { config: { data: [] } };

const rows = (metadata) => Object.entries(metadata)
  .map(([key, value]) => `<div><div>${key}</div><div>${value}</div></div>`).join('');

const page = (main, metadata = {}) => `<body><header></header><main><div>${main}</div></main>${
  Object.keys(metadata).length ? `<div class="da-metadata">${rows(metadata)}</div>` : ''
}<footer></footer></body>`;

const copy = (options) => daMerge.applyCopy({
  path: PATH, site, config, ...options,
});

const canonicalMain = (html) => daMerge.parse(canonicalize(html)).querySelector('main');

const itemHash = (html, text) => reviewHash([...canonicalMain(html).querySelectorAll('li')]
  .find((li) => li.textContent.trim() === text));

const groupHash = (html) => {
  const blocks = [...canonicalMain(html).querySelector(':scope > div').children];
  const start = blocks.findIndex((el) => el.classList.contains('block-group-start'));
  const end = blocks.findIndex((el) => el.classList.contains('block-group-end'));
  return reviewHash(blocks.slice(start, end + 1));
};

const group = (text) => `<div class="block-group-start"><div><div>start</div></div></div><p>${text}</p><div class="block-group-end"><div><div>end</div></div></div>`;

const baseOf = (html) => daMerge.getBlockHashes({
  doc: daMerge.parse(canonicalize(html)), site, config,
});

const MARKERS = 'da-diff-deleted, da-diff-added, [da-diff-added]';
const markersOf = (html) => [...daMerge.parse(html).querySelectorAll(MARKERS)];
const textOf = (html) => daMerge.parse(html).querySelector('main').textContent;

describe('review hashes of list items and block groups', () => {
  const list = (...items) => `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;

  describe('merge', () => {
    it('leaves out a source list item the author rejected', async () => {
      const source = page(`<p>Intro</p>${list('One', 'Two', 'New')}`);
      const target = page(`<p>Intro</p>${list('One', 'Two')}`);
      const offered = await copy({ source, target, behavior: 'merge', recordBaseline: false });
      expect(markersOf(offered.html)).to.have.length(1);
      const rejected = await copy({
        source,
        target: page(`<p>Intro</p>${list('One', 'Two')}`, { rejectedHashes: itemHash(source, 'New') }),
        behavior: 'merge',
        recordBaseline: false,
      });
      expect(markersOf(rejected.html)).to.have.length(0);
      expect(textOf(rejected.html)).to.not.include('New');
    });

    it('keeps a list item the author accepted without marking it', async () => {
      const source = page(list('One', 'Two', 'Mine'));
      const target = page(list('One', 'Two', 'Theirs'));
      const result = await copy({
        source,
        target: page(list('One', 'Two', 'Theirs'), {
          acceptedHashes: `${itemHash(source, 'Mine')},${itemHash(target, 'Theirs')}`,
        }),
        behavior: 'merge',
        recordBaseline: false,
      });
      expect(markersOf(result.html)).to.have.length(0);
      expect(textOf(result.html)).to.include('Mine');
      expect(textOf(result.html)).to.include('Theirs');
    });

    it('leaves out a source block group the author rejected', async () => {
      const source = page(`<p>Intro</p>${group('Grouped')}`);
      const rejected = await copy({
        source,
        target: page('<p>Intro</p>', { rejectedHashes: groupHash(source) }),
        behavior: 'merge',
        recordBaseline: false,
      });
      expect(markersOf(rejected.html)).to.have.length(0);
      expect(textOf(rejected.html)).to.not.include('Grouped');
    });

    it('keeps a block group the author accepted without marking it', async () => {
      const target = page(`<p>Intro</p>${group('Local group')}`);
      const result = await copy({
        source: page('<p>Intro</p>'),
        target: page(`<p>Intro</p>${group('Local group')}`, { acceptedHashes: groupHash(target) }),
        behavior: 'merge',
        recordBaseline: false,
      });
      expect(markersOf(result.html)).to.have.length(0);
      expect(textOf(result.html)).to.include('Local group');
    });

    it('still offers a block group that was not decided', async () => {
      const source = page(`<p>Intro</p>${group('Grouped')}`);
      const result = await copy({
        source, target: page('<p>Intro</p>', { rejectedHashes: 'aaaaaaaaaaaa' }), behavior: 'merge', recordBaseline: false,
      });
      expect(markersOf(result.html)).to.have.length(1);
    });
  });

  describe('smart-overwrite', () => {
    it('keeps rejected list items and block groups out of an emptied page', async () => {
      const source = page(`${list('One', 'New')}${group('Grouped')}<p>Kept</p>`);
      const rejectedHashes = `${itemHash(source, 'New')},${groupHash(source)}`;
      const result = await copy({
        source, target: page('', { rejectedHashes }), behavior: 'smart-overwrite',
      });
      const text = textOf(result.html);
      expect(text).to.include('One');
      expect(text).to.include('Kept');
      expect(text).to.not.include('New');
      expect(text).to.not.include('Grouped');
    });

    it('drops a list emptied by rejected items from an emptied page', async () => {
      const source = page(`${list('Only')}<p>Kept</p>`);
      const result = await copy({
        source, target: page('', { rejectedHashes: itemHash(source, 'Only') }), behavior: 'smart-overwrite',
      });
      expect(daMerge.parse(result.html).querySelector('main ul')).to.equal(null);
    });

    it('leaves out a rejected source block group', async () => {
      const before = page('<p>Intro</p><p>End</p>');
      const source = page(`<p>Intro</p>${group('Grouped')}<p>End</p>`);
      const base = await baseOf(before);
      const target = page('<p>Intro local</p><p>End</p>', {
        rolloutbase: formatRolloutBase(PATH, base), rejectedHashes: groupHash(source),
      });
      const result = await copy({ source, target, behavior: 'smart-overwrite' });
      expect(result.html).to.equal(null);
      expect(result.report.outcome).to.equal('unchanged');
      const unrejected = await copy({
        source,
        target: page('<p>Intro local</p><p>End</p>', { rolloutbase: formatRolloutBase(PATH, base) }),
        behavior: 'smart-overwrite',
      });
      expect(textOf(unrejected.html)).to.include('Grouped');
    });

    it('leaves out a rejected source item when it merges a list item by item', async () => {
      const before = page(list('One', 'Two'));
      const source = page(list('One', 'Two', 'New'));
      const base = await baseOf(before);
      const open = '<li><da-diff-added data-diff-group="g1" data-diff-side="local" data-diff-kind="added">Local</da-diff-added></li>';
      const target = page(`<ul><li>One</li><li>Two</li>${open}</ul>`, {
        rolloutbase: formatRolloutBase(PATH, base), rejectedHashes: itemHash(source, 'New'),
      });
      const result = await copy({ source, target, behavior: 'smart-overwrite' });
      expect(result.html).to.equal(null);
      expect(result.report.outcome).to.equal('needs-review');
      const unrejected = await copy({
        source,
        target: page(`<ul><li>One</li><li>Two</li>${open}</ul>`, { rolloutbase: formatRolloutBase(PATH, base) }),
        behavior: 'smart-overwrite',
      });
      expect(textOf(unrejected.html)).to.include('New');
    });

    it('leaves out a rejected source item the page has in another list when it merges a list item by item', async () => {
      const before = page(`${list('One', 'Two')}<p>Mid</p>${list('New')}`);
      const source = page(`${list('One', 'Two', 'New')}<p>Mid</p>${list('New')}`);
      const base = await baseOf(before);
      const open = '<li><da-diff-added data-diff-group="g1" data-diff-side="local" data-diff-kind="added">Local</da-diff-added></li>';
      const target = page(`<ul><li>One</li><li>Two</li>${open}</ul><p>Mid</p>${list('New')}`, {
        rolloutbase: formatRolloutBase(PATH, base), rejectedHashes: itemHash(source, 'New'),
      });
      const result = await copy({ source, target, behavior: 'smart-overwrite' });
      expect(result.report.contentChanged).to.equal(false);
      const items = [...daMerge.parse(result.html ?? target).querySelectorAll('main li')]
        .map((li) => li.textContent);
      expect(items).to.deep.equal(['One', 'Two', 'Local', 'New']);
    });
  });
});
