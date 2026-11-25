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
import {
  expect, daMerge, rawMerge, dom, withoutGroups,
} from './test-utils.js';
import DaMerge, {
  removeLocTags, formatRolloutBase, getElementMetadata, DA_METADATA_SELECTOR,
} from '../src/index.js';

const PATH = '/org/site/page.html';
const site = 'site';
const config = { config: { data: [] } };

const rows = (metadata) => Object.entries(metadata)
  .map(([key, value]) => `<div><div>${key}</div><div>${value}</div></div>`).join('');

const page = (main, metadata = {}) => `<body><header></header><main>${main}</main>${
  Object.keys(metadata).length ? `<div class="da-metadata">${rows(metadata)}</div>` : ''
}<footer></footer></body>`;

const doc = (html, engine = daMerge) => engine.parse(html);
const mainOf = (html, engine = daMerge) => doc(html, engine).querySelector('body > main').innerHTML;
const metadataOf = (html) => getElementMetadata(doc(html).querySelector(DA_METADATA_SELECTOR));

const copy = (options, engine = daMerge) => engine.applyCopy({
  path: PATH, site, config, ...options,
});

const marker = (el) => ({
  group: el.getAttribute('data-diff-group'),
  side: el.getAttribute('data-diff-side'),
  kind: el.getAttribute('data-diff-kind'),
  reason: el.getAttribute('data-diff-reason'),
});

const markers = (html, engine = daMerge) => [...doc(`<body><main>${html}</main></body>`, engine)
  .querySelectorAll('da-diff-deleted, [da-diff-added], da-diff-added')].map(marker);

const openTarget = page('<div><da-diff-deleted data-mdast="ignore" data-diff-group="g1" data-diff-side="source" data-diff-kind="changed" data-diff-reason="differs"><p>A</p></da-diff-deleted><p da-diff-added="" data-diff-group="g1" data-diff-side="local" data-diff-kind="changed">A local</p></div>');

const resolveAsMine = (html) => {
  const resolved = doc(html);
  removeLocTags(resolved);
  return resolved.body.outerHTML;
};

