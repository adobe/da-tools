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
import { Transform } from 'prosemirror-transform';
import { expect, readTestFile, dom } from './test-utils.js';
import {
  Y, adapter, v2Merge, mainOf, stateOf, htmlOf, texts,
} from './resolve-utils.js';
import DaMerge, {
  CHOICE, HASHES_META, findGroup, groups, recordHashes, getDiffHash,
} from '../src/index.js';
import * as resolveEntry from '../src/resolve-entry.js';

const GROUPED = await readTestFile('./mocks/resolve/grouped.html');
const BASES = await readTestFile('./mocks/resolve/bases.html');

const page = (main) => `<body><header></header><main><div>${main}</div></main><footer></footer></body>`;
const ANY_MARKUP = 'da-diff-deleted, da-diff-added, [da-diff-added], da-diff-base, [data-diff-group]';

const engine = resolveEntry.createResolve({ DOMParser: dom.DOMParser, ...adapter });

function run(html, call, { metadata: entries = [], ...options } = {}) {
  const state = stateOf(html);
  const metadata = new Map(entries);
  const tr = call({ state, metadata, ...options });
  return {
    tr, metadata, main: tr && mainOf(htmlOf(tr.doc)), html: tr && htmlOf(tr.doc),
  };
}

const resolveGroup = (html, groupId, choice, options) => run(
  html,
  (args) => engine.resolve({ ...args, groupId, choice }),
  options,
);
const resolveAll = (html, choice, options) => run(
  html,
  (args) => engine.resolveAll({ ...args, choice }),
  options,
);

const stored = (metadata, key) => (metadata.get(key) || '').split(',').filter(Boolean);
const hash = (normalized) => getDiffHash(normalized);

