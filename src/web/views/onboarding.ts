import { api } from '../api.js';
import { clear, h, icon, add } from '../dom.js';
import { btn, busy, card, copyText, linkBtn, toast } from '../ui.js';
import { placeFlow } from '../flows/placeFlow.js';
import { vehicleFlow } from '../flows/vehicleFlow.js';
import type { Place } from '../../shared/types.js';
import type { Me, Notif, VehicleRow } from '../types.js';

// Progress is a per-browser convenience (which step you were on, whether you skipped the guide);
// everything that matters is saved server-side as you go. Storage may be unavailable: never throw.
const KEY = 'ct:onboarding';
type Progress = { step: number; dismissed: boolean; done: number[] };
function load(): Progress {
  try { return { step: 0, dismissed: false, done: [], ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { step: 0, dismissed: false, done: [] }; }
}
function save(p: Progress): void { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable */ } }
export const onboardingDismissed = (): boolean => load().dismissed;
export function restartOnboarding(): void { save({ step: 0, dismissed: false, done: [] }); location.hash = '#/welcome'; }

const STEPS = [
  { title: 'Home street', icon: 'broom', why: 'Street-cleaning dates for the side of the street you park on.' },
  { title: 'Calendar', icon: 'calendar', why: 'Sweeping days on your phone calendar, with reminders the evening before and the morning of.' },
  { title: 'Push alerts', icon: 'bell', why: 'A push the moment the city tows or relocates your car, and the evening before sweeping.' },
  { title: 'Your car', icon: 'car', why: 'Check the city tow and relocation records for your plate every 30 minutes.' },
];