describe('grouped diff markup', () => {
  const toDoc = (main) => daMerge.parse(page(main));

  it('groups a changed unit into one group with both sides', async () => {
    const main = await daMerge.regionalDiff(toDoc('<div><p>A</p><p>B</p></div>'), toDoc('<div><p>A local</p><p>B</p></div>'));
    expect(markers(main.innerHTML)).to.deep.equal([
      {
        group: 'g1', side: 'source', kind: 'changed', reason: 'differs',
      },
      {
        group: 'g1', side: 'local', kind: 'changed', reason: null,
      },
    ]);
  });

  it('gives separate changes their own groups, and a one-sided change kind added', async () => {
    const main = await daMerge.regionalDiff(
      toDoc('<div><p>A</p><p>B</p><p>C</p></div>'),
      toDoc('<div><p>A2</p><p>B</p><p>C</p><p>D local</p></div>'),
    );
    const found = markers(main.innerHTML);
    expect(found.map(({ group }) => group)).to.deep.equal(['g1', 'g1', 'g2']);
    expect(found[2]).to.deep.equal({
      group: 'g2', side: 'local', kind: 'added', reason: 'differs',
    });
  });

  it('groups changed list items inside the list', async () => {
    const main = await daMerge.regionalDiff(
      toDoc('<div><ul><li>A</li><li>B</li><li>C</li></ul></div>'),
      toDoc('<div><ul><li>A</li><li>B local</li><li>C</li></ul></div>'),
    );
    const found = markers(main.innerHTML);
    expect(found).to.have.length(2);
    expect(new Set(found.map(({ group }) => group)).size).to.equal(1);
    expect(found.map(({ side }) => side)).to.deep.equal(['source', 'local']);
  });

  const conflict = {
    base: '<div><p>A</p><p>B</p><p>C</p></div>',
    source: '<div><p>A2</p><p>X</p><p>B2</p><p>C</p></div>',
    dest: '<div><p>A local</p><p>B</p><p>C</p></div>',
  };

  it('marks a 3-way conflict as both-changed', async () => {
    const base = await daMerge.getBlockHashes({ doc: toDoc(conflict.base), site, config });
    const { html, review } = await daMerge.smartMerge({
      base, source: toDoc(conflict.source), dest: toDoc(conflict.dest), site, config,
    });
    expect(review).to.equal(true);
    const local = {
      group: 'g1', side: 'local', kind: 'changed', reason: null,
    };
    expect(markers(html)).to.deep.equal([
      {
        group: 'g1', side: 'source', kind: 'changed', reason: 'both-changed',
      },
      local,
      local,
    ]);
  });

  const smartMarkers = async ({ base, source, dest }) => {
    const hashes = await daMerge.getBlockHashes({ doc: toDoc(base), site, config });
    const result = await daMerge.smartMerge({
      base: hashes, source: toDoc(source), dest: toDoc(dest), site, config,
    });
    return { ...result, found: markers(result.html) };
  };

  it('offers both sides when both edited the same unit', async () => {
    const { found, skipped, review } = await smartMarkers({
      base: '<div><p>A</p><p>B</p><p>C</p></div>',
      source: '<div><p>A</p><p>G</p><p>C</p></div>',
      dest: '<div><p>A</p><p>L</p><p>C</p></div>',
    });
    expect(found).to.deep.equal([
      {
        group: 'g1', side: 'source', kind: 'changed', reason: 'both-changed',
      },
      {
        group: 'g1', side: 'local', kind: 'changed', reason: null,
      },
    ]);
    expect(skipped).to.equal(0);
    expect(review).to.equal(true);
  });

  it('marks a local unit that the source removed as a local-only group of kind removed', async () => {
    const { found, skipped, removedUpstream } = await smartMarkers({
      base: '<div><p>A</p><p>B</p><p>C</p></div>',
      source: '<div><p>A</p><p>C</p></div>',
      dest: '<div><p>A</p><p>L</p><p>C</p></div>',
    });
    expect(found).to.deep.equal([{
      group: 'g1', side: 'local', kind: 'removed', reason: 'both-changed',
    }]);
    expect(skipped).to.equal(0);
    expect(removedUpstream).to.equal(1);
  });

  it('writes the reason on one marker of a group with several local units', async () => {
    const { found } = await smartMarkers({
      base: '<div><p>A</p></div><div><p>B</p><p>C</p></div>',
      source: '<div><p>A</p></div>',
      dest: '<div><p>A</p></div><div><p>B local</p><p>C local</p></div>',
    });
    expect(found).to.deep.equal([
      {
        group: 'g1', side: 'local', kind: 'removed', reason: 'both-changed',
      },
      {
        group: 'g1', side: 'local', kind: 'removed', reason: null,
      },
    ]);
  });

  it('writes the reason once for a group that spans sections', async () => {
    const { found } = await smartMarkers({
      base: '<div><p>A</p></div><div><p>B</p></div><div><p>C</p></div>',
      source: '<div><p>A</p></div>',
      dest: '<div><p>A</p></div><div><p>B local</p></div><div><p>C local</p></div>',
    });
    expect(new Set(found.map(({ group }) => group)).size).to.equal(1);
    expect(found.filter(({ reason }) => reason)).to.have.length(1);
  });

  it('offers only the units new to the page as a source-only group of kind added', async () => {
    const { html, found } = await smartMarkers({
      base: '<div><h1>H</h1><p>A</p><p>B</p></div>',
      source: '<div><h1>H</h1><p>A</p><p>Y</p><p>B</p></div>',
      dest: '<div><h1>H</h1></div>',
    });
    expect(found).to.deep.equal([{
      group: 'g1', side: 'source', kind: 'added', reason: 'both-changed',
    }]);
    expect(html).to.include('<da-diff-deleted data-mdast="ignore" data-diff-group="g1" data-diff-side="source" data-diff-kind="added" data-diff-reason="both-changed"><p>Y</p></da-diff-deleted>');
    expect(html).to.not.include('<p>A</p>');
  });

  it('offers a source addition to a section the page removed at the end of the section before it', async () => {
    const { html, found } = await smartMarkers({
      base: '<div><p>A</p></div><div><p>B</p></div><div><p>C</p></div>',
      source: '<div><p>A</p></div><div><p>B</p><p>N</p></div><div><p>C</p></div>',
      dest: '<div><p>A</p></div><div><p>C</p></div>',
    });
    expect(found.map(({ side, kind }) => `${side}:${kind}`)).to.deep.equal(['source:added']);
    expect(withoutGroups(html)).to.equal('<div><p>A</p><da-diff-deleted data-mdast="ignore"><p>N</p></da-diff-deleted></div><div><p>C</p></div>');
  });

  it('marks the page\'s units when the source deleted a section the page edited', async () => {
    const { html, found } = await smartMarkers({
      base: '<div><p>A</p></div><div><p>B</p><p>C</p></div>',
      source: '<div><p>A</p></div>',
      dest: '<div><p>A</p></div><div><p>B local</p><p>C</p></div>',
    });
    expect(found.map(({ side, kind }) => `${side}:${kind}`)).to.deep.equal(['local:removed', 'local:removed']);
    expect(withoutGroups(html)).to.equal('<div><p>A</p></div><div><p da-diff-added="">B local</p><p da-diff-added="">C</p></div>');
  });

  it('keeps the page and counts a skip when the page deleted a unit the source edited', async () => {
    const { html, found, skipped } = await smartMarkers({
      base: '<div><p>A</p><p>B</p><p>C</p></div>',
      source: '<div><p>A</p><p>B2</p><p>C</p></div>',
      dest: '<div><p>A</p><p>C</p></div>',
    });
    expect(found).to.deep.equal([]);
    expect(html).to.equal('<div><p>A</p><p>C</p></div>');
    expect(skipped).to.equal(1);
  });

  it('keeps the page and counts a skip when the source change adds a section break', async () => {
    const { html, found, skipped } = await smartMarkers({
      base: '<div><p>A</p><p>B</p><p>C</p></div>',
      source: '<div><p>A</p></div><div><p>B2</p><p>C</p></div>',
      dest: '<div><p>A</p><p>B local</p><p>C</p></div>',
    });
    expect(found).to.deep.equal([]);
    expect(html).to.equal('<div><p>A</p><p>B local</p><p>C</p></div>');
    expect(skipped).to.equal(1);
  });

  it('keeps the page and counts a skip when both inserted at one spot and one holds a section break', async () => {
    const { html, found, skipped } = await smartMarkers({
      base: '<div><p>A</p><p>B</p></div>',
      source: '<div><p>A</p><p>Y</p></div><div><p>Z</p><p>B</p></div>',
      dest: '<div><p>A</p><p>N</p><p>B</p></div>',
    });
    expect(found).to.deep.equal([]);
    expect(html).to.equal('<div><p>A</p><p>N</p><p>B</p></div>');
    expect(skipped).to.equal(1);
  });

  it('writes the base content of a conflict when the baseline page is given', async () => {
    const baselineDoc = toDoc(conflict.base);
    const base = await daMerge.getBlockHashes({ doc: baselineDoc, site, config });
    const { html } = await daMerge.smartMerge({
      base, source: toDoc(conflict.source), dest: toDoc(conflict.dest), site, config, baselineDoc,
    });
    const result = doc(`<body><main>${html}</main></body>`);
    const baseEl = result.querySelector('da-diff-base');
    expect(baseEl.getAttribute('data-diff-group')).to.equal('g1');
    expect(baseEl.getAttribute('data-mdast')).to.equal('ignore');
    expect(baseEl.innerHTML).to.equal('<p>A</p><p>B</p>');
    expect(baseEl.nextElementSibling.nodeName).to.equal('DA-DIFF-DELETED');
  });

  it('skips the base content when the baseline page does not match the stored baseline', async () => {
    const base = await daMerge.getBlockHashes({ doc: toDoc(conflict.base), site, config });
    const { html } = await daMerge.smartMerge({
      base,
      source: toDoc(conflict.source),
      dest: toDoc(conflict.dest),
      site,
      config,
      baselineDoc: toDoc('<div><p>Other</p><p>B</p><p>C</p></div>'),
    });
    expect(html).to.include('da-diff-deleted');
    expect(html).to.not.include('da-diff-base');
  });
});

