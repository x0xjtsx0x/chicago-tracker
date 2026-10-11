import { api } from '../api.js';
import { clear, h, icon, add } from '../dom.js';
import { btn, busy, field, select, toast } from '../ui.js';
import { carDescription, plateBadge, plateChars, vehicleCard } from '../components/vehicle.js';
import { checkPlate, COLORS, MAKES, STATES, stateName } from '../../shared/plates.js';
import type { Vehicle } from '../../shared/types.js';
import type { Me, VehicleRow } from '../types.js';

const COMMON = ['IL', 'IN', 'WI', 'MI'];
const REGION_LABEL = { us: 'US states', territory: 'DC & territories', canada: 'Canada' } as const;
function stateOptions(filter = '') {
  const f = filter.trim().toLowerCase();
  const hit = (s: (typeof STATES)[number]) => !f || s.code.toLowerCase() === f || s.name.toLowerCase().includes(f);
  const common = STATES.filter((s) => COMMON.includes(s.code) && hit(s)).sort((a, b) => COMMON.indexOf(a.code) - COMMON.indexOf(b.code));
  return [
    ...common.map((s) => ({ value: s.code, label: `${s.name} (${s.code})`, group: 'Nearby' })),
    ...STATES.filter((s) => !COMMON.includes(s.code) && hit(s)).map((s) => ({
      value: s.code, label: `${s.name} (${s.code})`, group: REGION_LABEL[s.code === 'DC' ? 'territory' : s.region],
    })),
  ];
}

/**
 * Add or edit a car in three steps:
 *  1. Enter — state picker (default IL), plate with live normalisation and character tiles,
 *     optional nickname/make/colour.
 *  2. Review — a plate-shaped preview and an explicit "Yes, this is my plate". (A review screen,
 *     not type-it-twice: on a phone people paste the first entry into the second, and someone who
 *     reads O as 0 types the same mistake twice. Letter/digit tiles catch that; repetition doesn't.)
 *  3. Saved — runs the live check immediately and shows exactly what was searched and found.
 */
