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
import DaMerge from '../src/index.js';

const isNode = typeof window === 'undefined';

const { expect } = isNode ? await import('chai') : await import('@esm-bundle/chai');

const getDom = async () => {
  if (!isNode) return { DOMParser: window.DOMParser, Node: window.Node, document: window.document };
  const { parseHTML } = await import('linkedom');
  const { DOMParser, Node, document } = parseHTML('<!DOCTYPE html><html><head></head><body></body></html>');
  return { DOMParser, Node, document };
};

const dom = await getDom();
const daMerge = new DaMerge(dom);

const createDoc = () => daMerge.parse('<!DOCTYPE html><html><head></head><body></body></html>');

async function readTestFile(path) {
  if (isNode) {
    const fs = await import('node:fs/promises');
    return fs.readFile(new URL(path, import.meta.url), 'utf-8');
  }
  const { readFile } = await import('@web/test-runner-commands');
  return readFile({ path });
}

const sortAttributes = (html) => html.replace(/<([a-z][a-z0-9-]*)((?:\s+[^\s=>]+(?:="[^"]*")?)+)\s*>/g, (_, tag, attrs) => `<${tag} ${attrs.trim().match(/[^\s=]+(?:="[^"]*")?/g).sort().join(' ')}>`);

const spy = (fn) => {
  const wrapped = (...args) => {
    wrapped.calls += 1;
    return fn(...args);
  };
  wrapped.calls = 0;
  return wrapped;
};

export {
  expect, readTestFile, isNode, dom, daMerge, createDoc, spy, sortAttributes,
};
