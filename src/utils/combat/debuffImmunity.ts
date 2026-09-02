import type { ControlEffect } from '../../types/abilities';
import type { DoTType } from '../../types/calculator';
import type { StatusEngine } from './statusEngine';
// Call-time-safe cycle: triggers imports targetCarriesBlockDebuff from this module and we import
// selfBuffNamesForOwners back. Both are used only inside function bodies (never at top-level
// evaluation), so there is no initialization-order hazard.
// eslint-disable-next-line import/no-cycle
import { selfBuffNamesForOwners } from './triggers';
import type { CombatEventBus } from './events';

/** Named buffs that make the holder IMMUNE to receiving debuffs. While active, every incoming
 *  debuff application (timed, persistent-stacking, DoT, control-as-named-debuff) is blocked and
 *  recorded as a RESIST. Already-landed debuffs are untouched. Extend from game data. */
export const BLOCK_DEBUFF_BUFFS: ReadonlySet<string> = new Set(['Block Debuff']);
export const isBlockDebuff = (name: string): boolean => BLOCK_DEBUFF_BUFFS.has(name);

/** True if `targetId` currently carries a Block Debuff buff (reads its self-buff names). */
export function targetCarriesBlockDebuff(statusEngine: StatusEngine, targetId: string): boolean {
    return selfBuffNamesForOwners(statusEngine, [targetId]).some(isBlockDebuff);
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

/** Per-DoT-type magnitude of the tier-I stack — the unit `ActiveDoTStack.tier` (and the parsed
 *  DoT config `tier`) is measured in. Corrosion I = 3, Inferno I = 15, Bomb I = 100; tier II/III
 *  are the 2×/3× multiples. `generic` DoTs are absolute-per-tick and carry no tier scale. */
const DOT_TIER_BASE: Record<DoTType, number> = {
    corrosion: 3,
    inferno: 15,
    bomb: 100,
    generic: 0,
};

/**
 * Map a DoT tier MAGNITUDE (e.g. Corrosion III = 9, Inferno II = 30) to its display numeral
 * ('I'|'II'|'III'|…). Returns '' when the type is untiered for display (bomb/generic) or when the
 * magnitude is not an exact multiple of the type's base tier (so arbitrary/synthetic magnitudes
 * never surface a misleading numeral — only the canonical I/II/III magnitudes do).
 */
export function dotTierNumeral(dotType: DoTType, magnitude: number): string {
    if (dotType === 'bomb' || dotType === 'generic') return '';
    const base = DOT_TIER_BASE[dotType];
    if (base <= 0 || magnitude <= 0 || magnitude % base !== 0) return '';
    const level = magnitude / base;
    return level < ROMAN.length ? ROMAN[level] : '';
}

/** Single source of truth for the resisted-debuff label of a blocked DoT, so the emit site and
 *  the test assertion agree. `tier` is the MAGNITUDE (corrosion 3/6/9, inferno 15/30/45) — the
 *  same value tickDoTs divides by 100 — NOT a 1/2/3 level. e.g. ('inferno', 45) -> 'Inferno III';
 *  ('bomb', 100) -> 'Bomb'. 'generic' is an absolute per-tick DoT, not tiered, so it always
 *  renders as the plain 'Damage over Time' label (no numeral) regardless of tier. */
export function dotResistLabel(dotType: DoTType, tier: number): string {
    if (dotType === 'generic') return 'Damage over Time';
    const kind = dotType.charAt(0).toUpperCase() + dotType.slice(1);
    if (dotType === 'bomb') return kind;
    const numeral = dotTierNumeral(dotType, tier);
    return numeral ? `${kind} ${numeral}` : kind;
}

/** Resisted-debuff label for a blocked control infliction, matching the named-debuff buff names
 *  used elsewhere (Stasis, Provoke, Concentrate Fire). Keeps the control block path's resist row
 *  consistent with the timed/DoT block rows. */
const CONTROL_EFFECT_LABEL: Record<ControlEffect, string> = {
    provoke: 'Provoke',
    taunt: 'Taunt',
    stasis: 'Stasis',
    'concentrate-fire': 'Concentrate Fire',
    disable: 'Disable',
};
export const controlEffectLabel = (effect: ControlEffect): string => CONTROL_EFFECT_LABEL[effect];

/** Emit a `debuff-resisted` event for a DoT that did not land.
 *
 *  ⚠️ THE NAME IS NARROWER THAN THE FUNCTION. It is NOT called only on the Block-Debuff path:
 *  `playerTurn`'s DoT LANDING-ROLL FAILURE arm (the `else` that draws `roundDebuffLanded`) calls it
 *  too, so the combat log can show "Inferno III resisted" symmetrically with stat-debuff resists.
 *  Tagging every call here as a Block-Debuff auto-resist would drop exactly the rolled DoT resists
 *  that #413's `viaLandingRoll` gate is supposed to keep.
 *
 *  Hence `viaLandingRoll`, which the CALLER supplies because only the caller knows which arm it is
 *  in: `false` on the Block-Debuff branch (no gate drawn), `true` on the landing-roll-failure
 *  branch. */
export function emitBlockDebuffResist(
    bus: CombatEventBus,
    sourceId: string,
    targetId: string,
    round: number,
    buffName: string,
    viaLandingRoll: boolean
): void {
    bus.emit({
        type: 'debuff-resisted',
        sourceId,
        targetId,
        round,
        buffName,
        ...(viaLandingRoll ? { viaLandingRoll: true as const } : {}),
    });
}
