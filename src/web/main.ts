import { startRouter } from './router.js';
import { renderHome } from './views/home.js';
import { renderPark } from './views/park.js';
import { renderSettings } from './views/settings.js';

startRouter(document.getElementById('view')!, { home: renderHome, park: renderPark, settings: renderSettings });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
