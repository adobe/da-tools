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

export const MIN_DIMENSIONS = 20;

/**
 * ================== YJS TO JSHEET ==================
 */

/**
 * Convert Y.XmlFragment structure back to 2D data array
 * Internal helper function - only used in yToJSheet
 * @param {Y.XmlFragment} ydata - Y.XmlFragment containing row elements
 * @returns {Array} - 2D array of cell values
 */
function yToDataArray(ydata) {
  const data = [];
  if (ydata) {
    ydata.forEach((yrow) => {
      // Each yrow is a Y.XmlElement 'row' containing Y.XmlElement 'cell' children
      const row = [];
      yrow.forEach((ycell) => {
        // Get cell value from attribute
        const cellValue = ycell.getAttribute('value') || '';
        row.push(cellValue);
      });
      data.push(row);
    });
  }
  return data;
}

/**
 * Convert Yjs structure back to jSpreadsheet format
 * @param {Y.Array} ysheets - Yjs Array containing sheet data
 * @returns {Array} - Array of sheet objects compatible with jSpreadsheet
 */
export function yToJSheet(ysheets, canWrite = true) {
  const sheets = [];

  ysheets.forEach((ysheet) => {
    const sheet = {};

    // Get basic properties
    sheet.sheetName = ysheet.get('sheetName');

    // Get minDimensions - it was wrapped in array, so unwrap it
    const yMinDimensions = ysheet.get('minDimensions');
    if (yMinDimensions?.length > 0) {
      [sheet.minDimensions] = yMinDimensions.toArray();
    }

    // Convert Y.XmlFragment data back to regular arrays using helper function
    const ydata = ysheet.get('data');
    sheet.data = yToDataArray(ydata);

    // Convert Y.Array columns back to regular array of objects
    const ycolumns = ysheet.get('columns');
    sheet.columns = [];
    if (ycolumns) {
      ycolumns.forEach((ycol) => {
        const col = {};
        ycol.forEach((value, key) => {
          col[key] = value;
        });
        if (!canWrite) {
          col.readOnly = true;
        }
        sheet.columns.push(col);
      });
    }

    if (!canWrite) {
      delete sheet.minDimensions;
    }

    sheets.push(sheet);
  });

  return sheets;
}

/**
 * ================== JSHEET TO YJS ==================
 */

/**
 * Helper: Convert a row array to Y.XmlElement with cell children
 * @param {Array} row - Row array
 * @returns {Y.XmlElement} - Y.XmlElement 'row' with 'cell' children (value stored as attribute)
 */
function rowToY(row) {
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

/**
 * Convert a 2D data array to Y.XmlFragment structure (initial population only)
 * Internal helper function - only used for initial conversion in jSheetToY
 * @param {Array} data - 2D array of cell values
 * @param {Y.XmlFragment} ydata - Y.XmlFragment to populate
 */
export function dataArrayToY(data, ydata) {
  // Clear existing data
  if (ydata.length > 0) {
    ydata.delete(0, ydata.length);
  }

  // Populate with new data
  if (data) {
    data.forEach((row, idx) => {
      const yrow = rowToY(row);
      ydata.insert(idx, [yrow]);
    });
  }

  if (data?.length < MIN_DIMENSIONS) {
    for (let i = data.length; i < MIN_DIMENSIONS; i += 1) {
      const yrow = rowToY([]);
      ydata.insert(i, [yrow]);
    }
  }
}

/**
 * Convert jSpreadsheet sheet data to Yjs structure
 * @param {Array} sheets - Array of sheet objects from getSheets()
 * @returns {Object} - Object containing ydoc and ysheets array
 */
export function jSheetToY(sheets, ydoc, deleteExisting = false) {
  const ysheets = ydoc.getArray('sheets');
  
  ydoc.transact(() => {
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
      dataArrayToY(sheet.data, ydata);
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
  });

  return ysheets;
}
