// Headless screenshot helper for design-mockups builders.
// usage: node design-mockups/.shot.mjs <url> <out.png> [width=1440] [height=900] [waitMs=2500] [fullPage=0] [scrollY=0]
// Prints console errors and page errors so WebGL/shader failures are visible.
import { chromium } from 'playwright';
const [url, out, w = '1440', h = '900', wait = '2500', full = '0', sy = '0'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text()); });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('requestfailed', r => console.log('[requestfailed]', r.url(), r.failure()?.errorText));
await page.goto(url, { waitUntil: 'load' });
if (+sy) { await page.evaluate(y => window.scrollTo(0, y), +sy); }
await page.waitForTimeout(+wait);
await page.screenshot({ path: out, fullPage: full === '1' });
await browser.close();
console.log('saved', out);