describe('smartRollout with open markup', () => {
  const toDoc = (main, metadata) => daMerge.parse(page(main, metadata));
  const openGroup = '<da-diff-deleted data-mdast="ignore" data-diff-group="g1" data-diff-side="source" data-diff-kind="changed" data-diff-reason="both-changed"><p>A2</p></da-diff-deleted><p da-diff-added="" data-diff-group="g1" data-diff-side="local" data-diff-kind="changed">A local</p>';

  it('keeps an open group as is and merges the rest', async () => {
    const base = formatRolloutBase(PATH, await daMerge.getBlockHashes({ doc: toDoc('<div><p>A</p><p>B</p></div>'), site, config }));
    const result = await daMerge.smartRollout({
      source: toDoc('<div><p>A3</p><p>B2</p></div>'),
      dest: toDoc(`<div>${openGroup}<p>B</p></div>`, { rolloutbase: base }),
      path: PATH,
      site,
      config,
    });
    const out = doc(`<body><main>${result.html}</main></body>`);
    expect(out.querySelectorAll('[data-diff-group="g1"]')).to.have.length(2);
    expect(out.querySelector('da-diff-deleted').textContent).to.equal('A2');
    expect(out.querySelector('main > div').lastElementChild.outerHTML).to.equal('<p>B2</p>');
    expect(result.skipped).to.equal(1);
  });

  it('clears an open group when the source now matches its local side', async () => {
    const base = formatRolloutBase(PATH, await daMerge.getBlockHashes({ doc: toDoc('<div><p>A</p><p>B</p></div>'), site, config }));
    const result = await daMerge.smartRollout({
      source: toDoc('<div><p>A local</p><p>B2</p></div>'),
      dest: toDoc(`<div>${openGroup}<p>B</p></div>`, { rolloutbase: base }),
      path: PATH,
      site,
      config,
    });
    expect(result.html).to.equal('<div><p>A local</p><p>B2</p></div>');
    expect(result.skipped).to.equal(0);
  });

  describe('open groups inside a list', () => {
    const rollout = async (dest, source) => {
      const base = formatRolloutBase(PATH, await daMerge.getBlockHashes({ doc: toDoc('<div><ul><li>A</li><li>B</li></ul></div>'), site, config }));
      return daMerge.smartRollout({
        source: toDoc(`<div>${source}</div>`),
        dest: toDoc(`<div>${dest}</div>`, { rolloutbase: base }),
        path: PATH,
        site,
        config,
      });
    };

    it('applies upstream item changes around an open added item', async () => {
      const added = [
        '<li><da-diff-added data-diff-group="g1" data-diff-side="local" data-diff-kind="added">Local</da-diff-added></li>',
        '<li da-diff-added="" data-diff-group="g1" data-diff-side="local" data-diff-kind="added">Local</li>',
      ];
      const results = await Promise.all(added.map((item) => rollout(`<ul><li>A</li><li>B</li>${item}</ul>`, '<ul><li>A2</li><li>B</li></ul>')));
      results.forEach((result, idx) => {
        expect(result.html).to.equal(`<div><ul><li>A2</li><li>B</li>${added[idx]}</ul></div>`);
        expect(result.skipped).to.equal(0);
      });
    });

    it('keeps an open item that upstream changed again, and applies the rest', async () => {
      const open = '<da-diff-deleted data-mdast="ignore" data-diff-group="g1" data-diff-side="source" data-diff-kind="changed"><li>B</li></da-diff-deleted><li da-diff-added="" data-diff-group="g1" data-diff-side="local" data-diff-kind="changed">B local</li>';
      const result = await rollout(`<ul><li>A</li>${open}</ul>`, '<ul><li>A2</li><li>B2</li></ul>');
      expect(result.html).to.equal(`<div><ul><li>A2</li>${open}</ul></div>`);
      expect(result.skipped).to.equal(1);
    });

    it('keeps the list when its open markup does not match the baseline', async () => {
      const dest = '<ul><li>A</li><li>C</li><li><da-diff-added>Local</da-diff-added></li></ul>';
      const result = await rollout(dest, '<ul><li>A2</li><li>B</li></ul>');
      expect(result.html).to.equal(`<div>${dest}</div>`);
      expect(result.skipped).to.equal(1);
    });
  });

  it('falls back to a full review with reason page-too-large above the size cap', async () => {
    const base = formatRolloutBase(PATH, await daMerge.getBlockHashes({ doc: toDoc('<div><p>A</p><p>B</p></div>'), site, config }));
    const result = await daMerge.smartRollout({
      source: toDoc('<div><p>A2</p><p>B</p></div>'),
      dest: toDoc('<div><p>A</p><p>B local</p></div>', { rolloutbase: base }),
      path: PATH,
      site,
      config,
      maxUnits: 2,
    });
    expect(result.reason).to.equal('page-too-large');
    expect(markers(result.html).every(({ group }) => group)).to.equal(true);
    expect(markers(result.html).find(({ reason }) => reason).reason).to.equal('page-too-large');
  });

  it('keeps one group for open grouped markup when the page is too large', async () => {
    const base = formatRolloutBase(PATH, await daMerge.getBlockHashes({ doc: toDoc('<div><p>A</p><p>B</p></div>'), site, config }));
    const result = await daMerge.smartRollout({
      source: toDoc('<div><p>A3</p><p>B</p></div>'),
      dest: toDoc(`<div>${openGroup}<p>B</p></div>`, { rolloutbase: base }),
      path: PATH,
      site,
      config,
      maxUnits: 1,
    });
    expect(result.reason).to.equal('page-too-large');
    const found = markers(result.html);
    expect(found.map(({ group, side }) => [group, side])).to.deep.equal([['g1', 'source'], ['g1', 'local']]);
    expect(found.map(({ kind }) => kind)).to.deep.equal(['changed', 'changed']);
  });
});

