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
import { prosemirrorToYXmlFragment } from 'y-prosemirror';
import { expect } from './test-utils.js';
import { doc2aem } from '../src/parser.js';
import { getSchema } from '../src/schema.js';

const collapseTagWhitespace = (str) => str.replace(/>\s+</g, '><');
const collapseWhitespace = (str) => collapseTagWhitespace(str.replace(/\s+/g, ' ')).trim();

describe('YDoc to HTML conversion', () => {
  it('block table with bolded and italic class name text produces correct class in doc2aem', async () => {
    const schema = getSchema();

    // Build the ProseMirror doc entirely from scratch — no aem2doc involved.
    // This mirrors a ydoc that arrives from a collaborative editing session where
    // the block name cell already has a bold mark applied.
    const nameCell = schema.nodes.table_cell.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text('hello', [schema.marks.strong.create(), schema.marks.em.create()]),
      ]),
    ]);
    const dataCell = schema.nodes.table_cell.create(null, [
      schema.nodes.paragraph.create(null, [schema.text('Row 1 - Column 1')]),
    ]);
    const pmDoc = schema.nodes.doc.create(null, [
      schema.nodes.table.create(null, [
        schema.nodes.table_row.create(null, [nameCell]),
        schema.nodes.table_row.create(null, [dataCell]),
      ]),
    ]);

    const yDoc = new Y.Doc();
    prosemirrorToYXmlFragment(pmDoc, yDoc.getXmlFragment('prosemirror'));

    // doc2aem calls tableToBlock -> getText, which must traverse through the strong
    // wrapper to reach the text node and return "hello".
    const result = doc2aem(yDoc);
    const collapsed = collapseWhitespace(result);

    expect(collapsed, 'block class name should be "hello" even when text is bolded and italic').to.include('class="hello"');
  });
});
