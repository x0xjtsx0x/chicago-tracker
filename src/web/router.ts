import { clear, h } from './dom.js';

type View = (root: HTMLElement) => Promise<void>;
export function startRouter(root: HTMLElement, views: Record<string, View>, fallback = 'home'): void {
  const go = async () => {
    const name = location.hash.replace(/^#\//, '').split('?')[0] || fallback;
    const view = views[name] ?? views[fallback];
    document.querySelectorAll<HTMLAnchorElement>('.tabs a').forEach((a) => a.setAttribute('aria-current', a.dataset.route === name ? 'page' : 'false'));
    clear(root);
    try { await view(root); } catch (e) {
      clear(root);
      root.append(h('div', { class: 'banner error' }, `Something went wrong: ${(e as Error).message}`));
    }
  };
  window.addEventListener('hashchange', go);
  void go();
}
