import { icon } from './dom.js';
import { startRouter } from './router.js';
import { renderHome } from './views/home.js';
import { renderPark } from './views/park.js';
import { renderSettings } from './views/settings.js';
import { renderOnboarding } from './views/onboarding.js';

// Tab icons are SVG built with DOM APIs (index.html holds only the labels).
for (const a of document.querySelectorAll<HTMLAnchorElement>('.tabs a')) a.prepend(icon(a.dataset.icon ?? 'info', 24));
const brand = document.querySelector('.brand-mark');
if (brand) brand.append(icon('star', 18));

startRouter(document.getElementById('view')!, { home: renderHome, park: renderPark, settings: renderSettings, welcome: renderOnboarding });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
