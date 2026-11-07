/** Small visual effects shared by the shop and combat. */

/**
 * A cartoon "puff" of smoke where a unit is summoned: soft clouds burst outward and fade,
 * with a quick ring. (x, y) is the centre of the card, in the layer's coordinates.
 */
export function puff(layer: HTMLElement, x: number, y: number, life = 700, size = 1) {
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
    const dist = (70 + Math.random() * 40) * size;
    const s = (46 + Math.random() * 34) * size;
    const d = document.createElement('div');
    d.className = 'fx puff';
    d.style.left = `${x + Math.cos(a) * 18 * size}px`;
    d.style.top = `${y + Math.sin(a) * 24 * size}px`;
    d.style.width = d.style.height = `${s}px`;
    d.style.setProperty('--life', `${life * (0.8 + Math.random() * 0.35)}ms`);
    d.style.setProperty('--dx', `${Math.cos(a) * dist}px`);
    d.style.setProperty('--dy', `${Math.sin(a) * dist * 1.1 - 10}px`);
    layer.appendChild(d);
    setTimeout(() => d.remove(), life * 1.2 + 50);
  }
  const ring = document.createElement('div');
  ring.className = 'fx puff-ring';
  ring.style.left = `${x}px`;
  ring.style.top = `${y}px`;
  ring.style.setProperty('--life', `${life * 0.6}ms`);
  layer.appendChild(ring);
  setTimeout(() => ring.remove(), life + 50);
}
