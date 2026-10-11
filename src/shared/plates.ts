/**
 * Plate, state, make and colour vocabulary shared by the server (lookups, validation) and the web
 * app (pickers, live feedback). The city's Towed (ygr5-vcbg) and Relocated (5k2z-suxx) datasets
 * match on the exact plate string, so everything here exists to make a wrong entry hard to save
 * and easy to notice.
 *
 * Codes below were taken from the live datasets on 2026-10-11 (`$group=state`, `$group=make`,
 * `$group=color`): tows use NCIC codes (`TOYT`, `WHI`), relocations use names (`Toyota`, `White`).
 */

export const PLATE_RE = /^[A-Z0-9]{2,8}$/;

/** Uppercase and drop the separators people type (spaces, dashes, dots). Nothing else is removed. */
export const normalizePlate = (s: string): string => (s ?? '').toUpperCase().replace(/[\s\-.·]/g, '');

export type Region = 'us' | 'territory' | 'canada';
export interface StateDef { code: string; name: string; region: Region; /** codes the city datasets use for it */ cityCodes: string[] }

const us: [string, string][] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'],
  ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'],
  ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'],
  ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'],
  ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'],
  ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'],
  ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'],
  ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
];
const territories: [string, string][] = [['AS', 'American Samoa'], ['GU', 'Guam'], ['MP', 'Northern Mariana Islands'], ['PR', 'Puerto Rico'], ['VI', 'U.S. Virgin Islands']];
const canada: [string, string][] = [
  ['AB', 'Alberta'], ['BC', 'British Columbia'], ['MB', 'Manitoba'], ['NB', 'New Brunswick'], ['NL', 'Newfoundland and Labrador'],
  ['NS', 'Nova Scotia'], ['ON', 'Ontario'], ['PE', 'Prince Edward Island'], ['QC', 'Quebec'], ['SK', 'Saskatchewan'],
];

// The tow dataset records Nebraska with the legacy code NB (7 rows on 2026-10-11, no NE), while the
// relocation dataset uses NE. Canadian plates appear as the province (ON) or as a bare CN.
const ALIASES: Record<string, string[]> = { NE: ['NE', 'NB'] };
export const STATES: StateDef[] = [
  ...us.map(([code, name]) => ({ code, name, region: 'us' as const, cityCodes: ALIASES[code] ?? [code] })),
  ...territories.map(([code, name]) => ({ code, name, region: 'territory' as const, cityCodes: [code] })),
  ...canada.map(([code, name]) => ({ code, name, region: 'canada' as const, cityCodes: [code, 'CN'] })),
];
const STATE_BY_CODE = new Map(STATES.map((s) => [s.code, s]));
export const stateByCode = (code: string): StateDef | undefined => STATE_BY_CODE.get(code);
export const isKnownState = (code: string): boolean => STATE_BY_CODE.has(code);
export const stateName = (code: string | null | undefined): string => (code && STATE_BY_CODE.get(code)?.name) || code || 'no state';

/** Values the city uses when a record has no state. A plate match on one of these is a *possible* match. */
const MISSING_STATE = new Set(['', 'NONE', 'NA', 'N/A', 'UNK', 'UN', 'XX', '??']);
export const isMissingState = (s: string | null | undefined): boolean => MISSING_STATE.has(String(s ?? '').trim().toUpperCase());
export const stateMatches = (userState: string, recordState: string | null | undefined): boolean =>
  (stateByCode(userState)?.cityCodes ?? [userState]).includes(String(recordState ?? '').trim().toUpperCase());

// ---------- plate validation (shared by the form and the API) ----------

export interface PlateCheck { normalized: string; error: string | null; warnings: string[] }

