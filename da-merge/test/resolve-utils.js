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
import { EditorState } from 'prosemirror-state';
import * as parser from './mocks/da-parser-v2/index.js';
import { dom } from './test-utils.js';
import DaMerge, { daParserAdapter } from '../src/index.js';

// Diff markup v2 needs the da-parser from adobe/da-tools#48 (test/mocks/da-parser-v2).
const adapter = daParserAdapter({ Y, EditorState, ...parser });
const v2Merge = new DaMerge({ ...dom, ...adapter });

const pageOf = (html) => v2Merge.parse(html);
const mainOf = (html) => pageOf(html).querySelector('main');
const stateOf = (html) => adapter.aem2doc(html).state;
const htmlOf = (doc, metadata) => adapter.doc2aem(doc, metadata);

const texts = (main, selector) => [...main.querySelectorAll(selector)]
  .map((el) => el.textContent.trim());

export {
  Y, parser, adapter, v2Merge, pageOf, mainOf, stateOf, htmlOf, texts,
};