export async function renderOnboarding(root: HTMLElement): Promise<void> {
  const [me, places, notif, vehicles] = await Promise.all([
    api<Me>('/api/me'), api<Place[]>('/api/places'), api<Notif>('/api/me/notifications'), api<VehicleRow[]>('/api/vehicles'),
  ]);
  const prog = load();
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  if (q.has('step')) prog.step = Math.min(STEPS.length - 1, Math.max(0, Number(q.get('step')) || 0));
  const isDone = (i: number) => prog.done.includes(i) || (i === 0 && places.some((p) => p.kind === 'home')) || (i === 3 && vehicles.length > 0);

  const go = (i: number) => {
    prog.step = i; save(prog);
    if (i >= STEPS.length) { prog.dismissed = true; save(prog); toast('All set', 'ok'); location.hash = '#/home'; return; }
    draw();
  };
  const markDone = (i: number) => { if (!prog.done.includes(i)) prog.done.push(i); save(prog); };
  const skipAll = () => { prog.dismissed = true; save(prog); location.hash = '#/home'; };

  const draw = () => {
    clear(root);
    const i = prog.step;
    const s = STEPS[i];
    root.append(
      h('header', { class: 'page-head' }, h('div', null, h('p', { class: 'eyebrow' }, 'Set up Chicago Tracker'), h('h1', null, s.title)),
        btn('Skip setup', { variant: 'ghost', small: true, onclick: skipAll })),
      h('ol', { class: 'stepper' }, ...STEPS.map((st, j) => h('li', { class: `${j === i ? 'current' : ''} ${isDone(j) ? 'done' : ''}`.trim(), 'aria-current': j === i ? 'step' : null },
        h('button', { type: 'button', onclick: () => go(j), 'aria-label': `Step ${j + 1}: ${st.title}${isDone(j) ? ' (done)' : ''}` },
          h('span', { class: 'stepper-dot' }, isDone(j) ? icon('check', 14) : String(j + 1)), h('span', { class: 'stepper-label' }, st.title))))),
      h('p', { class: 'lead' }, s.why));
    const body = card({ class: 'onboard-card' });
    root.append(body);
    const nav = (nextLabel = 'Next') => h('div', { class: 'row between flow-actions' },
      i > 0 ? btn('Back', { variant: 'ghost', onclick: () => go(i - 1) }) : h('span'),
      h('div', { class: 'row' }, btn('Skip this step', { variant: 'ghost', onclick: () => go(i + 1) }), btn(nextLabel, { variant: 'primary', onclick: () => { markDone(i); go(i + 1); } })));

    if (i === 0) {
      const homes = places.filter((p) => p.kind === 'home');
      if (homes.length) {
        body.append(h('p', null, icon('checkCircle', 18), ` You have ${homes.length === 1 ? 'a home street' : `${homes.length} home streets`}: `, h('strong', null, homes.map((p) => p.label).join(', ')), '.'),
          h('p', { class: 'small muted' }, 'Live on a corner or park on two streets? Add another.'),
          btn('Add another home street', { iconName: 'plus', onclick: () => { clear(body); body.append(placeFlow({ kind: 'home', lockKind: true, onDone: (p) => { if (p) places.push(p); draw(); } })); } }),
          nav());
      } else {
        body.append(placeFlow({ kind: 'home', lockKind: true, onDone: (p) => { if (p) { places.push(p); markDone(0); go(1); } else go(1); } }));
      }
    } else if (i === 1) {
      body.append(
        h('ol', { class: 'howto' },
          h('li', null, 'On your iPhone, tap ', h('strong', null, 'Subscribe'), ' below. (Or copy the link and add it in Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar.)'),
          h('li', null, 'Calendar asks to subscribe — tap ', h('strong', null, 'Subscribe'), ', then ', h('strong', null, 'Add'), '.'),
          h('li', null, 'Keep Tailscale connected: the calendar refreshes only while it can reach this app.')),
        h('div', { class: 'copy-field' }, h('input', { value: me.calUrl, readonly: true, 'aria-label': 'Calendar link', onfocus: (e: Event) => (e.target as HTMLInputElement).select() }),
          btn('Copy', { iconName: 'copy', onclick: () => copyText(me.calUrl, 'Calendar link copied') })),
        h('div', { class: 'row' }, linkBtn('Subscribe', me.calUrl, { variant: 'primary', iconName: 'calendar' })),
        h('p', { class: 'small muted' }, 'The link is private — anyone with it can see your sweeping dates. You can regenerate it in Settings.'),
        nav('I’ve subscribed'));
    } else if (i === 2) {
      const ntfyBase = notif.ntfyUrl ?? 'https://ntfy.sh';
      add(body, 
        notif.configured ? null : h('div', { class: 'banner banner-warn' }, icon('alert', 18), h('div', null, 'Push is turned off on the server (NTFY_URL is empty). You can skip this step.')),
        h('ol', { class: 'howto' },
          h('li', null, 'Install the free ', h('a', { href: 'https://apps.apple.com/app/ntfy/id1625396347', target: '_blank', rel: 'noopener noreferrer' }, 'ntfy app'), ' from the App Store and allow notifications.'),
          h('li', null, 'In ntfy, tap ', h('strong', null, '+'), ', paste your topic below', ntfyBase !== 'https://ntfy.sh' ? ', turn on “Use another server” and enter the server below' : '', ', then tap ', h('strong', null, 'Subscribe'), '.'),
          h('li', null, 'Come back and tap ', h('strong', null, 'Send test'), '. You should get a notification within a few seconds.')),
        h('div', { class: 'label' }, 'Your topic'),
        h('div', { class: 'copy-field' }, h('input', { value: notif.topic, readonly: true, 'aria-label': 'ntfy topic', class: 'mono', onfocus: (e: Event) => (e.target as HTMLInputElement).select() }),
          btn('Copy', { iconName: 'copy', onclick: () => copyText(notif.topic, 'Topic copied') })),
        ntfyBase !== 'https://ntfy.sh' ? h('p', { class: 'small' }, 'Server: ', h('code', null, ntfyBase)) : null,
        h('p', { class: 'small muted' }, 'The topic works like a password: anyone who knows it can read your alerts. Alerts never include your plate or addresses.'),
        (() => {
          const test = btn('Send test', { iconName: 'bell', disabled: !notif.configured });
          test.addEventListener('click', () => busy(test, 'Sending…', async () => { await api('/api/me/notifications/test', { method: 'POST' }); toast('Test sent — check your phone', 'ok'); }));
          return h('div', { class: 'row' }, test);
        })(),
        nav('It worked'));
    } else {
      if (vehicles.length) {
        body.append(h('p', null, icon('checkCircle', 18), ` ${vehicles.length === 1 ? 'Your car is' : `${vehicles.length} cars are`} saved and being checked.`), nav('Finish'));
      } else {
        body.append(vehicleFlow({ me, others: vehicles, onDone: (v) => { if (v) { vehicles.push(v); markDone(3); } go(STEPS.length); } }));
      }
    }
  };
  draw();
}