describe('applyCopy', () => {
  it('rejects an unknown behavior or a missing source', async () => {
    let error;
    try {
      await copy({ source: page('<div></div>'), behavior: 'replace' });
    } catch (e) {
      error = e;
    }
    expect(error).to.be.instanceOf(TypeError);
    error = undefined;
    try {
      await copy({ behavior: 'merge', recordBaseline: false });
    } catch (e) {
      error = e;
    }
    expect(error).to.be.instanceOf(TypeError);
  });

  describe('canonicalize loss guard', () => {
    const engine = (change) => new DaMerge({ ...dom, canonicalize: change });
    const errorOf = (promise) => promise.then(() => null, (e) => e);

    it('refuses to copy when canonicalizing drops a second main', async () => {
      const target = '<body><main><div><p>A</p></div></main><main><p>Localized</p></main></body>';
      const error = await errorOf(copy({ source: page('<div><p>A2</p></div>'), target, behavior: 'smart-overwrite' }));
      expect(error?.code).to.equal('canonicalize-loss');
    });

    it('names the source as the side that canonicalizing would damage', async () => {
      const error = await errorOf(copy({
        source: page('<div><p>Lost</p></div>'), target: page('<div><p>A</p></div>'), behavior: 'merge', recordBaseline: false,
      }, engine((html) => html.replace('Lost', ''))));
      expect(error?.code).to.equal('canonicalize-loss');
      expect(error.side).to.equal('source');
    });

    it('names the target as the side that canonicalizing would damage', async () => {
      const error = await errorOf(copy({
        source: page('<div><p>A</p></div>'), target: page('<div><p>Lost</p></div>'), behavior: 'merge', recordBaseline: false,
      }, engine((html) => html.replace('Lost', ''))));
      expect(error?.code).to.equal('canonicalize-loss');
      expect(error.side).to.equal('target');
    });

    it('refuses to copy when canonicalizing changes the text or the media and links', async () => {
      const source = page('<div><p>A <a href="/x">link</a></p><p><img src="a.png"></p></div>');
      const changes = [
        (html) => html.replace('A ', 'B '),
        (html) => html.replace(/<img[^>]*>/, ''),
        (html) => html.replace(' href="/x"', ''),
      ];
      const errors = await Promise.all(changes.map((change) => errorOf(copy({
        source, behavior: 'overwrite', recordBaseline: false,
      }, engine(change)))));
      expect(errors.map((e) => e?.code)).to.deep.equal(Array(3).fill('canonicalize-loss'));
    });

    it('ignores what canonicalizing drops on purpose', async () => {
      const raw = '<body><header><p>Nav</p></header><main><div id="s1"><p>A</p><p><a id="top"></a></p></div></main><footer><p>Foot</p></footer></body>';
      const strip = (html) => html.replace(/<header>.*<\/header>/, '<header></header>')
        .replace(/<footer>.*<\/footer>/, '<footer></footer>').replace(' id="s1"', '').replace('<p><a id="top"></a></p>', '');
      const result = await copy({
        source: raw, target: raw, behavior: 'merge', recordBaseline: false,
      }, engine(strip));
      expect(result.report.outcome).to.equal('unchanged');
    });

    it('allows canonicalizing to merge repeated metadata rows, but not to change a value', async () => {
      const stale = '<div><div>rolloutbase</div><div>stale</div></div>';
      const target = page('<div><p>A local</p></div>').replace('<footer>', `<div class="da-metadata">${stale}<div><div>label</div><div>L</div></div>${stale}</div><footer>`);
      const source = page('<div><p>A</p></div>');
      const marked = await daMerge.markInSync({
        source, target, path: PATH, site, config,
      });
      expect(marked.sync).to.equal('marked');
      const error = await errorOf(engine((html) => html.replace('<div>L</div>', '<div></div>')).markInSync({
        source, target, path: PATH, site, config,
      }));
      expect(error?.code).to.equal('canonicalize-loss');
    });

    it('refuses to mark a page in sync when canonicalizing loses content', async () => {
      const target = page('<div><p>A local</p></div>');
      const error = await errorOf(engine((html) => html.replace('A local', '')).markInSync({
        source: page('<div><p>A</p></div>'), target, path: PATH, site, config,
      }));
      expect(error?.code).to.equal('canonicalize-loss');
    });
  });

  it('requires recordBaseline for every behavior but smart-overwrite', async () => {
    const source = page('<div><p>A</p></div>');
    const errors = await Promise.all(['merge', 'overwrite', 'create-only'].map((behavior) => copy({ source, behavior })
      .then(() => null, (e) => e)));
    errors.forEach((error) => expect(error).to.be.instanceOf(TypeError));
    const result = await copy({ source, behavior: 'smart-overwrite' });
    expect(result.report.outcome).to.equal('written');
  });

  describe('equivalent sites', () => {
    const linked = (host) => page(`<div><p><a href="https://main--${host}--org.aem.live/x">X</a></p></div>`);
    const linkCopy = (options) => copy({
      source: linked('other'), target: linked(site), behavior: 'merge', recordBaseline: false, ...options,
    });

    it('marks links to another site as different', async () => {
      expect((await linkCopy()).report.counts.needsReview).to.equal(1);
    });

    it('treats links to an equivalent site as the same', async () => {
      expect((await linkCopy({ equivalentSites: ['other'] })).report.counts.needsReview).to.equal(0);
    });

    it('also uses the hostnames from config', async () => {
      const hostnames = { config: { data: [{ key: 'source.fragment.hostnames', value: 'main--third--org.aem.page' }] } };
      const result = await linkCopy({ config: hostnames, equivalentSites: ['other'] });
      expect(result.report.counts.needsReview).to.equal(0);
      const third = await copy({
        source: linked('third'), target: linked(site), behavior: 'merge', recordBaseline: false, config: hostnames, equivalentSites: ['other'],
      });
      expect(third.report.counts.needsReview).to.equal(0);
    });
  });

  describe('create-only', () => {
    it('skips an empty target', async () => {
      const result = await copy({ source: page('<div><p>A</p></div>'), target: page('<div></div>'), behavior: 'create-only', recordBaseline: false });
      expect(result.html).to.equal(null);
      expect(result.report.outcome).to.equal('skipped');
      expect(result.report.reason).to.equal('exists');
    });

    it('skips an existing target', async () => {
      const result = await copy({ source: page('<div><p>A</p></div>'), target: page('<div><p>B</p></div>'), behavior: 'create-only', recordBaseline: false });
      expect(result.html).to.equal(null);
      expect(result.report.outcome).to.equal('skipped');
    });

    it('writes a missing target', async () => {
      const result = await copy({ source: page('<div><p>A</p></div>'), behavior: 'create-only', recordBaseline: false });
      expect(mainOf(result.html)).to.equal('<div><p>A</p></div>');
      expect(result.report.outcome).to.equal('written');
    });
  });

  describe('overwrite', () => {
    it('writes the source without its review keys, baseline, or markup', async () => {
      const source = page('<div><p>A</p><da-diff-deleted data-mdast="ignore"><p>Up</p></da-diff-deleted></div>', {
        title: 'Title', acceptedhashes: 'abcdef012345', rolloutbase: '/other|abcdef012345',
      });
      const result = await copy({ source, target: page('<div><p>Old</p></div>'), behavior: 'overwrite', recordBaseline: false });
      expect(mainOf(result.html)).to.equal('<div><p>A</p></div>');
      expect(Object.keys(metadataOf(result.html))).to.deep.equal(['title']);
      expect(result.baseline).to.equal(null);
    });

    it('records a baseline when asked', async () => {
      const source = page('<div><p>A</p></div>');
      const result = await copy({ source, behavior: 'overwrite', recordBaseline: true });
      const hashes = await daMerge.getBlockHashes({ doc: doc(source), site, config });
      const expected = formatRolloutBase(PATH, hashes);
      expect(result.baseline).to.equal(expected);
      expect(metadataOf(result.html).rolloutbase.content.textContent).to.equal(expected);
    });

    it('keeps the source baseline and order when a snapshot is involved', async () => {
      const meta = { title: 'T', rolloutbase: `${PATH}|abcdef012345`, rolloutorder: 'x' };
      const source = page('<div><p>A</p></div>', meta);
      const snapshot = '/org/site/.snapshots/s1/page.html';
      const forked = await copy({ source, path: snapshot, behavior: 'overwrite', recordBaseline: false });
      const promoted = await copy({ source, sourcePath: snapshot, behavior: 'overwrite', recordBaseline: true });
      [forked, promoted].forEach((result) => {
        const metadata = metadataOf(result.html);
        expect(Object.keys(metadata)).to.deep.equal(['title', 'rolloutbase', 'rolloutorder']);
        expect(metadata.rolloutbase.content.textContent).to.equal(meta.rolloutbase);
        expect(result.baseline).to.equal(null);
      });
    });

    it('writes the diff labels', async () => {
      const result = await copy({ source: page('<div><p>A</p></div>'), behavior: 'overwrite', recordBaseline: false, labels: { local: 'Mine', upstream: 'Theirs' } });
      expect(metadataOf(result.html)['diff-label-local'].content.textContent).to.equal('Mine');
      expect(metadataOf(result.html)['diff-label-upstream'].content.textContent).to.equal('Theirs');
    });
  });

  describe('merge', () => {
    it('marks every difference with reason differs', async () => {
      const result = await copy({ source: page('<div><p>A</p></div>'), target: page('<div><p>A local</p></div>'), behavior: 'merge', recordBaseline: false });
      expect(result.report.outcome).to.equal('needs-review');
      expect(result.report.groups).to.deep.equal([{
        id: 'g1', reason: 'differs', sides: ['source', 'local'], kinds: ['changed'],
      }]);
      expect(result.report.counts.needsReview).to.equal(1);
      expect(result.report.contentChanged).to.equal(true);
    });

    it('uses reason reviewing-open-markup when the target already had markup', async () => {
      const target = page('<div><da-diff-deleted data-mdast="ignore"><p>Old</p></da-diff-deleted><p da-diff-added="">A local</p></div>');
      const result = await copy({ source: page('<div><p>A</p></div>'), target, behavior: 'merge', recordBaseline: false });
      expect(result.report.groups[0].reason).to.equal('reviewing-open-markup');
      expect(result.html).to.not.include('Old');
    });

    it('writes nothing when the target matches the source', async () => {
      const result = await copy({ source: page('<div><p>A</p></div>'), target: page('<div><p>A</p></div>'), behavior: 'merge', recordBaseline: false });
      expect(result.html).to.equal(null);
      expect(result.report.outcome).to.equal('unchanged');
    });

    it('only records the baseline when the target matches the source', async () => {
      const result = await copy({
        source: page('<div><p>A</p></div>'), target: page('<div><p>A</p></div>'), behavior: 'merge', recordBaseline: true,
      });
      expect(result.report.outcome).to.equal('unchanged');
      expect(result.report.contentChanged).to.equal(false);
      expect(metadataOf(result.html).rolloutbase.content.textContent).to.equal(result.baseline);
    });

    it('drops a stale baseline and order without recordBaseline', async () => {
      const target = page('<div><p>A local</p></div>', { rolloutbase: `${PATH}|abcdef012345`, rolloutorder: 'x', title: 'T' });
      const result = await copy({ source: page('<div><p>A</p></div>'), target, behavior: 'merge', recordBaseline: false });
      expect(Object.keys(metadataOf(result.html))).to.deep.equal(['title']);
    });

    it('keeps the target baseline and order when merging a snapshot back', async () => {
      const base = `${PATH}|abcdef012345`;
      const target = page('<div><p>A local</p></div>', { rolloutbase: base, rolloutorder: 'x', title: 'T' });
      const source = page('<div><p>A</p></div>', { rolloutbase: '/other|abcdef012345' });
      const result = await copy({
        source, target, sourcePath: '/org/site/.snapshots/s1/page.html', behavior: 'merge', recordBaseline: false,
      });
      const metadata = metadataOf(result.html);
      expect(Object.keys(metadata)).to.have.members(['title', 'rolloutbase', 'rolloutorder']);
      expect(metadata.rolloutbase.content.textContent).to.equal(base);
    });

    it('overwrites an empty target', async () => {
      const result = await copy({ source: page('<div><p>A</p></div>'), target: page('<div></div>'), behavior: 'merge', recordBaseline: false });
      expect(mainOf(result.html)).to.equal('<div><p>A</p></div>');
      expect(result.report.outcome).to.equal('written');
    });

    it('keeps one group for a unit that still has open grouped markup', async () => {
      const result = await copy({
        source: page('<div><p>A2</p></div>'), target: openTarget, behavior: 'merge', recordBaseline: false,
      }, rawMerge);
      expect(result.report.groups).to.deep.equal([{
        id: 'g1', reason: 'reviewing-open-markup', sides: ['source', 'local'], kinds: ['changed'],
      }]);
    });

    it('settles open grouped markup when the source matches its local side', async () => {
      const result = await copy({
        source: page('<div><p>A local</p></div>'), target: openTarget, behavior: 'merge', recordBaseline: true,
      }, rawMerge);
      expect(result.report.outcome).to.equal('written');
      expect(mainOf(result.html, rawMerge)).to.equal('<div><p>A local</p></div>');
    });
  });

  describe('smart-overwrite', () => {
    it('keeps one group for a unit that still has open grouped markup and no baseline', async () => {
      const result = await copy({ source: page('<div><p>A2</p></div>'), target: openTarget, behavior: 'smart-overwrite' }, rawMerge);
      expect(result.report.groups).to.deep.equal([{
        id: 'g1', reason: 'no-baseline', sides: ['source', 'local'], kinds: ['changed'],
      }]);
    });

    it('settles open grouped markup without a baseline when the source matches its local side', async () => {
      const result = await copy({ source: page('<div><p>A local</p></div>'), target: openTarget, behavior: 'smart-overwrite' }, rawMerge);
      expect(result.report.outcome).to.equal('written');
      expect(mainOf(result.html, rawMerge)).to.equal('<div><p>A local</p></div>');
    });

    it('reviews every difference on the first copy and records the baseline', async () => {
      const result = await copy({ source: page('<div><p>A</p><p>B</p></div>'), target: page('<div><p>A local</p><p>B</p></div>'), behavior: 'smart-overwrite' });
      expect(result.report.outcome).to.equal('needs-review');
      expect(result.report.reason).to.equal('no-baseline');
      expect(result.report.groups[0].reason).to.equal('no-baseline');
      expect(result.baseline).to.match(/^\/org\/site\/page\.html\|/);
    });

    it('applies a source change and keeps a local change on the next copy', async () => {
      const first = await copy({ source: page('<div><p>A</p><p>B</p></div>'), target: page('<div><p>A local</p><p>B</p></div>'), behavior: 'smart-overwrite' });
      const result = await copy({ source: page('<div><p>A</p><p>B2</p></div>'), target: resolveAsMine(first.html), behavior: 'smart-overwrite' });
      expect(mainOf(result.html)).to.equal('<div><p>A local</p><p>B2</p></div>');
      expect(result.report.outcome).to.equal('written');
      expect(result.report.counts).to.deep.equal({ applied: 1, keptLocal: 1, needsReview: 0 });
    });

    it('writes nothing when the source still matches the baseline', async () => {
      const first = await copy({ source: page('<div><p>A</p></div>'), target: page('<div><p>A local</p></div>'), behavior: 'smart-overwrite' });
      const result = await copy({ source: page('<div><p>A</p></div>'), target: resolveAsMine(first.html), behavior: 'smart-overwrite' });
      expect(result.html).to.equal(null);
      expect(result.report.outcome).to.equal('unchanged');
      expect(result.report.contentChanged).to.equal(false);
    });

    it('needs review when nothing is written but the target still has open groups', async () => {
      const source = page('<div><p>A</p><p>B</p></div>');
      const first = await copy({ source, target: page('<div><p>A local</p><p>B</p></div>'), behavior: 'smart-overwrite' }, rawMerge);
      const result = await copy({ source, target: first.html, behavior: 'smart-overwrite' }, rawMerge);
      expect(result.html).to.equal(null);
      expect(result.report.outcome).to.equal('needs-review');
      expect(result.report.counts.needsReview).to.equal(first.report.counts.needsReview);
      expect(result.report.counts.needsReview).to.be.greaterThan(0);
      expect(result.report.contentChanged).to.equal(false);
    });

    it('reviews a snapshot merged back without its baseline, and keeps the target rows', async () => {
      const source = page('<div><p>A</p></div>');
      const hashes = await daMerge.getBlockHashes({ doc: daMerge.parse(source), site, config });
      const base = formatRolloutBase(PATH, hashes);
      const target = page('<div><p>A local</p></div>', { rolloutbase: base, rolloutorder: 'x' });
      const result = await copy({
        source, target, sourcePath: '/org/site/.snapshots/s1/page.html', behavior: 'smart-overwrite',
      });
      expect(result.report.reason).to.equal('no-baseline');
      expect(result.report.outcome).to.equal('needs-review');
      const metadata = metadataOf(result.html);
      expect(metadata.rolloutbase.content.textContent).to.equal(base);
      expect(metadata.rolloutorder.content.textContent).to.equal('x');
    });

    it('keeps the source rows on a snapshot fork without a target', async () => {
      const meta = { rolloutbase: `${PATH}|abcdef012345`, rolloutorder: 'x' };
      const result = await copy({ source: page('<div><p>A</p></div>', meta), path: '/org/site/.snapshots/s1/page.html', behavior: 'smart-overwrite' });
      const metadata = metadataOf(result.html);
      expect(metadata.rolloutbase.content.textContent).to.equal(meta.rolloutbase);
      expect(metadata.rolloutorder.content.textContent).to.equal('x');
      expect(result.baseline).to.equal(null);
    });

    it('reports missing base content for a conflict without a baseline page', async () => {
      const base = page('<div><p>A</p><p>B</p><p>C</p></div>');
      const first = await copy({ source: base, target: base, behavior: 'smart-overwrite' });
      const edited = first.html.replace('<p>A</p>', '<p>A local</p>');
      const result = await copy({ source: page('<div><p>A2</p><p>X</p><p>B2</p><p>C</p></div>'), target: edited, behavior: 'smart-overwrite' });
      expect(result.report.groups[0].reason).to.equal('both-changed');
      expect(result.report.baselineContent).to.equal('missing');
    });

    it('drops a base element whose group was resolved elsewhere', async () => {
      const target = page('<div><da-diff-base data-mdast="ignore" data-diff-group="g9"><p>Was</p></da-diff-base><p>A</p></div>');
      const result = await copy({ source: page('<div><p>A</p><p>B</p></div>'), target, behavior: 'merge', recordBaseline: false }, rawMerge);
      expect(result.html).to.not.include('Was');
    });
  });

  it('remaps a baseline stored before canonicalizing, so it causes no false conflicts', async () => {
    const original = '<div><h2 id="intro">Intro</h2><p>A</p></div>';
    const rawDoc = rawMerge.parse(page(original));
    const legacyHashes = await rawMerge.getBlockHashes({ doc: rawDoc, site, config });
    const legacyBase = formatRolloutBase(PATH, legacyHashes);
    const result = await copy({
      source: page('<div><h2 id="intro">Intro</h2><p>A2</p></div>'),
      target: page(original, { rolloutbase: legacyBase }),
      behavior: 'smart-overwrite',
    });
    expect(result.report.legacyHashes).to.be.greaterThan(0);
    expect(result.report.outcome).to.equal('written');
    expect(mainOf(result.html)).to.equal('<div><h2>Intro</h2><p>A2</p></div>');
  });
});

