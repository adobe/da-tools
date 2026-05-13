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
import { expect } from './test-utils.js';
import { aem2doc } from '../src/doc/parser.js';

// COR-37: da-admin restore failure -- TypeError: Cannot read properties of
// undefined (reading 'toLowerCase'). Captured Coralogix payloads showed raw
// body content with no <main> wrapper but containing HTML comments at the
// top level. The proxy in aem2doc treats every non-text node as nodeType 1
// (element) and exposes nodeName via tagName?.toUpperCase(), so comment
// nodes hand ProseMirror's DOMParser a tagName-less "element" and it calls
// undefined.toLowerCase().
describe('aem2doc handles non-main HTML with top-level comments (COR-37)', () => {
  it('does not throw on raw body with a leading HTML comment', () => {
    const html = '<body>\n  <!-- DA Structured Content document -->\n  <table>\n    <tr><th colspan="2">Metadata</th></tr>\n    <tr><td>Title</td><td>example</td></tr>\n  </table>\n</body>\n';
    const yDoc = new Y.Doc();
    expect(() => aem2doc(html, yDoc)).to.not.throw();
  });

  it('does not throw on full HTML document (doctype + head) with body comments', () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Almac</title>
  <meta name="description" content="...">
</head>
<body>
<!-- Section 1: Hero -->
<table>
  <tr><th colspan="2">Hero (carousel)</th></tr>
  <tr><td>cell</td><td>value</td></tr>
</table>
</body>
</html>
`;
    const yDoc = new Y.Doc();
    expect(() => aem2doc(html, yDoc)).to.not.throw();
  });

  it('does not throw on a captured Coralogix payload (mascocg/behr/drafts/eric/deckover.html)', () => {
    // Verbatim body recovered from the Coralogix log entry for
    // https://admin.da.live/source/mascocg/behr/drafts/eric/deckover.html
    const html = `<body>
  <!--
    DA Structured Content document - woodstain-product schema
    Source: https://www.behr.com/webfiles/1775664274936/js/behr/woodstain/deckover.js
    Note: text fields retain i18n resource bundle keys from Bloomreach.
  -->

  <table>
    <thead>
      <tr><th colspan="2">DA Form</th></tr>
    </thead>
    <tbody>
      <tr><td>x-schema-name</td><td>woodstain-product</td></tr>
      <tr><td>title</td><td>deckover</td></tr>
    </tbody>
  </table>

  <!-- Variant 1: deckover -->
  <table>
    <thead>
      <tr><th colspan="2">Woodstain Product</th></tr>
    </thead>
    <tbody>
      <tr><td>variantKey</td><td>deckover</td></tr>
      <tr><td>name</td><td>advanced.deckover.name</td></tr>
    </tbody>
  </table>
</body>
`;
    const yDoc = new Y.Doc();
    expect(() => aem2doc(html, yDoc)).to.not.throw();
  });
});
