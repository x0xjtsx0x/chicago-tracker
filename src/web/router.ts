import { clear, h } from './dom.js';
import { closeSheet } from './components/sheet.js';
import { emptyState } from './ui.js';
import { errorText } from './ui.js';

type View = (root: HTMLElement) => Promise<void>;
export function startRouter(root: HTMLElement, views: Record<string, View>, fallback = 'home'): void {
  let seq = 0;
  const go = async () => {
    const my = ++seq;
    const name = location.hash.replace(/^#\//, '').split('?')[0] || fallback;
    const view = views[name] ?? views[fallback];
    const tab = name === 'welcome' ? 'settings' : name;
    document.querySelectorAll<HTMLAnchorElement>('.tabs a').forEach((a) => {
      if (a.dataset.route === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.body.dataset.view = name;
    closeSheet();
    clear(root);
    try { await view(root); } catch (e) {
      if (my !== seq) return;
      clear(root);
      root.append(emptyState('Something went wrong', errorText(e), h('button', { type: 'button', class: 'btn btn-primary', onclick: () => void go() }, h('span', null, 'Try again')), 'alert'));
    }
  };
  window.addEventListener('hashchange', () => {
    // Settings uses ?add=… deep links and rewrites the hash itself; only route on a path change.
    void go();
  });
  void go();
}
