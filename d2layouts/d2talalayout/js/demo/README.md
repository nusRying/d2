# TALA JS showcase

Small browser UI for demonstrating the completed TALA Go → JavaScript migration.

## Run

From `d2layouts/d2talalayout/js`:

```bash
bun run demo
```

Open:

```text
http://localhost:4173
```

The page imports the real public package entry point:

```js
import { layout } from "../src/index.js";
```

It supports:

- editable ELK-compatible JSON input
- deterministic seed selection
- RIGHT/DOWN/LEFT/UP direction override
- real TALA layout execution
- SVG rendering of returned nodes, routes and labels
- nested containers
- output JSON inspection/copying
- node/edge/bend counts and layout timing

This folder is a trial-task showcase only and is intentionally excluded from the published npm package.
