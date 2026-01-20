# DA Parser

Parser for converting DA Admin HTML to ProseMirror/YDoc format and back.

## Overview

DA Parser provides bidirectional conversion between:
- **AEM HTML** (stored in DA Admin) ↔ **ProseMirror documents** (used in the DA Live editor)

The parser handles:
- Block structures (divs with classes → tables for editing)
- Section breaks (`<hr>` elements)
- Images with links (hoisting/unhoisting link attributes)
- Diff markers (`da-diff-added`, `da-diff-deleted`) for regional edits
- Custom DA metadata
- List handling with diff markers

## Installation

```bash
npm install da-parser
```

## Usage

### Converting AEM HTML to YDoc

```javascript
import { aem2doc } from 'da-parser';
import * as Y from 'yjs';

const html = `<body>
  <header></header>
  <main>
    <div>
      <p>Hello world</p>
    </div>
  </main>
  <footer></footer>
</body>`;

const ydoc = new Y.Doc();
await aem2doc(html, ydoc);
```

### Converting YDoc back to AEM HTML

```javascript
import { doc2aem } from 'da-parser';

const html = doc2aem(ydoc);
```

### Using the Schema

```javascript
import { getSchema, isKnownHTMLTag } from 'da-parser/schema';

const schema = getSchema();

// Check if a tag is recognized
isKnownHTMLTag('div'); // true
isKnownHTMLTag('custom-element'); // false
```

## Exports

| Export | Description |
|--------|-------------|
| `aem2doc(html, ydoc)` | Convert AEM HTML string to YDoc |
| `doc2aem(ydoc)` | Convert YDoc back to AEM HTML |
| `tableToBlock(child, fragment)` | Convert a table node to block structure |
| `EMPTY_DOC` | Empty document HTML template |
| `getSchema()` | Get the ProseMirror schema |
| `isKnownHTMLTag(tag)` | Check if tag is a known HTML element |
| `prosemirrorToYXmlFragment` | Re-exported from y-prosemirror |
| `yDocToProsemirror` | Re-exported from y-prosemirror |

## Development

```bash
# Install dependencies
npm install

# Run all tests (both environments)
npm test

# Run browser tests only (DOMParser path)
npm run test:browser

# Run Node.js tests only (hast-util-from-html path)
npm run test:node

# Run linter
npm run lint
```

## Testing Strategy

The parser has two HTML parsing code paths:
- **Browser**: Uses native `DOMParser` (zero bundle size)
- **Node.js/Workers**: Uses `hast-util-from-html`

The same test files run in both environments to ensure parity:
- `npm run test:browser` - Tests run in Chrome via `@web/test-runner` (wtr)
- `npm run test:node` - Tests run in Node.js via `mocha`

The `test/test-utils.js` module provides environment-agnostic utilities (`expect`, `readTestFile`) that work in both wtr and mocha.

## Test Fixtures

- `htmldown/` - HTML files for parser testing
- `htmltest/` - Additional HTML test cases
- `test/mocks/` - Mock HTML files for specific test scenarios

## License

Apache-2.0
