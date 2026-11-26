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
import { expect, daMerge, createDoc } from './test-utils.js';

const { getBlockHashes } = daMerge;

const CONFIG = { config: { data: [{ key: 'source.fragment.hostnames', value: 'main--other--org.aem.live' }] } };

const toDoc = (href) => {
  const doc = createDoc();
  doc.body.innerHTML = `<main><div><p><a href="${href}">Link</a></p></div></main>`;
  return doc;
};

describe('getBlockHashes', () => {
  it('normalizes equivalent site links from the given config', async () => {
    const equivalent = await getBlockHashes({ doc: toDoc('https://main--other--org.aem.page/a'), site: 'site', config: CONFIG });
    const same = await getBlockHashes({ doc: toDoc('https://main--site--org.aem.live/a'), site: 'site', config: CONFIG });
    expect(equivalent).to.deep.equal(same);
  });

  it('does not change the document it hashes', async () => {
    const doc = toDoc('https://main--other--org.aem.page/a');
    await getBlockHashes({ doc, site: 'site', config: CONFIG });
    expect(doc.querySelector('a').href).to.equal('https://main--other--org.aem.page/a');
  });
});
