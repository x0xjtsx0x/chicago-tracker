import { h } from '../dom.js';

let backdrop: HTMLElement | null = null;
export function closeSheet(): void { backdrop?.remove(); backdrop = null; }
export function openSheet(content: HTMLElement): void {
  closeSheet();
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' },
    h('button', { class: 'sheet-close', 'aria-label': 'Close', onclick: closeSheet }, '✕'), content);
  backdrop = h('div', { class: 'sheet-backdrop', onclick: (e: Event) => { if (e.target === backdrop) closeSheet(); } }, sheet);
  document.body.append(backdrop);
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
