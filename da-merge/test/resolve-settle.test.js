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
import { expect } from './test-utils.js';
import { v2Merge, adapter } from './resolve-utils.js';
import { CHOICE, LOC_MARKERS, formatRolloutBase } from '../src/index.js';

const PATH = '/org/site/page.html';
const site = 'site';
const config = { config: { data: [] } };
const hashing = { site, config };

const rows = (metadata) => Object.entries(metadata)
  .map(([key, value]) => `<div><div>${key}</div><div>${value}</div></div>`).join('');

const page = (main, metadata = {}) => `<body><header></header><main><div>${main}</div></main>${
  Object.keys(metadata).length ? `<div class="da-metadata">${rows(metadata)}</div>` : ''
}<footer></footer></body>`;

const copy = (options) => v2Merge.applyCopy({
  path: PATH, site, config, recordBaseline: true, ...options,
});

const hasMarkup = (html) => !!v2Merge.parse(html).querySelector(`${LOC_MARKERS}, da-diff-base`);
const textOf = (html) => v2Merge.parse(html).querySelector('main').textContent;

function resolveEach(html, choice) {
  const { groups } = v2Merge.diffSummary(html);
  const resolved = groups
    .reduce((acc, { id }) => v2Merge.resolveHtml(acc, id, choice, hashing) ?? acc, html);
  return v2Merge.resolveAllHtml(resolved, choice, hashing) ?? resolved;
}

const baseOf = async (html) => formatRolloutBase(PATH, await v2Merge.getBlockHashes({
  doc: v2Merge.parse(adapter.canonicalize(html)), ...hashing,
}));

// The author deletes everything, and the page loses its baseline: the next copy is a fresh one.
const emptied = (html) => html.replace(/<main>[\s\S]*<\/main>/, '<main><div></div></main>')
  .replace(/<div><div>rolloutbase<\/div><div>[^<]*<\/div><\/div>/, '');

const group = (text) => `<div class="block-group-start"><div><div>start</div></div></div><p>${text}</p><div class="block-group-end"><div><div>end</div></div></div>`;
const list = (...items) => `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;

const CASES = {
  blocks: {
    source: page('<p>Intro</p><p>Upstream only</p><p>End</p>'),
    target: page('<p>Intro</p><p>Local only</p><p>End</p>'),
    upstream: 'Upstream only',
    local: 'Local only',
  },
  'list items': {
    source: page(`<p>Intro</p>${list('One', 'Two', 'Upstream item')}`),
    target: page(`<p>Intro</p>${list('One', 'Two', 'Local item')}`),
    upstream: 'Upstream item',
    local: 'Local item',
  },
  'block groups': {
    source: page(`<p>Intro</p>${group('Upstream group')}<p>End</p>`),
    target: page(`<p>Intro</p>${group('Local group')}<p>End</p>`),
    upstream: 'Upstream group',
    local: 'Local group',
  },
};

describe('resolve, then copy again', () => {
  Object.entries(CASES).forEach(([name, {
    source, target, upstream, local,
  }]) => {
    describe(name, () => {
      Object.values(CHOICE).forEach((choice) => {
        it(`merge settles after "${choice}"`, async () => {
          const first = await copy({ source, target, behavior: 'merge' });
          expect(hasMarkup(first.html)).to.equal(true);
          const resolved = resolveEach(first.html, choice);
          expect(hasMarkup(resolved)).to.equal(false);
          const next = await copy({ source, target: resolved, behavior: 'merge' });
          expect(next.report.outcome).to.not.equal('needs-review');
          if (next.html) expect(hasMarkup(next.html)).to.equal(false);
          const text = textOf(next.html ?? resolved);
          expect(text.includes(upstream)).to.equal([CHOICE.source, CHOICE.both].includes(choice));
          expect(text.includes(local)).to.equal([CHOICE.mine, CHOICE.both].includes(choice));
        });
      });

      it('smart-overwrite keeps a reject from its first review when the source changes elsewhere', async () => {
        const first = await copy({ source, target, behavior: 'smart-overwrite' });
        expect(first.report.reason).to.equal('no-baseline');
        const resolved = resolveEach(first.html, CHOICE.mine);
        const changed = source.replace('<p>Intro</p>', '<p>Intro changed</p>');
        const next = await copy({ source: changed, target: resolved, behavior: 'smart-overwrite' });
        expect(hasMarkup(next.html)).to.equal(false);
        expect(textOf(next.html)).to.include('Intro changed');
        expect(textOf(next.html)).to.not.include(upstream);
      });

      it('smart-overwrite keeps a reject out of a page the author emptied', async () => {
        const first = await copy({ source, target, behavior: 'merge' });
        const resolved = resolveEach(first.html, CHOICE.mine);
        const next = await copy({ source, target: emptied(resolved), behavior: 'smart-overwrite' });
        expect(textOf(next.html)).to.include('Intro');
        expect(textOf(next.html)).to.not.include(upstream);
      });
    });
  });

  it('settles a smart-overwrite conflict for every choice', async () => {
    const base = page('<p>A</p><p>B</p><p>C</p>');
    const source = page('<p>A</p><p>B upstream</p><p>C</p>');
    const target = page('<p>A</p><p>B local</p><p>C</p>', { rolloutbase: await baseOf(base) });
    await Promise.all(Object.values(CHOICE).map(async (choice) => {
      const first = await copy({ source, target, behavior: 'smart-overwrite', baselineHtml: base });
      expect(first.report.groups.map(({ reason }) => reason)).to.deep.equal(['both-changed']);
      const resolved = resolveEach(first.html, choice);
      expect(hasMarkup(resolved)).to.equal(false);
      const next = await copy({ source, target: resolved, behavior: 'smart-overwrite' });
      expect(next.report.outcome).to.equal('unchanged');
    }));
  });

  it('keeps a reject of an hlx.page link once the author empties the page', async () => {
    const base = page('<p>A</p><p>B</p>');
    const source = page('<p>A</p><p>B <a href="https://main--site--org.hlx.page/x">new</a></p>');
    const target = page('<p>A</p><p>B local</p>', { rolloutbase: await baseOf(base) });
    const first = await copy({ source, target, behavior: 'smart-overwrite' });
    expect(first.html).to.include('hlx.page');
    const resolved = resolveEach(first.html, CHOICE.mine);
    const next = await copy({ source, target: emptied(resolved), behavior: 'smart-overwrite' });
    expect(textOf(next.html)).to.include('A');
    expect(textOf(next.html)).to.not.include('new');
    const undecided = emptied(resolved).replace(/<div><div>rejectedHashes<\/div><div>[^<]*<\/div><\/div>/, '');
    const offered = await copy({ source, target: undecided, behavior: 'smart-overwrite' });
    expect(textOf(offered.html)).to.include('new');
  });
});