describe('metadata key case', () => {
  const rowsOf = (html) => [...doc(html).querySelectorAll(`${DA_METADATA_SELECTOR} > div`)]
    .map(({ children: [key, value] }) => [key.textContent, value.textContent]);
  const source = page('<div><p>A</p></div>');

  it('reads rows case-insensitively and merges rows that differ only by case into the first', () => {
    const el = doc(page('<div></div>', { rejectedHashes: 'aaa', rejectedhashes: 'bbb' })).querySelector(DA_METADATA_SELECTOR);
    expect(getElementMetadata(el).rejectedhashes.text).to.equal('aaa,bbb');
  });

  it('writes each existing row back with its original key', async () => {
    const target = page('<div><p>A local</p></div>', { Title: 'T', rejectedHashes: 'aaa', acceptedHashes: 'ccc' });
    const result = await copy({ source, target, behavior: 'merge', recordBaseline: false });
    expect(rowsOf(result.html)).to.deep.equal([['Title', 'T'], ['rejectedHashes', 'aaa'], ['acceptedHashes', 'ccc']]);
  });

  it('merges rows that differ only by case into the first row when it rewrites metadata', async () => {
    const target = page('<div><p>A local</p></div>', { rejectedHashes: 'aaa', rejectedhashes: 'bbb' });
    const result = await copy({ source, target, behavior: 'smart-overwrite' });
    expect(rowsOf(result.html).filter(([key]) => key.toLowerCase() === 'rejectedhashes'))
      .to.deep.equal([['rejectedHashes', 'aaa,bbb']]);
  });

  it('keeps the spelling of an existing baseline row when it records a new baseline', async () => {
    const target = page('<div><p>A</p></div>', { RolloutBase: `${PATH}|abcdef012345` });
    const result = await copy({
      source, target, behavior: 'merge', recordBaseline: true,
    });
    expect(rowsOf(result.html).map(([key]) => key)).to.deep.equal(['RolloutBase']);
  });

  it('keeps the review rows\' spelling when it copies into an emptied page', async () => {
    const result = await copy({ source, target: page('<div></div>', { rejectedHashes: 'aaa' }), behavior: 'smart-overwrite' });
    expect(rowsOf(result.html).filter(([key]) => key.toLowerCase() === 'rejectedhashes'))
      .to.deep.equal([['rejectedHashes', 'aaa']]);
  });
});

