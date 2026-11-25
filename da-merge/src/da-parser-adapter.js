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
const METADATA_MAP = 'daMetadata';

/**
 * Wires @adobe/da-parser into the engine the same way for every caller.
 * @param {Object} parts Y (yjs), EditorState (prosemirror-state), and aem2doc, doc2aem,
 *   getSchema, yDocToProsemirror, prosemirrorToYXmlFragment (all from @adobe/da-parser)
 * @returns {{ aem2doc: Function, doc2aem: Function, canonicalize: Function }}
 */
export default function daParserAdapter({
  Y, EditorState, aem2doc, doc2aem, getSchema, yDocToProsemirror, prosemirrorToYXmlFragment,
}) {
  const schema = getSchema();
  return {
    aem2doc(html) {
      const ydoc = new Y.Doc();
      aem2doc(html, ydoc);
      const doc = yDocToProsemirror(schema, ydoc);
      return { state: EditorState.create({ doc, schema }), metadata: ydoc.getMap(METADATA_MAP) };
    },
    doc2aem(doc, metadata) {
      const ydoc = new Y.Doc();
      prosemirrorToYXmlFragment(doc, ydoc.getXmlFragment('prosemirror'));
      const map = ydoc.getMap(METADATA_MAP);
      metadata?.forEach((value, key) => map.set(key, value));
      return doc2aem(ydoc);
    },
    canonicalize(html) {
      const ydoc = new Y.Doc();
      aem2doc(html, ydoc);
      return doc2aem(ydoc);
    },
  };
}
