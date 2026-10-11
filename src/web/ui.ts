import { ApiError } from './api.js';
import { h, icon } from './dom.js';

/** Small, consistent building blocks. Everything returns real DOM nodes (no HTML strings). */

type Attrs = Record<string, unknown>;
type Kids = (Node | string | null | undefined | false)[];

export function btn(label: string | Node, attrs: Attrs & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; iconName?: string; small?: boolean } = {}): HTMLButtonElement {
  const { variant = 'secondary', iconName, small, ...rest } = attrs;
  return h('button', { type: 'button', ...rest, class: `btn btn-${variant}${small ? ' btn-sm' : ''} ${String(rest.class ?? '')}`.trim() },
    iconName ? icon(iconName, small ? 16 : 18) : null, typeof label === 'string' ? h('span', null, label) : label) as HTMLButtonElement;
}
export function linkBtn(label: string, href: string, attrs: Attrs & { variant?: 'primary' | 'secondary' | 'ghost'; iconName?: string; external?: boolean } = {}): HTMLAnchorElement {
  const { variant = 'secondary', iconName, external, ...rest } = attrs;
  return h('a', { href, ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {}), ...rest, class: `btn btn-${variant} ${String(rest.class ?? '')}`.trim() },
    iconName ? icon(iconName, 18) : null, h('span', null, label)) as HTMLAnchorElement;
}

export const card = (attrs: Attrs | null, ...kids: Kids): HTMLElement => h('section', { ...attrs, class: `card ${String(attrs?.class ?? '')}`.trim() }, ...kids);
export const sectionTitle = (text: string, extra?: Node | null): HTMLElement =>
  h('div', { class: 'section-title' }, h('h2', null, text), extra ?? null);

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';
export const pill = (text: string, tone: Tone = 'neutral', iconName?: string): HTMLElement =>
  h('span', { class: `pill pill-${tone}` }, iconName ? icon(iconName, 14) : null, text);
export const chip = (text: string, attrs: Attrs = {}): HTMLElement => h('button', { type: 'button', class: 'chip', ...attrs }, text);

export function banner(text: string | Node, tone: Tone = 'warn', iconName = tone === 'bad' ? 'alert' : 'info'): HTMLElement {
  return h('div', { class: `banner banner-${tone}`, role: tone === 'bad' ? 'alert' : 'status' }, icon(iconName, 18), h('div', null, text));
}

export function emptyState(title: string, text: string, action?: Node | null, iconName = 'info'): HTMLElement {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, icon(iconName, 28)), h('h3', null, title), h('p', null, text), action ?? null);
}

export function skeleton(lines = 3): HTMLElement {
  return h('div', { class: 'card skeleton', 'aria-busy': 'true', 'aria-label': 'Loading' },
    h('div', { class: 'sk sk-title' }), ...Array.from({ length: lines }, (_, i) => h('div', { class: `sk sk-line${i === lines - 1 ? ' sk-short' : ''}` })));
}

let fieldSeq = 0;
/** Label + control + hint + live error, wired with aria-describedby. */
export function field(label: string, control: HTMLElement, opts: { hint?: string | Node; optional?: boolean } = {}): { el: HTMLElement; setError: (msg: string | null) => void; hintEl: HTMLElement } {
  const id = control.id || `f${++fieldSeq}`;
  control.id = id;
  const hintEl = h('div', { class: 'field-hint', id: `${id}-hint` }, opts.hint ?? '');
  const err = h('div', { class: 'field-error', id: `${id}-err`, role: 'alert', hidden: true });
  control.setAttribute('aria-describedby', `${id}-hint ${id}-err`);
  const el = h('div', { class: 'field' },
    h('label', { for: id }, label, opts.optional ? h('span', { class: 'optional' }, ' (optional)') : null), control, hintEl, err);
  return {
    el, hintEl,
    setError: (msg) => {
      err.textContent = msg ?? '';
      err.hidden = !msg;
      control.setAttribute('aria-invalid', msg ? 'true' : 'false');
    },
  };
}

export function select(options: { value: string; label: string; group?: string }[], value: string, attrs: Attrs = {}): HTMLSelectElement {
  const sel = h('select', attrs) as HTMLSelectElement;
  const groups = new Map<string, HTMLElement>();
  for (const o of options) {
    const opt = h('option', { value: o.value }, o.label) as HTMLOptionElement;
    if (o.value === value) opt.selected = true;
    if (o.group) {
      let g = groups.get(o.group);
      if (!g) { g = h('optgroup', { label: o.group }); groups.set(o.group, g); sel.append(g); }
      g.append(opt);
    } else sel.append(opt);
  }
  return sel;
}

/** A segmented control (radio group semantics). */
export function segmented<T extends string>(name: string, options: { value: T; label: string }[], value: T, onChange: (v: T) => void): HTMLElement {
  const wrap = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': name });
  const buttons = options.map((o) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(o.value === value), class: 'seg',
    onclick: () => { for (const b of buttons) b.setAttribute('aria-checked', String(b === buttons[options.indexOf(o)])); onChange(o.value); },
  }, o.label));
  wrap.append(...buttons);
  return wrap;
}

// ---------- toasts ----------
let toastHost: HTMLElement | null = null;
export function toast(text: string, tone: Tone = 'neutral', ms = 3200): void {
  if (!toastHost) { toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastHost); }
  const t = h('div', { class: `toast toast-${tone}` }, icon(tone === 'bad' ? 'alert' : tone === 'ok' ? 'checkCircle' : 'info', 18), h('span', null, text));
  toastHost.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}
export const errorText = (e: unknown): string => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong.');
export const toastError = (e: unknown): void => toast(errorText(e), 'bad', 5000);

/** Run an async action with the button disabled and a busy label. */
export async function busy<T>(button: HTMLButtonElement, label: string, fn: () => Promise<T>): Promise<T | undefined> {
  const span = button.querySelector('span');
  const prev = span?.textContent ?? '';
  button.disabled = true; button.setAttribute('aria-busy', 'true');
  if (span) span.textContent = label;
  try { return await fn(); } catch (e) { toastError(e); return undefined; } finally {
    button.disabled = false; button.removeAttribute('aria-busy');
    if (span && button.isConnected) span.textContent = prev;
  }
}

/** Ask before a destructive action. Resolves true only on an explicit confirm tap. */
export function confirmDialog(title: string, text: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const done = (v: boolean) => { back.remove(); document.removeEventListener('keydown', onKey); prevFocus?.focus?.(); resolve(v); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') done(false); };
    const ok = btn(confirmLabel, { variant: 'danger', onclick: () => done(true) });
    const cancel = btn('Cancel', { onclick: () => done(false) });
    const titleId = `dlg${++fieldSeq}`;
    const back = h('div', { class: 'dialog-backdrop', onclick: (e: Event) => { if (e.target === back) done(false); } },
      h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
        h('h2', { id: titleId }, title), h('p', null, text), h('div', { class: 'row end' }, cancel, ok)));
    document.addEventListener('keydown', onKey);
    document.body.append(back);
    cancel.focus();
  });
}

export async function copyText(text: string, what = 'Copied'): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); toast(what, 'ok'); return true; } catch { toast('Copy failed — select the text instead.', 'bad'); return false; }
}
