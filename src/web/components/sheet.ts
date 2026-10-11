import { h, icon } from '../dom.js';

let current: { backdrop: HTMLElement; onClose?: () => void; prevFocus: HTMLElement | null } | null = null;

export function closeSheet(): void {
  if (!current) return;
  const c = current;
  current = null;
  c.backdrop.classList.add('closing');
  setTimeout(() => c.backdrop.remove(), 160);
  document.body.classList.remove('sheet-open');
  c.onClose?.();
  c.prevFocus?.focus?.();
}

let seq = 0;
/**
 * Bottom sheet on phones, centred dialog on desktop. `title` labels the dialog for screen readers;
 * Escape, the close button and a backdrop tap all close it, and focus returns to where it was.
 */
export function openSheet(content: HTMLElement, opts: { title?: string; onClose?: () => void; wide?: boolean } = {}): HTMLElement {
  const prevFocus = document.activeElement as HTMLElement | null;
  closeSheet();
  const titleId = `sheet-title-${++seq}`;
  const closeBtn = h('button', { type: 'button', class: 'icon-btn sheet-close', 'aria-label': 'Close', onclick: closeSheet }, icon('x', 20));
  const sheet = h('div', { class: `sheet${opts.wide ? ' sheet-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', ...(opts.title ? { 'aria-labelledby': titleId } : {}), tabindex: '-1' },
    h('div', { class: 'sheet-handle', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet-head' }, opts.title ? h('h2', { id: titleId }, opts.title) : h('span'), closeBtn),
    h('div', { class: 'sheet-body' }, content));
  const backdrop = h('div', { class: 'sheet-backdrop', onclick: (e: Event) => { if (e.target === backdrop) closeSheet(); } }, sheet);
  document.body.append(backdrop);
  document.body.classList.add('sheet-open');
  current = { backdrop, onClose: opts.onClose, prevFocus };
  requestAnimationFrame(() => sheet.focus());
  return sheet;
}
export const sheetIsOpen = (): boolean => current !== null;

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !current) return;
  if (document.querySelector('.dialog-backdrop')) return; // a confirm dialog on top handles its own Escape
  closeSheet();
});
