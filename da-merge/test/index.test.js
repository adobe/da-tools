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
import { expect, dom, daMerge } from './test-utils.js';
import DaMerge from '../src/index.js';

describe('DaMerge', () => {
  it('requires DOMParser, Node, document, and canonicalize', () => {
    const canonicalize = (html) => html;
    expect(() => new DaMerge()).to.throw(TypeError);
    expect(() => new DaMerge({ ...dom, Node: undefined, canonicalize })).to.throw(TypeError);
    expect(() => new DaMerge(dom)).to.throw(TypeError);
    expect(() => new DaMerge({ ...dom, canonicalize })).to.not.throw();
  });

  it('parses a body-only DA page into body and main', () => {
    const doc = daMerge.parse('<body><header></header><main><div><p>Hi</p></div></main><footer></footer></body>');
    expect(doc.body.querySelector(':scope > main > div > p')?.textContent).to.equal('Hi');
    expect(doc.documentElement.nodeName).to.equal('HTML');
  });

  it('parses a full HTML document unchanged', () => {
    const doc = daMerge.parse('<!DOCTYPE html><html><head><title>T</title></head><body><main><div><p>Hi</p></div></main></body></html>');
    expect(doc.querySelector('head > title').textContent).to.equal('T');
    expect(doc.querySelector('body > main p').textContent).to.equal('Hi');
  });
});
