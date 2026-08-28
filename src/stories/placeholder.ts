/** Local data-URI imagery for stories — no network, no CSP surprises. */
export function plate(label: string, hue = 210): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='400'>
    <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
      <stop offset='0' stop-color='hsl(${hue},25%,72%)'/>
      <stop offset='1' stop-color='hsl(${hue},30%,45%)'/>
    </linearGradient></defs>
    <rect width='600' height='400' fill='url(#g)'/>
    <text x='24' y='372' font-family='monospace' font-size='28' fill='rgba(255,255,255,0.85)'>${label}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