export function vehicleFlow(opts: { me: Me; existing?: VehicleRow; others: Vehicle[]; onDone: (v: VehicleRow | null) => void }): HTMLElement {
  const root = h('div', { class: 'flow' });
  const ex = opts.existing;
  const draft = { state: ex?.state ?? 'IL', plateRaw: ex?.plate ?? '', nickname: ex?.nickname ?? '', make: ex?.make ?? '', color: ex?.color ?? '' };

  const steps = h('ol', { class: 'steps', 'aria-label': 'Progress' });
  const setStep = (n: number) => {
    clear(steps);
    ['Enter', 'Review', 'Check'].forEach((t, i) => steps.append(h('li', { class: i < n ? 'done' : i === n ? 'current' : '', 'aria-current': i === n ? 'step' : null }, t)));
  };

  const enter = () => {
    clear(root); setStep(0); root.append(steps);
    // State: native select everywhere (the iPhone wheel picker); on desktop a filter box narrows it.
    const stateSel = select(stateOptions(), draft.state, { autocomplete: 'off' });
    const stateField = field('Plate state or province', stateSel, { hint: 'The city matches plate AND state exactly. Most Chicago cars: Illinois.' });
    const desktop = window.matchMedia('(pointer: fine)').matches;
    const stateFilter = h('input', { type: 'search', placeholder: 'Type to filter states…', 'aria-label': 'Filter states', class: 'state-filter', autocomplete: 'off' }) as HTMLInputElement;
    stateFilter.addEventListener('input', () => {
      const keep = stateSel.value;
      const opts2 = stateOptions(stateFilter.value);
      while (stateSel.firstChild) stateSel.removeChild(stateSel.firstChild);
      const fresh = select(opts2, opts2.some((o) => o.value === keep) ? keep : opts2[0]?.value ?? keep);
      stateSel.append(...Array.from(fresh.childNodes));
      stateSel.value = opts2.some((o) => o.value === keep) ? keep : opts2[0]?.value ?? keep;
      draft.state = stateSel.value; validate();
    });
    stateFilter.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); plateIn.focus(); } });

    const plateIn = h('input', {
      class: 'plate-input', value: draft.plateRaw, maxlength: 12, autocomplete: 'off', autocapitalize: 'characters',
      autocorrect: 'off', spellcheck: false, inputmode: 'text', enterkeyhint: 'next', placeholder: 'ABC1234',
    }) as HTMLInputElement;
    const plateField = field('Plate number', plateIn, { hint: 'Letters and digits only. Spaces and dashes are removed for you.' });
    const live = h('div', { class: 'plate-live', 'aria-live': 'polite' });
    const warn = h('div', { class: 'field-warn', 'aria-live': 'polite' });

    const nickIn = h('input', { value: draft.nickname, maxlength: 30, placeholder: 'e.g. The Civic', autocomplete: 'off' }) as HTMLInputElement;
    const makeSel = select([{ value: '', label: 'Not set' }, ...MAKES.map((m) => ({ value: m.key, label: m.label }))], draft.make);
    const colorSel = select([{ value: '', label: 'Not set' }, ...COLORS.map((c) => ({ value: c.key, label: c.label }))], draft.color);
    const next = btn('Review', { variant: 'primary', iconName: 'chevron' });

    let valid = false;
    function validate() {
      draft.state = stateSel.value; draft.plateRaw = plateIn.value;
      const c = checkPlate(draft.plateRaw, draft.state);
      clear(live); clear(warn);
      const touched = draft.plateRaw.trim().length > 0;
      plateField.setError(touched ? c.error : null);
      if (c.normalized && !c.error) {
        if (draft.plateRaw !== c.normalized) live.append(h('div', { class: 'small' }, 'You typed ', h('code', null, draft.plateRaw), ' → we’ll search ', h('code', null, c.normalized)));
        live.append(plateChars(c.normalized));
      }
      for (const w of c.warnings) warn.append(h('div', null, icon('alert', 16), h('span', null, w)));
      const dup = opts.others.find((o) => o.id !== ex?.id && o.plate === c.normalized && o.state === draft.state);
      if (dup && !c.error) plateField.setError(`You already saved ${draft.state} · ${c.normalized}.`);
      valid = !c.error && !dup;
      next.disabled = !valid;
    }
    plateIn.addEventListener('input', () => {
      // Uppercase as you type, keeping the caret where it was.
      const pos = plateIn.selectionStart;
      plateIn.value = plateIn.value.toUpperCase();
      if (pos !== null) plateIn.setSelectionRange(pos, pos);
      validate();
    });
    plateIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && valid) { e.preventDefault(); next.click(); } });
    stateSel.addEventListener('change', validate);
    next.addEventListener('click', () => {
      if (!valid) return;
      Object.assign(draft, { nickname: nickIn.value.trim(), make: makeSel.value, color: colorSel.value });
      review();
    });

    root.append(
      h('div', { class: 'field-group' }, desktop ? stateFilter : null, stateField.el),
      plateField.el, live, warn,
      h('details', { class: 'more', ...(draft.make || draft.color || draft.nickname ? { open: true } : {}) },
        h('summary', null, 'Nickname, make and colour (recommended)'),
        h('p', { class: 'small muted' }, 'Tow and relocation records list the car’s make and colour. If you add yours, a record for a different car is flagged instead of trusted.'),
        field('Nickname', nickIn, { optional: true, hint: 'Shown in the app only — never in push notifications.' }).el,
        h('div', { class: 'grid-2' }, field('Make', makeSel, { optional: true }).el, field('Colour', colorSel, { optional: true }).el)),
      h('div', { class: 'row end flow-actions' }, btn('Cancel', { variant: 'ghost', onclick: () => opts.onDone(null) }), next));
    validate();
    requestAnimationFrame(() => (ex ? plateIn : desktop ? stateFilter : plateIn).focus({ preventScroll: true }));
  };

  const review = () => {
    clear(root); setStep(1); root.append(steps);
    const c = checkPlate(draft.plateRaw, draft.state);
    const desc = carDescription(draft);
    const yes = btn(ex ? 'Yes, save changes' : 'Yes, this is my plate', { variant: 'primary', iconName: 'check' });
    yes.addEventListener('click', () => busy(yes, 'Saving…', async () => {
      const body = { plate: c.normalized, state: draft.state, nickname: draft.nickname, make: draft.make, color: draft.color };
      const saved = ex
        ? await api<VehicleRow>(`/api/vehicles/${ex.id}`, { method: 'PATCH', body })
        : await api<Vehicle>('/api/vehicles', { method: 'POST', body });
      toast(ex ? 'Car updated' : 'Car saved', 'ok');
      checked(saved);
    }));
    add(root, 
      h('h3', { class: 'flow-q' }, 'Is this exactly your plate?'),
      h('div', { class: 'review-plate' }, plateBadge(draft.state, c.normalized, 'lg')),
      plateChars(c.normalized),
      h('p', { class: 'center' }, h('strong', null, stateName(draft.state)), desc ? ` · ${desc}` : '', draft.nickname ? ` · “${draft.nickname}”` : ''),
      c.warnings.length ? h('div', { class: 'field-warn' }, ...c.warnings.map((w) => h('div', null, icon('alert', 16), h('span', null, w)))) : null,
      h('p', { class: 'small muted' }, 'The city matches the exact characters and state. One wrong character or the wrong state means a tow would never be found — check each tile against your plate.'),
      h('div', { class: 'row end flow-actions' }, btn('Edit', { iconName: 'edit', onclick: enter }), yes));
    yes.focus();
  };

  const checked = (saved: Vehicle) => {
    clear(root); setStep(2); root.append(steps);
    const host = h('div', { class: 'checking' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', null, 'Searching the city’s tow and relocation records…'));
    const done = btn('Done', { variant: 'primary', disabled: true });
    root.append(host, h('div', { class: 'row end flow-actions' }, done));
    let result: VehicleRow | null = null;
    done.addEventListener('click', () => opts.onDone(result));
    api<VehicleRow>(`/api/vehicles/${saved.id}/check`, { method: 'POST' })
      .then((row) => { result = row; host.replaceWith(vehicleCard(row, opts.me, { openSearch: true })); })
      .catch(() => {
        result = { ...saved, status: null };
        host.replaceWith(h('div', { class: 'banner banner-warn' }, icon('alert', 18), h('div', null, 'Saved, but the first check could not run. It will retry within 30 minutes — or tap Check now on Home.')));
      })
      .finally(() => { done.disabled = false; done.focus(); });
  };

  enter();
  return root;
}