export function checkPlate(raw: string, state: string): PlateCheck {
  const normalized = normalizePlate(raw);
  const warnings: string[] = [];
  if (!normalized) return { normalized, error: 'Enter your plate number.', warnings };
  const bad = [...new Set(normalized.replace(/[A-Z0-9]/g, ''))];
  if (bad.length) return { normalized, error: `Plates only use letters A–Z and digits 0–9 (remove ${bad.map((c) => `“${c}”`).join(' ')}).`, warnings };
  if (normalized.length < 2) return { normalized, error: 'That is too short for a plate (at least 2 characters).', warnings };
  if (normalized.length > 8) return { normalized, error: `That is ${normalized.length} characters; plates have at most 8.`, warnings };
  if (state === 'IL') {
    const standard = (p: string) => /^[A-Z]{2}\d{5}$/.test(p) || /^[A-Z]\d{6}$/.test(p);
    if (normalized.length > 7) warnings.push('Illinois plates have at most 7 characters. Double-check it.');
    // Standard IL passenger plates: "AB 12345" (current) and "A 123456" (older series). Together they
    // are ~80% of IL plates in the city's tow records. Anything else may be vanity/specialty — allowed.
    else if (!standard(normalized)) {
      // Letter O / I typed where a standard plate has a digit: suggest the digit version.
      const digitsFixed = normalized.slice(0, 2) + normalized.slice(2).replace(/O/g, '0').replace(/I/g, '1');
      const alt = /^[A-Z]{2}/.test(normalized) ? digitsFixed : normalized[0] + normalized.slice(1).replace(/O/g, '0').replace(/I/g, '1');
      if (alt !== normalized && standard(alt)) warnings.push(`Did you mean ${alt}? Standard Illinois plates have digits there (zero, not letter O; one, not letter I).`);
      else warnings.push('Standard Illinois passenger plates look like AB 12345 or A 123456. Fine if yours is a vanity, specialty or truck plate — just double-check it.');
    }
  }
  if (/[OI]/.test(normalized) && !warnings.some((w) => w.startsWith('Did you mean'))) {
    warnings.push('Your plate has the letter O or I. Make sure it is not the digit 0 or 1 — the city matches the exact characters.');
  }
  return { normalized, error: null, warnings };
}

// ---------- make & colour vocabulary ----------

export interface MakeDef { key: string; label: string; codes: string[] }
/** `codes` are the NCIC make codes seen in the tow data; relocation records use the label text. */
export const MAKES: MakeDef[] = [
  ['acura', 'Acura', 'ACUR'], ['alfa', 'Alfa Romeo', 'ALFA'], ['audi', 'Audi', 'AUDI'], ['bmw', 'BMW', 'BMW'],
  ['buick', 'Buick', 'BUIC'], ['cadillac', 'Cadillac', 'CADI'], ['chevrolet', 'Chevrolet', 'CHEV'], ['chrysler', 'Chrysler', 'CHRY'],
  ['dodge', 'Dodge', 'DODG'], ['fiat', 'Fiat', 'FIAT'], ['ford', 'Ford', 'FORD'], ['genesis', 'Genesis', 'GENS'],
  ['gmc', 'GMC', 'GMC'], ['harley', 'Harley-Davidson', 'HD,HARL'], ['honda', 'Honda', 'HOND'], ['hummer', 'Hummer', 'HUMM'],
  ['hyundai', 'Hyundai', 'HYUN'], ['infiniti', 'Infiniti', 'INFI'], ['isuzu', 'Isuzu', 'ISU'], ['jaguar', 'Jaguar', 'JAGU,JAG'],
  ['jeep', 'Jeep', 'JEEP'], ['kawasaki', 'Kawasaki', 'KAWK'], ['kia', 'Kia', 'KIA'], ['landrover', 'Land Rover', 'LNDR,ROV,LAND'],
  ['lexus', 'Lexus', 'LEXS'], ['lincoln', 'Lincoln', 'LINC'], ['maserati', 'Maserati', 'MASE'], ['mazda', 'Mazda', 'MAZD'],
  ['mercedes', 'Mercedes-Benz', 'MERZ'], ['mercury', 'Mercury', 'MERC'], ['mini', 'MINI', 'MNNI,MINI'], ['mitsubishi', 'Mitsubishi', 'MITS'],
  ['nissan', 'Nissan', 'NISS'], ['oldsmobile', 'Oldsmobile', 'OLDS'], ['polestar', 'Polestar', 'POLS,PLSR'], ['pontiac', 'Pontiac', 'PONT'],
  ['porsche', 'Porsche', 'PORS'], ['ram', 'Ram', 'RAM'], ['rivian', 'Rivian', 'RIVA,RIVN'], ['saab', 'Saab', 'SAA,SAAB'],
  ['saturn', 'Saturn', 'STRN,SATR,SATU'], ['scion', 'Scion', 'SCIO'], ['smart', 'smart', 'SMRT,SMAR'], ['subaru', 'Subaru', 'SUBA'],
  ['suzuki', 'Suzuki', 'SUZI'], ['tesla', 'Tesla', 'TESL'], ['toyota', 'Toyota', 'TOYT,TOYO'], ['volkswagen', 'Volkswagen', 'VOLK,VW'],
  ['volvo', 'Volvo', 'VOLV'], ['yamaha', 'Yamaha', 'YAMA'],
].map(([key, label, codes]) => ({ key, label, codes: codes.split(',') }));

