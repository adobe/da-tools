# DA Tools

A collection of tools for the [DA (Document Authoring)](https://da.live) platform.

## Tools

| Tool | Description |
|------|-------------|
| [da-parser](./da-parser) | Parser for converting DA Admin HTML to ProseMirror/YDoc format |

## Getting Started

```bash
# Install all dependencies
npm install

# Run tests across all tools
npm test

# Lint all tools
npm run lint
```

## Structure

This is an npm workspaces monorepo. Each tool lives in its own directory with its own `package.json`.

```
da-tools/
├── package.json          # Root workspace config
├── da-parser/            # HTML → ProseMirror parser
│   ├── src/
│   ├── test/
│   └── ...
└── (future tools)
```

## Adding a New Tool

1. Create a new directory at the root: `mkdir da-new-tool`
2. Add a `package.json` in the new directory
3. Add the directory name to the `workspaces` array in the root `package.json`

## License

Apache-2.0
