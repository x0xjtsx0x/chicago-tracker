type Child = Node | string | number | null | undefined | false;

/** Build DOM safely: text children become text nodes (never innerHTML), so city data cannot inject markup. */
export function h(tag: string, attrs: Record<string, unknown> | null = null, ...children: (Child | Child[])[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k in el && typeof v !== 'string') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(typeof c === 'number' ? String(c) : c);
  return el;
}
export const clear = (el: HTMLElement): void => { while (el.firstChild) el.removeChild(el.firstChild); };

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Stroke icons (24×24 grid), drawn with createElementNS — no markup strings anywhere. */
const ICONS: Record<string, string[]> = {
  home: ['M3 10.5 12 3l9 7.5', 'M5 9.5V20h5v-6h4v6h5V9.5'],
  park: ['M5 3h14v18H5z', 'M9 17V7h3.5a3 3 0 0 1 0 6H9'],
  settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
  car: ['M5 17h14v-5l-2-5H7l-2 5z', 'M5 12h14', 'M7.5 17v2', 'M16.5 17v2', 'M8 14.5h.01', 'M16 14.5h.01'],
  broom: ['M14 4 9.5 12.5', 'M6 12.5h7l1.5 8.5h-10z', 'M8.5 16.5 8 21', 'M11.5 16.5 11.5 21'],
  snow: ['M12 2v20', 'M4.9 6.5l14.2 11', 'M19.1 6.5 4.9 17.5', 'M9 3.5 12 6l3-2.5', 'M9 20.5 12 18l3 2.5'],
  pin: ['M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z', 'M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-4-4'],
  locate: ['M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M12 2v3', 'M12 19v3', 'M2 12h3', 'M19 12h3', 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  nav: ['M3 11 21 3l-8 18-2-8z'],
  check: ['M5 12.5 10 17.5 19.5 7'],
  checkCircle: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M8 12.5l3 3 5-6'],
  alert: ['M12 3 2 20h20z', 'M12 10v4', 'M12 17h.01'],
  x: ['M6 6l12 12', 'M18 6 6 18'],
  chevron: ['M9 6l6 6-6 6'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  bell: ['M6 16V11a6 6 0 1 1 12 0v5l2 2H4z', 'M10 20a2 2 0 0 0 4 0'],
  calendar: ['M4 6h16v15H4z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
  plus: ['M12 5v14', 'M5 12h14'],
  edit: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
  refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 4v7h-7'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v6', 'M12 7.5h.01'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v6H4V6h6'],
  bolt: ['M13 2 4 14h7l-1 8 9-12h-7z'],
  star: ['M12 2l2.4 5.6 6.1.5-4.6 4 1.4 6-5.3-3.2L6.7 18l1.4-6-4.6-4 6.1-.5z'],
};
export function icon(name: keyof typeof ICONS | string, size = 20): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  for (const d of ICONS[name] ?? ICONS.info) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

/** Element.append that skips null/false (for optional children). */
export function add(el: Element, ...kids: (Node | string | null | undefined | false)[]): void {
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(k);
}