describe('markInSync', () => {
  const sync = (options) => daMerge.markInSync({
    path: PATH, site, config, ...options,
  });

  it('reports pages it cannot mark', async () => {
    expect(await sync({ path: '/org/site/data.json' })).to.deep.equal({ sync: 'sheet' });
    expect(await sync({ path: '/org/site/.snapshots/s/page.html' })).to.deep.equal({ sync: 'snapshot' });
    expect(await sync({ source: page('<div><p>A</p></div>') })).to.deep.equal({ sync: 'missing' });
    expect(await sync({ source: page('<div><p>A</p></div>'), target: page('<div></div>') })).to.deep.equal({ sync: 'missing' });
    expect(await sync({ source: page('<div><p>A</p></div>'), target: page('<div><p da-diff-added="">A</p></div>') })).to.deep.equal({ sync: 'unresolved' });
    expect(await sync({ source: page('<div><p>A</p></div>'), target: page('<div><p>A</p></div>', { rolloutbase: `${PATH}|abcdef012345` }) })).to.deep.equal({ sync: 'in-sync' });
  });

  it('keeps the shape of a full document page', async () => {
    const source = page('<div><p>A</p></div>');
    const body = '<body><main><div><p>A local</p></div></main></body>';
    const full = await sync({ source, target: `<!DOCTYPE html>\n<html lang="fr"><head><title>T</title></head>${body}</html>` });
    expect(full.html.startsWith('<!DOCTYPE html>\n<html lang="fr"><head><title>T</title></head><body><main>')).to.equal(true);
    const noHtml = await sync({ source, target: `<!doctype html><head><title>T</title></head>${body}` });
    expect(noHtml.html.startsWith('<!DOCTYPE html>')).to.equal(true);
    expect(noHtml.html).to.include('<title>T</title>');
    const noHead = await sync({ source, target: `<title>T</title>${body}` });
    expect(noHead.html).to.include('<title>T</title>');
    const bodyOnly = await sync({ source, target: body });
    expect(bodyOnly.html.startsWith('<body>')).to.equal(true);
  });

  it('counts local differences in a dry run', async () => {
    const result = await sync({ source: page('<div><p>A</p><p>B</p></div>'), target: page('<div><p>A local</p><p>B</p></div>'), dryRun: true });
    expect(result).to.deep.equal({ sync: 'to-mark', differences: 1 });
  });

  it('treats links to an equivalent site as the same in a dry run', async () => {
    const linked = (host) => page(`<div><p><a href="https://main--${host}--org.aem.live/x">X</a></p></div>`);
    const result = await sync({
      source: linked('other'), target: linked(site), dryRun: true, equivalentSites: ['other'],
    });
    expect(result).to.deep.equal({ sync: 'to-mark', differences: 0 });
  });

  it('writes the baseline of the current source into the target', async () => {
    const source = page('<div><p>A</p></div>');
    const result = await sync({ source, target: page('<div><p>A local</p></div>') });
    expect(result.sync).to.equal('marked');
    expect(metadataOf(result.html).rolloutbase.content.textContent).to.equal(result.baseline);
    expect(mainOf(result.html)).to.equal('<div><p>A local</p></div>');
  });
});

