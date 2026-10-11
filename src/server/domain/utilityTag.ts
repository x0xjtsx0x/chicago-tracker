import type { UtilitiesConfig } from '../config.js';
import type { Permit, UtilityTag } from '../../shared/types.js';

export function utilityTag(p: Pick<Permit, 'applicant'>, cfg: UtilitiesConfig): UtilityTag {
  const a = (p.applicant ?? '').toUpperCase();
  for (const t of cfg.tags) if (t.patterns.some((pat) => a.includes(pat.toUpperCase()))) return t.tag;
  return null;
}
