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

import { expect } from '@esm-bundle/chai';
import * as Y from 'yjs';
import { jSheetToY } from '../src/sheet/j2y.js';
import { yToJSheet } from '../src/sheet/y2j.js';

describe('Sheet Parser - jSheetToY', () => {
  it('converts simple jSheet to Y', () => {
    const ydoc = new Y.Doc();

    const sheets = [
      {
        sheetName: 'sheet1',
        data: [
          ['A', 'B', 'C'],
          ['D', 'E', 'F'],
          ['G', 'H', 'I'],
        ],
        columns: [
          { width: 100 },
        ],
      },
    ];

    jSheetToY(sheets, ydoc);

    const ysheets = ydoc.getArray('sheets');
    expect(ysheets.length).to.equal(1);
    expect(ysheets.get(0).get('sheetName')).to.equal('sheet1');
    for (let i = 0; i < sheets[0].data.length; i += 1) {
      for (let j = 0; j < sheets[0].data[i].length; j += 1) {
        expect(ysheets.get(0).get('data').get(i).get(j)
          .getAttribute('value')).to.equal(sheets[0].data[i][j]);
      }
    }
  });

  it('converts multi-sheet jSheet to Y', () => {
    const ydoc = new Y.Doc();

    const sheets = [
      {
        sheetName: 'sheet1',
        data: [
          ['A', 'B', 'C'],
          ['D', 'E', 'F'],
          ['G', 'H', 'I'],
        ],
        columns: [
          { width: 100 },
        ],
      },
      {
        sheetName: 'sheet2',
        data: [
          ['A', 'B', 'C'],
          ['D', 'E', 'F'],
          ['G', 'H', 'I'],
        ],
      },
    ];

    jSheetToY(sheets, ydoc);

    const ysheets = ydoc.getArray('sheets');
    expect(ysheets.length).to.equal(2);
    expect(ysheets.get(0).get('sheetName')).to.equal('sheet1');
    for (let i = 0; i < sheets[0].data.length; i += 1) {
      for (let j = 0; j < sheets[0].data[i].length; j += 1) {
        expect(ysheets.get(0).get('data').get(i).get(j)
          .getAttribute('value')).to.equal(sheets[0].data[i][j]);
      }
    }
    expect(ysheets.get(1).get('sheetName')).to.equal('sheet2');
    for (let i = 0; i < sheets[1].data.length; i += 1) {
      for (let j = 0; j < sheets[1].data[i].length; j += 1) {
        expect(ysheets.get(1).get('data').get(i).get(j)
          .getAttribute('value')).to.equal(sheets[1].data[i][j]);
      }
    }
  });

  it('inserts 20 rows and 20 columns on empty sheet', () => {
    const ydoc = new Y.Doc();

    const sheets = [
      {
        sheetName: 'sheet1',
        data: [],
        columns: [],
      },
    ];

    jSheetToY(sheets, ydoc);

    const ysheets = ydoc.getArray('sheets');
    expect(ysheets.length).to.equal(1);
    expect(ysheets.get(0).get('sheetName')).to.equal('sheet1');
    expect(ysheets.get(0).get('data').length).to.equal(20);
    expect(ysheets.get(0).get('data').get(0).length).to.equal(20);
    expect(ysheets.get(0).get('columns').length).to.equal(0);
  });

  it('removes existing data if passed as option', () => {
    const ydoc = new Y.Doc();

    const sheets1 = [
      {
        sheetName: 'sheet1',
        data: [['A', 'B', 'C'], ['D', 'E', 'F'], ['G', 'H', 'I']],
      },
    ];

    jSheetToY(sheets1, ydoc);

    const sheets2 = [
      {
        sheetName: 'sheet2',
        data: [['A', 'B', 'C'], ['D', 'E', 'F'], ['G', 'H', 'I']],
      },
    ];

    jSheetToY(sheets2, ydoc);

    expect(ydoc.getArray('sheets').length).to.equal(2);

    const sheets3 = [
      {
        sheetName: 'sheet3',
        data: [['A', 'B', 'C'], ['D', 'E', 'F'], ['G', 'H', 'I']],
      },
    ];

    jSheetToY(sheets3, ydoc, true);
    expect(ydoc.getArray('sheets').length).to.equal(1);
    expect(ydoc.getArray('sheets').get(0).get('sheetName')).to.equal('sheet3');
  });
});

describe('Sheet Parser - yToJSheet', () => {
  it('converts Yjs structure back to jSheet', () => {
    const ydoc = new Y.Doc();

    const sheets = [
      {
        sheetName: 'sheet1',
        data: [['A', 'B', 'C'], ['D', 'E', 'F'], ['G', 'H', 'I']],
        columns: [{ width: 100 }, { width: 50 }, { width: 200 }],
      },
    ];

    jSheetToY(sheets, ydoc);

    const jsheets = yToJSheet(ydoc.getArray('sheets'));
    expect(jsheets.length).to.equal(1);
    expect(jsheets[0].sheetName).to.equal('sheet1');
    expect(jsheets[0].columns).to.deep.equal([{ width: 100 }, { width: 50 }, { width: 200 }]);
    expect(jsheets[0].data).to.deep.equal([
      ['A', 'B', 'C', ...Array(17).fill('')],
      ['D', 'E', 'F', ...Array(17).fill('')],
      ['G', 'H', 'I', ...Array(17).fill('')],
      ...Array(17).fill([...Array(20).fill('')]),
    ]);
  });

  it('removes handles read-only', () => {
    const ydoc = new Y.Doc();

    const sheets = [
      {
        sheetName: 'sheet1',
        data: [['A', 'B', 'C'], ['D', 'E', 'F'], ['G', 'H', 'I']],
        columns: [{ width: 100 }, { width: 50 }, { width: 200 }],
      },
    ];

    jSheetToY(sheets, ydoc);

    const jsheets = yToJSheet(ydoc.getArray('sheets'), false);
    expect(jsheets[0].columns).to.deep.equal([
      { width: 100, readOnly: true },
      { width: 50, readOnly: true },
      { width: 200, readOnly: true },
    ]);
  });
});