describe('diffSummary', () => {
  it('summarizes groups, sides, reasons, and previews', () => {
    const html = page('<div><da-diff-base data-mdast="ignore" data-diff-group="g1"><p>Was</p></da-diff-base><da-diff-deleted data-mdast="ignore" data-diff-group="g1" data-diff-side="source" data-diff-kind="changed" data-diff-reason="both-changed"><p>Theirs</p></da-diff-deleted><p da-diff-added="" data-diff-group="g1" data-diff-side="local" data-diff-kind="changed">Mine</p></div><div><p da-diff-added="" data-diff-group="g2" data-diff-side="local" data-diff-kind="added" data-diff-reason="differs">New</p></div>');
    const summary = daMerge.diffSummary(html);
    expect(summary.legacy).to.equal(false);
    expect(summary.groups).to.deep.equal([
      {
        id: 'g1',
        reason: 'both-changed',
        sides: ['source', 'local'],
        kinds: ['changed'],
        section: 0,
        preview: { source: 'Theirs', local: 'Mine', base: 'Was' },
      },
      {
        id: 'g2', reason: 'differs', sides: ['local'], kinds: ['added'], section: 1, preview: { source: '', local: 'New' },
      },
    ]);
    expect(summary.counts).to.deep.equal({
      groups: 2, bySide: { source: 1, local: 2 }, byReason: { 'both-changed': 1, differs: 1 },
    });
  });

  it('flags markup without groups as legacy', () => {
    const summary = daMerge.diffSummary(page('<div><da-diff-deleted data-mdast="ignore"><p>Up</p></da-diff-deleted><p da-diff-added="">Mine</p></div>'));
    expect(summary.legacy).to.equal(true);
    expect(summary.groups).to.deep.equal([]);
  });
});