export interface ColorDef { key: string; label: string; family: string; codes: string[] }
/**
 * `family` groups shades that witnesses and tow drivers mix up (grey/silver, maroon/burgundy/red),
 * so a "Silver" record for a car the owner calls "Gray" is not reported as a contradiction.
 */
export const COLORS: ColorDef[] = [
  ['black', 'Black', 'black', 'BLK'], ['white', 'White', 'white', 'WHI,WHT'], ['gray', 'Gray', 'gray', 'GRY,GRA'],
  ['silver', 'Silver', 'gray', 'SIL'], ['blue', 'Blue', 'blue', 'BLU,DBL,LBL'], ['red', 'Red', 'red', 'RED'],
  ['maroon', 'Maroon', 'red', 'MAR'], ['burgundy', 'Burgundy', 'red', 'BUR,BRG'], ['green', 'Green', 'green', 'GRN,DGR,LGR'],
  ['tan', 'Tan', 'tan', 'TAN'], ['beige', 'Beige', 'tan', 'BGE,BEI'], ['cream', 'Cream', 'tan', 'CRM'],
  ['brown', 'Brown', 'brown', 'BRO,BRN'], ['bronze', 'Bronze', 'brown', 'BRZ'], ['copper', 'Copper', 'brown', 'CPR'],
  ['gold', 'Gold', 'gold', 'GLD'], ['orange', 'Orange', 'orange', 'ONG,ORG'], ['yellow', 'Yellow', 'yellow', 'YEL'],
  ['purple', 'Purple', 'purple', 'PLE,PUR,LAV,MVE'], ['pink', 'Pink', 'pink', 'PNK'], ['turquoise', 'Turquoise', 'blue', 'TRQ,TEA'],
].map(([key, label, family, codes]) => ({ key, label, family, codes: codes.split(',') }));
// NCIC prefixes D/L mean dark/light: DBL dark blue, LBL light blue, DGR dark green, LGR light green.

const MAKE_BY_KEY = new Map(MAKES.map((m) => [m.key, m]));
const COLOR_BY_KEY = new Map(COLORS.map((c) => [c.key, c]));
export const makeByKey = (k: string) => MAKE_BY_KEY.get(k);
export const colorByKey = (k: string) => COLOR_BY_KEY.get(k);

const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** City record value ("TOYT", "Toyota", "Kia Motors Corp") → our make, or undefined if unknown. */
export function decodeMake(raw: string | null | undefined): MakeDef | undefined {
  const v = squash(String(raw ?? ''));
  if (!v) return undefined;
  return MAKES.find((m) => m.codes.includes(v)) ?? MAKES.find((m) => v.startsWith(squash(m.label)) || (v.length >= 4 && squash(m.label).startsWith(v)));
}
export function decodeColor(raw: string | null | undefined): ColorDef | undefined {
  const v = squash(String(raw ?? ''));
  if (!v) return undefined;
  return COLORS.find((c) => c.codes.includes(v)) ?? COLORS.find((c) => squash(c.label) === v);
}

export type CrossCheckVerdict = 'consistent' | 'mismatch' | 'unknown';
export interface CrossCheck { verdict: CrossCheckVerdict; recordText: string; problems: string[] }

/**
 * Compare what the owner said about the car with what a city record says. A disagreement is never
 * silently treated as a match: the UI shows "This record shows a WHITE TOYOTA — is that your car?".
 */
export function crossCheck(mine: { make: string; color: string }, rec: { make: string | null; color: string | null }): CrossCheck {
  const rm = decodeMake(rec.make), rc = decodeColor(rec.color);
  const recordText = [rc?.label ?? rec.color ?? '', rm?.label ?? rec.make ?? ''].filter(Boolean).join(' ').toUpperCase() || 'NO MAKE OR COLOUR';
  const problems: string[] = [];
  let compared = 0;
  const myMake = makeByKey(mine.make), myColor = colorByKey(mine.color);
  if (myMake && rm) { compared++; if (rm.key !== myMake.key) problems.push(`make is ${rm.label}, yours is ${myMake.label}`); }
  if (myColor && rc) { compared++; if (rc.family !== myColor.family) problems.push(`colour is ${rc.label}, yours is ${myColor.label}`); }
  return { verdict: problems.length ? 'mismatch' : compared ? 'consistent' : 'unknown', recordText, problems };
}
