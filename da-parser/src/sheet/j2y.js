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

import * as YDefault from 'yjs';
import { MIN_DIMENSIONS } from './aem2j.js';

function rowToY(row, Y = YDefault) {
  const yrow = new Y.XmlElement('row');
  const cellCount = Math.max(row.length, MIN_DIMENSIONS);
  const cells = new Array(cellCount);

  for (let i = 0; i < cellCount; i += 1) {
    const ycell = new Y.XmlElement('cell');
    ycell.setAttribute('value', String(row[i] ?? ''));
    cells[i] = ycell;
  }

  yrow.insert(0, cells); // Single batch insert
  return yrow;
}

export function dataArrayToY(data, ydata, Y = YDefault) {
  // Clear existing data
  if (ydata.length > 0) {
    ydata.delete(0, ydata.length);
  }

  const rowCount = Math.max(data?.length ?? 0, MIN_DIMENSIONS);
  const rows = new Array(rowCount);

  for (let i = 0; i < rowCount; i += 1) {
    rows[i] = rowToY(data?.[i] ?? [], Y);
  }

  ydata.insert(0, rows);
}

export function jSheetToY(sheets, ydoc, deleteExisting = false, Y = YDefault) {
  const ysheets = ydoc.getArray('sheets');

  if (deleteExisting && ysheets.length > 0) {
    ysheets.delete(0, ysheets.length);
  }

  const sheetMaps = new Array(sheets.length);

  for (let s = 0; s < sheets.length; s += 1) {
    const sheet = sheets[s];
    const ysheet = new Y.Map();
    // Set basic properties
    ysheet.set('sheetName', sheet.sheetName);
    const yMinDimensions = new Y.Array();
    if (sheet.minDimensions) {
      yMinDimensions.push([sheet.minDimensions]);
    }
    ysheet.set('minDimensions', yMinDimensions);
    // Convert data array using helper function
    // Data should already be padded by getSheet
    const ydata = new Y.XmlFragment();
    dataArrayToY(sheet.data, ydata, Y);
    ysheet.set('data', ydata);
    const ycolumns = new Y.Array();
    if (sheet.columns) {
      const colMaps = new Array(sheet.columns.length);
      for (let i = 0; i < sheet.columns.length; i += 1) {
        const ycol = new Y.Map();
        const keys = Object.keys(sheet.columns[i]);
        for (let k = 0; k < keys.length; k += 1) {
          ycol.set(keys[k], sheet.columns[i][keys[k]]);
        }
        colMaps[i] = ycol;
      }
      ycolumns.push(colMaps);
    }
    ysheet.set('columns', ycolumns);
    sheetMaps[s] = ysheet;
  }
  ysheets.push(sheetMaps);

  return ysheets;
}
