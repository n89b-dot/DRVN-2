# DRVN Mockups

This file is the quick index for reopening the DRVN mockups later.

## Open Everything

Double-click this file in Finder:

```txt
Open DRVN Mockups.command
```

It will:

1. Start the local Next.js server on `http://localhost:3002` if it is not already running.
2. Open all of the DRVN mockup pages in your browser.
3. Keep the terminal window open while the server is running.

If you prefer Terminal:

```bash
cd "/Users/neilbarrow/Desktop/Cursor Projects/DRVN 2"
npm run open:mockups
```

## Visual Mockup Links

These links work when the local server is running:

- Main DRVN app: http://localhost:3002
- Velocity concept: http://localhost:3002/home-alt
- Paddock / brutalist concept: http://localhost:3002/home-brutalist
- Clay / editorial concept: http://localhost:3002/home-anthropic
- Clickable product mockup: http://localhost:3002/mockup
- Design system / screen library: http://localhost:3002/design-system

## Source Code Map

- Main app shell: `src/app/page.tsx`
- Shared DRVN data, Audi S4 image, listings, cars, builds: `src/lib/drvn-data.ts`
- Shared UI helpers: `src/components/drvn/ui.tsx`
- Velocity concept route: `src/app/home-alt/page.tsx`
- Velocity concept UI: `src/app/home-alt/Velocity.tsx`
- Paddock concept route: `src/app/home-brutalist/page.tsx`
- Paddock concept UI: `src/app/home-brutalist/Paddock.tsx`
- Clay concept route: `src/app/home-anthropic/page.tsx`
- Clay concept UI: `src/app/home-anthropic/Clay.tsx`
- Clickable mockup route: `src/app/mockup/page.tsx`
- Clickable mockup screens: `src/app/mockup/screens.tsx`
- Clickable mockup data: `src/app/mockup/data.ts`
- Clickable mockup UI primitives: `src/app/mockup/ui.tsx`
- Design system route: `src/app/design-system/page.tsx`

## Useful Commands

```bash
npm run dev:mockups
npm run lint
npm run build
```
