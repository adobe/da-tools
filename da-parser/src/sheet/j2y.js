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

/**
 * Get the Y namespace from a ydoc.
 * Since Yjs doesn't expose the Y namespace directly from the document,
 * this function falls back to the default import. For reliable Y instance
 * matching, pass the YNamespace parameter explicitly.
 * @param {Y.Doc} _ - The Yjs document (currently unused, kept for API consistency)
 * @returns {*} The Y namespace (defaults to imported Y)
 */
function getYFromDoc(_) {
  // Note: In Yjs, ydoc.constructor is Y.Doc, not the Y namespace itself.
  // We can't reliably extract the Y namespace from the document,
  // so we fall back to the default import. Callers should pass YNamespace
  // parameter if they need to use a specific Y instance (e.g., from da-y-wrapper).
  return YDefault;
}

function rowToY(row, ydoc, YNamespace = null) {
  const Y = YNamespace || getYFromDoc(ydoc);
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

export function dataArrayToY(data, ydata, ydoc, YNamespace = null) {
  // Clear existing data
  if (ydata.length > 0) {
    ydata.delete(0, ydata.length);
  }

  const rowCount = Math.max(data?.length ?? 0, MIN_DIMENSIONS);
  const rows = new Array(rowCount);
  const Y = YNamespace || getYFromDoc(ydoc);

  for (let i = 0; i < rowCount; i += 1) {
    rows[i] = rowToY(data?.[i] ?? [], ydoc, Y);
  }

  ydata.insert(0, rows);
}

export function jSheetToY(sheets, ydoc, deleteExisting = false, YNamespace = null) {
  const ysheets = ydoc.getArray('sheets');

  if (deleteExisting && ysheets.length > 0) {
    ysheets.delete(0, ysheets.length);
  }

  const Y = YNamespace || getYFromDoc(ydoc);
  sheets.forEach((sheet) => {
    const ysheet = new Y.Map();

    // Set basic properties
    ysheet.set('sheetName', sheet.sheetName);

    // Set minDimensions - wrap in array to push as single element
    const yMinDimensions = new Y.Array();
    if (sheet.minDimensions) {
      yMinDimensions.push([sheet.minDimensions]);
    }
    ysheet.set('minDimensions', yMinDimensions);

    // Convert data array using helper function
    // Data should already be padded by getSheet
    const ydata = new Y.XmlFragment();
    dataArrayToY(sheet.data, ydata, ydoc, Y);
    ysheet.set('data', ydata);

    // Convert columns array to Y.Array of Y.Maps
    const ycolumns = new Y.Array();
    if (sheet.columns) {
      sheet.columns.forEach((col) => {
        const ycol = new Y.Map();
        Object.entries(col).forEach(([key, value]) => {
          ycol.set(key, value);
        });
        ycolumns.push([ycol]);
      });
    }
    ysheet.set('columns', ycolumns);

    ysheets.push([ysheet]);
  });

  return ysheets;
}
