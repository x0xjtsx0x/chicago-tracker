type Child = Node | string | number | null | undefined | false;

/** Build DOM safely: text children become text nodes (never innerHTML), so city data cannot inject markup. */
export function h(tag: string, attrs: Record<string, unknown> | null = null, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k in el && typeof v !== 'string') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(typeof c === 'number' ? String(c) : c);
  return el;
}
export const clear = (el: HTMLElement): void => { while (el.firstChild) el.removeChild(el.firstChild); };
