# Current DRVN 2 interface preview

Run `npm run preview:build` from DRVN 2. The build refreshes a generated Sites checkout in the sibling `DRVN Interface Preview` directory (override with `DRVN_PREVIEW_DIR`). It imports the current app pages, component library, feature components and globals.css on every build, including uncommitted local edits. There is no separately maintained preview UI and no dependency on design-mockups.

The build verifies SHA-256 hashes for every shared component and the stylesheet against the original source. `component-source.json` records the exact library snapshot. Edit UI only in DRVN 2. Rebuild and republish the Sites version to update the hosted preview; deployed Sites do not watch local source files.

Only platform/data boundaries are adapted: fictional in-memory records replace database clients; mutations return an explicit demo message; request cookies use defaults; dynamic routes are exported for fixture records. Static server-rendered search parameters use their default state. No production environment files or credentials are copied. This is an interface preview, not a functional commerce deployment.

The existing Sites project and access configuration are preserved. `out/` is the deployable static export.