describe('resolve', () => {
  describe('groups', () => {
    it('lists grouped markers and bases in document order', () => {
      const found = groups(stateOf(GROUPED).doc);
      expect(found.map(({ id }) => id)).to.deep.equal(['g1', 'g2', 'g3']);
      expect(found[0].markers.map(({ side }) => side)).to.deep.equal(['source', 'local']);
      expect(found[0].bases).to.have.length(1);
      expect(found[1].markers.map(({ node }) => node.type.name)).to.deep.equal(['diff_deleted', 'diff_added']);
    });

    it('finds one group, or nothing for an unknown id', () => {
      const { doc } = stateOf(GROUPED);
      expect(findGroup(doc, 'g3').markers).to.have.length(1);
      expect(findGroup(doc, 'g9')).to.deep.equal({ id: 'g9', markers: [], bases: [] });
    });
  });

  describe('a group', () => {
    it('keep mine drops the source side, unwraps the local side, and removes the base', () => {
      const { main } = resolveGroup(GROUPED, 'g1', CHOICE.mine);
      expect(main.querySelector('[data-diff-group="g1"]')).to.equal(null);
      expect(main.querySelector('da-diff-base')).to.equal(null);
      expect(main.textContent).to.not.include('Alpha source');
      const alpha = [...main.querySelectorAll('p')].find((p) => p.textContent === 'Alpha local');
      expect(alpha.hasAttribute('da-diff-added')).to.equal(false);
      expect(main.querySelectorAll('[data-diff-group="g2"]').length).to.equal(2);
    });

    it('records one hash per unit: rejected source units and the accepted local unit', () => {
      const { metadata, tr } = resolveGroup(GROUPED, 'g1', CHOICE.mine);
      expect(stored(metadata, 'rejectedHashes')).to.deep.equal([
        hash('<p>Alpha source</p>'), hash('<p>Yankee source</p>'),
      ]);
      expect(stored(metadata, 'acceptedHashes')).to.deep.equal([hash('<p>Alpha local</p>')]);
      expect(tr.getMeta(HASHES_META)).to.deep.equal({
        accepted: stored(metadata, 'acceptedHashes'), rejected: stored(metadata, 'rejectedHashes'),
      });
    });

    it('take source keeps the source side and drops the local side', () => {
      const { main } = resolveGroup(GROUPED, 'g1', CHOICE.source);
      expect(texts(main, ':scope > div > p').slice(0, 2)).to.deep.equal(['Alpha source', 'Yankee source']);
      expect(main.textContent).to.not.include('Alpha local');
      expect(main.querySelector('da-diff-base')).to.equal(null);
    });

    it('keep both keeps both sides in place', () => {
      const { main, metadata } = resolveGroup(GROUPED, 'g1', CHOICE.both);
      expect(texts(main, ':scope > div > p').slice(0, 3)).to.deep.equal(['Alpha source', 'Yankee source', 'Alpha local']);
      expect(main.querySelector('[data-diff-group="g1"]')).to.equal(null);
      expect(stored(metadata, 'acceptedHashes')).to.have.length(3);
      expect(metadata.has('rejectedHashes')).to.equal(false);
    });

    it('keep neither drops both sides', () => {
      const { main, metadata } = resolveGroup(GROUPED, 'g1', CHOICE.neither);
      expect(texts(main, ':scope > div > p')).to.not.include.members(['Alpha source', 'Alpha local']);
      expect(stored(metadata, 'rejectedHashes')).to.have.length(3);
    });

    it('resolves a list group item by item and hashes each item', () => {
      const { main, metadata } = resolveGroup(GROUPED, 'g2', CHOICE.mine);
      expect(texts(main, 'li')).to.deep.equal(['One', 'Two local', 'Three']);
      expect(main.querySelector('li[da-diff-added]')).to.equal(null);
      expect(stored(metadata, 'rejectedHashes')).to.deep.equal([hash('<li>Two source</li>')]);
      expect(stored(metadata, 'acceptedHashes')).to.deep.equal([hash('<li>Two local</li>')]);
    });

    it('take source on a one-sided group keeps the source unit', () => {
      const { main, tr } = resolveGroup(GROUPED, 'g3', CHOICE.source);
      expect(texts(main, ':scope > div > p')).to.include('Charlie source');
      expect(findGroup(tr.doc, 'g3').markers).to.have.length(0);
    });

    it('leaves ungrouped markup alone', () => {
      const { main } = resolveGroup(GROUPED, 'g1', CHOICE.mine);
      expect(main.querySelector('da-diff-deleted:not([data-diff-group])').textContent).to.equal('Legacy source');
    });

    it('returns null for a group that is not there', () => {
      expect(engine.resolve({ state: stateOf(GROUPED), groupId: 'g9', choice: CHOICE.mine })).to.equal(null);
    });

    it('rejects an unknown choice', () => {
      expect(() => engine.resolve({ state: stateOf(GROUPED), groupId: 'g1', choice: 'keep' })).to.throw(TypeError);
    });
  });

  describe('every marker', () => {
    it('accept all mine resolves every group and ungrouped marker', () => {
      const { main } = resolveAll(GROUPED, CHOICE.mine);
      expect(main.querySelector(ANY_MARKUP)).to.equal(null);
      expect(texts(main, ':scope > div > p')).to.deep.equal(['Alpha local', 'Delta']);
      expect(texts(main, 'li')).to.deep.equal(['One', 'Two local', 'Three']);
    });

    it('accept all source resolves every group and ungrouped marker', () => {
      const { main } = resolveAll(GROUPED, CHOICE.source);
      expect(main.querySelector(ANY_MARKUP)).to.equal(null);
      expect(texts(main, ':scope > div > p')).to.deep.equal(['Alpha source', 'Yankee source', 'Charlie source', 'Legacy source', 'Delta']);
      expect(texts(main, 'li')).to.deep.equal(['One', 'Two source', 'Three']);
    });

    it('removes every base, also one left without markers', () => {
      const orphan = page('<da-diff-base data-mdast="ignore" data-diff-group="g7"><p>Old</p></da-diff-base><p>A</p>');
      const { main } = resolveAll(orphan, CHOICE.mine);
      expect(texts(main, 'p')).to.deep.equal(['A']);
    });

    it('returns null when there is no markup', () => {
      expect(engine.resolveAll({ state: stateOf(page('<p>A</p>')), choice: CHOICE.mine })).to.equal(null);
    });
  });

  describe('legacy markers', () => {
    const LEGACY = page('<da-diff-deleted data-mdast="ignore"><h2>Hello</h2></da-diff-deleted><h2 da-diff-added="">Welcome</h2><p>End</p>');
    const positions = (state) => findGroup(state.doc, null);

    it('resolves a pair at the given positions', () => {
      const state = stateOf(LEGACY);
      const { markers } = positions(state);
      const metadata = new Map();
      const tr = engine.resolveMarkers({
        state, positions: markers.map(({ pos }) => pos), choice: CHOICE.mine, metadata,
      });
      const main = mainOf(htmlOf(tr.doc));
      expect(texts(main, 'h2')).to.deep.equal(['Welcome']);
      expect(main.querySelector(ANY_MARKUP)).to.equal(null);
      expect(stored(metadata, 'acceptedHashes')).to.deep.equal([hash('<h2>Welcome</h2>')]);
      expect(stored(metadata, 'rejectedHashes')).to.deep.equal([hash('<h2>Hello</h2>')]);
    });

    it('keeps or deletes a single marker', () => {
      const state = stateOf(LEGACY);
      const [deleted] = positions(state).markers;
      const kept = engine.resolveMarkers({ state, positions: [deleted.pos], choice: CHOICE.both });
      const main = mainOf(htmlOf(kept.doc));
      expect(texts(main, 'h2')).to.deep.equal(['Hello', 'Welcome']);
      expect(main.querySelectorAll('[da-diff-added]')).to.have.length(1);
      const dropped = engine.resolveMarkers({
        state, positions: [deleted.pos], choice: CHOICE.neither,
      });
      expect(texts(mainOf(htmlOf(dropped.doc)), 'h2')).to.deep.equal(['Welcome']);
    });

    it('keeps a group base until the last marker of the group is resolved', () => {
      const state = stateOf(BASES);
      const [first, second] = findGroup(state.doc, 'g1').markers;
      const one = engine.resolveMarkers({ state, positions: [first.pos], choice: CHOICE.neither });
      expect(findGroup(one.doc, 'g1').bases).to.have.length(1);
      const both = engine.resolveMarkers({
        state, positions: [first.pos, second.pos], choice: CHOICE.mine,
      });
      expect(findGroup(both.doc, 'g1').bases).to.have.length(0);
      expect(findGroup(both.doc, 'g2').bases).to.have.length(1);
    });

    it('resolves grouped and legacy markers together', () => {
      const state = stateOf(GROUPED);
      const all = [...groups(state.doc).flatMap(({ markers }) => markers)];
      const legacy = [];
      state.doc.descendants((node, pos) => {
        if (node.type.name === 'diff_deleted' && !node.attrs.diffGroup) legacy.push(pos);
        return !['diff_deleted', 'diff_added'].includes(node.type.name);
      });
      const g3 = findGroup(state.doc, 'g3').markers[0].pos;
      const tr = engine.resolveMarkers({
        state, positions: [g3, ...legacy], choice: CHOICE.source,
      });
      const main = mainOf(htmlOf(tr.doc));
      expect(texts(main, ':scope > div > p')).to.include.members(['Charlie source', 'Legacy source']);
      expect(groups(tr.doc).map(({ id }) => id)).to.deep.equal(['g1', 'g2']);
      expect(all.length).to.equal(5);
    });
  });

  describe('lists', () => {
    it('deletes a list item whose only child is a dropped marker, and a list it empties', () => {
      const html = page('<ul><li><da-diff-deleted data-mdast="ignore" data-diff-group="g1" data-diff-side="source" data-diff-kind="added">Only</da-diff-deleted></li></ul><p>After</p>');
      const { main } = resolveGroup(html, 'g1', CHOICE.mine);
      expect(main.querySelector('ul')).to.equal(null);
      expect(texts(main, 'p')).to.deep.equal(['After']);
    });

    it('keeps a list item that has other content', () => {
      const state = stateOf(page('<ul><li><p>Keep</p><ul><li>Nested</li></ul></li></ul>'));
      const { schema } = state;
      let at;
      state.doc.descendants((node, pos) => {
        if (node.type.name === 'paragraph' && node.textContent === 'Keep') at = pos;
      });
      const marker = schema.nodes.diff_deleted.create({ diffGroup: 'g1', diffSide: 'source' }, [schema.nodes.paragraph.create(null, schema.text('Drop'))]);
      const withMarker = state.apply(state.tr.insert(at, marker));
      const tr = engine.resolve({ state: withMarker, groupId: 'g1', choice: CHOICE.mine });
      const main = mainOf(htmlOf(tr.doc));
      expect(main.textContent).to.not.include('Drop');
      expect(texts(main, 'li')[0]).to.include('Keep');
      expect(main.querySelectorAll('li')).to.have.length(2);
    });

    it('resolves markers that hold list items', () => {
      const state = stateOf(page('<ul><li>One</li></ul>'));
      const { schema } = state;
      const paragraph = (text) => schema.nodes.paragraph.create(null, schema.text(text));
      const item = (text) => schema.nodes.list_item.create(null, [paragraph(text)]);
      const marker = schema.nodes.diff_deleted.create({ diffGroup: 'g1', diffSide: 'source' }, [item('Two'), item('Three')]);
      const withMarker = state.apply(state.tr.insert(state.doc.child(0).nodeSize, marker));
      const metadata = new Map();
      const kept = engine.resolve({
        state: withMarker, groupId: 'g1', choice: CHOICE.source, metadata,
      });
      expect(texts(mainOf(htmlOf(kept.doc)), 'li')).to.deep.equal(['One', 'Two', 'Three']);
      expect(stored(metadata, 'acceptedHashes')).to.deep.equal([hash('<li>Two</li>'), hash('<li>Three</li>')]);
      const dropped = engine.resolve({ state: withMarker, groupId: 'g1', choice: CHOICE.mine });
      expect(texts(mainOf(htmlOf(dropped.doc)), 'li')).to.deep.equal(['One']);
    });
  });

  describe('content', () => {
    it('strips da-diff-added from every kept node, also a linked image', () => {
      const html = page('<p>Intro</p><a href="https://example.com/x" da-diff-added="" data-diff-group="g1" data-diff-side="local" data-diff-kind="added"><picture><img src="https://example.com/a.png" alt="A"></picture></a>');
      const { main } = resolveGroup(html, 'g1', CHOICE.mine);
      expect(main.querySelector('[da-diff-added], [data-diff-group]')).to.equal(null);
      expect(main.querySelector('a[href="https://example.com/x"] img')).to.not.equal(null);
    });

    it('hashes text, links and icons the way the merge normalizes them', () => {
      const html = page([
        '<da-diff-deleted data-mdast="ignore" data-diff-group="g1" data-diff-side="source"><p>Read <a href="https://example.com/a">more</a> here</p><p>See <a href="https://main--other--org.hlx.page/about">about</a></p><p>Call :phone:</p></da-diff-deleted>',
      ].join(''));
      const config = { config: { data: [{ key: 'source.fragment.hostnames', value: 'main--other--org.aem.live' }] } };
      const { metadata } = resolveGroup(html, 'g1', CHOICE.mine, { site: 'site', config });
      expect(stored(metadata, 'rejectedHashes')).to.deep.equal([
        hash('<p>Read<a href="https://example.com/a">more</a>here</p>'),
        hash('<p>See<a href="https://main--site--org.aem.live/about">about</a></p>'),
        hash('<p>Call :phone:</p>'),
      ]);
    });

    it('hashes images and block tables as they are saved', () => {
      const src = 'https://content.da.live/org/site/de/.page/a.png';
      const html = page(`<da-diff-deleted data-mdast="ignore" data-diff-group="g1" data-diff-side="source"><picture><source srcset="${src}"><img src="${src}" alt="A" loading="lazy"></picture><div class="cards"><div><div>Card</div></div></div></da-diff-deleted>`);
      const { metadata } = resolveGroup(html, 'g1', CHOICE.mine);
      expect(stored(metadata, 'rejectedHashes')).to.deep.equal([
        hash(`<picture><source srcset="${src}"><source media="(min-width: 600px)" srcset="${src}"><img alt="A" loading="lazy" src="${src}"></picture>`),
        hash('<div class="cards"><div><div><p>Card</p></div></div></div>'),
      ]);
    });

    it('hashes a block group as one unit', () => {
      const html = page('<da-diff-deleted data-mdast="ignore" data-diff-group="g1" data-diff-side="source"><div class="block-group-start"><div><div>start</div></div></div><p>Inside</p><div class="block-group-end"><div><div>end</div></div></div></da-diff-deleted><p>After</p>');
      const { metadata } = resolveGroup(html, 'g1', CHOICE.mine);
      expect(stored(metadata, 'rejectedHashes')).to.deep.equal([hash([
        '<div class="block-group-start"><div><div><p>start</p></div></div></div>',
        '<p>Inside</p>',
        '<div class="block-group-end"><div><div><p>end</p></div></div></div>',
      ].join(''))]);
    });

    it('stores no hash for a unit that is saved as nothing, and deletes an empty marker', () => {
      const html = page('<da-diff-deleted data-mdast="ignore" data-diff-group="g1" data-diff-side="source"><p> </p></da-diff-deleted><p da-diff-added="" data-diff-group="g1" data-diff-side="local">Welcome</p>');
      const { metadata } = resolveGroup(html, 'g1', CHOICE.both);
      expect(stored(metadata, 'acceptedHashes')).to.deep.equal([hash('<p>Welcome</p>')]);
    });
  });

  describe('state', () => {
    it('works on a state that only has a Transform', () => {
      const { doc, schema } = stateOf(GROUPED);
      const tr = engine.resolve({
        state: { doc, schema, tr: new Transform(doc) }, groupId: 'g1', choice: CHOICE.source,
      });
      expect(tr.setMeta).to.equal(undefined);
      expect(texts(mainOf(htmlOf(tr.doc)), ':scope > div > p').slice(0, 2)).to.deep.equal(['Alpha source', 'Yankee source']);
    });

    it('throws on a schema without diff markup nodes', () => {
      const Schema = stateOf(GROUPED).schema.constructor;
      const schema = new Schema({ nodes: { doc: { content: 'text*' }, text: {} } });
      const doc = schema.node('doc');
      const state = { doc, schema, tr: new Transform(doc) };
      expect(() => engine.resolveAll({ state, choice: CHOICE.mine })).to.throw(TypeError);
    });
  });

  describe('metadata', () => {
    it('adds to an existing key whatever its case, without duplicates', () => {
      const existing = hash('<p>Alpha source</p>');
      const { metadata } = resolveGroup(GROUPED, 'g1', CHOICE.mine, {
        metadata: [['RejectedHashes', `aaaaaaaaaaaa,${existing}`]],
      });
      expect(metadata.has('rejectedHashes')).to.equal(false);
      expect(stored(metadata, 'RejectedHashes')).to.deep.equal(['aaaaaaaaaaaa', existing, hash('<p>Yankee source</p>')]);
    });

    it('writes a Y.Map through the transact wrapper, and undo removes the hashes', () => {
      const ydoc = new Y.Doc();
      const map = ydoc.getMap('daMetadata');
      const origin = {};
      const undo = new Y.UndoManager(map, { trackedOrigins: new Set([origin]) });
      let calls = 0;
      const transact = (fn) => {
        calls += 1;
        ydoc.transact(fn, origin);
      };
      engine.resolve({
        state: stateOf(GROUPED), groupId: 'g1', choice: CHOICE.mine, metadata: map, transact,
      });
      expect(calls).to.equal(1);
      expect(map.get('rejectedHashes').split(',')).to.have.length(2);
      undo.undo();
      expect(map.has('rejectedHashes')).to.equal(false);
      expect(map.has('acceptedHashes')).to.equal(false);
    });

    it('records hashes on a map that only has forEach, and skips a write with nothing new', () => {
      const values = new Map([['acceptedhashes', 'aaaaaaaaaaaa']]);
      let writes = 0;
      const metadata = {
        get: (key) => values.get(key),
        set: (key, value) => { writes += 1; values.set(key, value); },
        forEach: (fn) => values.forEach(fn),
      };
      recordHashes(metadata, { accepted: ['aaaaaaaaaaaa'] });
      expect(writes).to.equal(0);
      recordHashes(metadata, { accepted: ['bbbbbbbbbbbb'], rejected: [] });
      expect(values.get('acceptedhashes')).to.equal('aaaaaaaaaaaa,bbbbbbbbbbbb');
      expect(writes).to.equal(1);
    });
  });

  describe('pages', () => {
    it('resolves a group of a page and records its hashes in the page metadata', () => {
      const html = v2Merge.resolveHtml(GROUPED, 'g1', CHOICE.mine);
      const doc = v2Merge.parse(html);
      expect(doc.querySelector('[data-diff-group="g1"], da-diff-base')).to.equal(null);
      expect(doc.querySelector('[data-diff-group="g2"]')).to.not.equal(null);
      expect(doc.querySelector('.da-metadata').textContent).to.include(hash('<p>Yankee source</p>'));
    });

    it('resolves every marker of a page', () => {
      const html = v2Merge.resolveAllHtml(GROUPED, CHOICE.source);
      expect(v2Merge.parse(html).querySelector(ANY_MARKUP)).to.equal(null);
      expect(v2Merge.resolveHtml(GROUPED, 'g9', CHOICE.source)).to.equal(null);
    });

    it('summarizes the review of a document', () => {
      const summary = v2Merge.reviewSummary(stateOf(GROUPED).doc);
      expect(summary.groups.map((g) => g.id)).to.deep.equal(['g1', 'g2', 'g3']);
      expect(summary.groups[0].preview.base).to.equal('Alpha base');
      expect(summary.groups[1].preview).to.deep.equal({ source: 'Two source', local: 'Two local' });
    });
  });

  describe('DaMerge with a parser adapter', () => {
    it('canonicalizes with the adapter and keeps an explicit canonicalize', () => {
      const viaParts = new DaMerge({ ...dom, aem2doc: adapter.aem2doc, doc2aem: adapter.doc2aem });
      expect(viaParts.resolve).to.be.a('function');
      const explicit = new DaMerge({ ...dom, canonicalize: (html) => html });
      expect(explicit.resolve).to.equal(undefined);
      expect(() => new DaMerge({ ...dom, aem2doc: adapter.aem2doc })).to.throw(TypeError);
    });
  });
});
