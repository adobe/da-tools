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

    // Get minDimensions array
    const yMinDimensions = ysheet.get('minDimensions');
    if (yMinDimensions?.length > 0) {
      sheet.minDimensions = yMinDimensions.toArray();
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
