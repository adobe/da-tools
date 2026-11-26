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
import { expect, daMerge, sortAttributes } from './test-utils.js';
import {
  getRolloutBase, formatRolloutBase, isEmptyMain, countLocalBlocks, withBaselineRow,
  readMetadata, getElementMetadata, DA_METADATA_SELECTOR, ROLLOUT_BASE_KEY, ROLLOUT_ORDER_KEY,
} from '../src/index.js';

const { smartRollout, getSectionedMain, getBlockHashes } = daMerge;

const PATH = '/org/site/page.html';
const site = 'site';
const config = { config: { data: [] } };

const rows = (metadata) => Object.entries(metadata)
  .map(([key, value]) => `<div><div>${key}</div><div>${value}</div></div>`).join('');

const page = (main, metadata = {}) => daMerge.parse(`<body><header></header><main>${main}</main>${
  Object.keys(metadata).length ? `<div class="da-metadata">${rows(metadata)}</div>` : ''
}<footer></footer></body>`);

const hashesOf = (doc) => getBlockHashes({ doc, site, config });

const rollout = (source, dest, options = {}) => smartRollout({
  source, dest, path: PATH, site, config, ...options,
});

describe('smart-overwrite helpers', () => {
  it('reads a rolloutbase only for the same path and well-formed hashes', () => {
    const hash = 'abcdef012345';
    const metadataEl = (value) => page('<div></div>', { rolloutbase: value })
      .querySelector(DA_METADATA_SELECTOR);
    expect(getRolloutBase(metadataEl(`/ORG/site/page.html|${hash}`), PATH)).to.deep.equal([hash]);
    expect(getRolloutBase(metadataEl(`/org/site/other.html|${hash}`), PATH)).to.equal(null);
    expect(getRolloutBase(metadataEl(`${PATH}|not-a-hash`), PATH)).to.equal(null);
    expect(getRolloutBase(metadataEl(`${PATH}|`), PATH)).to.deep.equal([]);
  });

  it('formats a rolloutbase with a lowercase path', () => {
    expect(formatRolloutBase('/Org/Site/Page.html', ['a', 'b'])).to.equal('/org/site/page.html|a,b');
  });

  it('returns main only when all content sits in main > div sections', () => {
    expect(getSectionedMain(page('<div><p>A</p></div>'))).to.not.equal(null);
    expect(getSectionedMain(page('<p>Loose</p>'))).to.equal(null);
    expect(getSectionedMain(page('<div>Loose text</div>'))).to.equal(null);
    expect(getSectionedMain(daMerge.parse('<body><p>No main</p></body>'))).to.equal(null);
  });

  it('treats main as empty only without text or attributes', () => {
    const mainOf = (html) => page(html).querySelector('body > main');
    expect(isEmptyMain(mainOf('<div><p></p></div>'))).to.equal(true);
    expect(isEmptyMain(mainOf('<div><p>Text</p></div>'))).to.equal(false);
    expect(isEmptyMain(mainOf('<div class="hero"></div>'))).to.equal(false);
  });

  it('counts target blocks with no matching source block, one for one', () => {
    expect(countLocalBlocks(['a', 'b', 'b'], ['b', 'c', 'b', 'b'])).to.equal(2);
  });

  it('writes a new rolloutbase and drops the recorded order', () => {
    const doc = page('<div><p>A</p></div>', { [ROLLOUT_BASE_KEY]: 'old', [ROLLOUT_ORDER_KEY]: 'order', keep: 'me' });
    const html = withBaselineRow(doc, `${PATH}|abcdef012345`);
    const metadata = getElementMetadata(daMerge.parse(html).querySelector(DA_METADATA_SELECTOR));
    expect(metadata[ROLLOUT_BASE_KEY].content.textContent).to.equal(`${PATH}|abcdef012345`);
    expect(metadata[ROLLOUT_ORDER_KEY]).to.equal(undefined);
    expect(metadata.keep.text).to.equal('me');
  });
});

describe('smartRollout', () => {
  it('copies the source when there is no target', async () => {
    const source = page('<div><p>A</p><p>B</p></div>');
    const result = await rollout(source, null);
    expect(result.html).to.equal('<div><p>A</p><p>B</p></div>');
    expect(result.skipped).to.equal(0);
    expect(result.sourceHashes).to.deep.equal(await hashesOf(source));
  });

  it('reports unchanged when the source still matches the baseline', async () => {
    const source = page('<div><p>A</p><p>B</p></div>');
    const base = formatRolloutBase(PATH, await hashesOf(source));
    const result = await rollout(source, page('<div><p>A local</p><p>B</p></div>', { rolloutbase: base }));
    expect(result).to.deep.equal({ unchanged: true, reordered: false });
  });

  it('applies a source change and keeps a local change against the baseline', async () => {
    const base = formatRolloutBase(PATH, await hashesOf(page('<div><p>A</p><p>B</p></div>')));
    const source = page('<div><p>A</p><p>B2</p></div>');
    const dest = page('<div><p>A local</p><p>B</p></div>', { rolloutbase: base });
    const result = await rollout(source, dest);
    expect(result.html).to.equal('<div><p>A local</p><p>B2</p></div>');
    expect(result.review).to.equal(false);
    expect(result.sourceHashes).to.deep.equal(await hashesOf(source));
    expect(result.daMetadata.rolloutbase).to.equal(base);
  });

  it('marks every difference for review on the first copy', async () => {
    const source = page('<div><p>A</p><p>B</p></div>');
    const dest = page('<div><p>A local</p><p>B</p></div>');
    const result = await rollout(source, dest);
    expect(result.review).to.equal(true);
    expect(result.reason).to.equal('no-baseline');
    expect(sortAttributes(result.html)).to.include(sortAttributes('<da-diff-deleted data-mdast="ignore" data-diff-group="g1" data-diff-side="source" data-diff-kind="changed" data-diff-reason="no-baseline"><p>A</p></da-diff-deleted>'));
    expect(sortAttributes(result.html)).to.include(sortAttributes('<p da-diff-added="" data-diff-group="g1" data-diff-side="local" data-diff-kind="changed">A local</p>'));
  });

  it('keeps the target as is on the first copy when it matches the source', async () => {
    const result = await rollout(page('<div><p>A</p></div>'), page('<div><p>A</p></div>'));
    expect(result.html).to.equal('<div><p>A</p></div>');
    expect(result.review).to.equal(undefined);
  });

  it('copies the source into an empty target and keeps its review decisions', async () => {
    const source = page('<div><p>A</p><p>B</p></div>', { title: 'Source' });
    const dest = page('<div></div>', { rejectedhashes: 'abcdef012345' });
    const result = await rollout(source, dest);
    expect(result.html).to.equal('<div><p>A</p><p>B</p></div>');
    expect(result.daMetadata).to.deep.equal({ title: 'Source', rejectedhashes: 'abcdef012345' });
  });

  it('reads metadata values as authored', () => {
    const metadataEl = page('<div></div>', { Key: '<strong>Mixed</strong> Case' })
      .querySelector(DA_METADATA_SELECTOR);
    expect(readMetadata(metadataEl)).to.deep.equal({ key: '<strong>Mixed</strong> Case' });
  });
});
