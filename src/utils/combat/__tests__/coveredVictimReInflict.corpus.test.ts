/**
 * COVERED VICTIMS AND THE SAME-TURN STASIS RE-APPLY VECTOR — the corpus precondition.
 *
 * The engine keeps two Stasis-break sets. The ANCHOR's marks go through
 * `resolveAnchorStasisBreak`, which suppresses a break when the same cast re-inflicted Stasis on
 * that victim; the COVERED footprint's marks are set unconditionally, on the stated ground that a
 * covered victim cannot be re-inflicted by the cast that hit it. Merging the two would make
 * covered breaks re-inflict-suppressible, which is unruled — so that ground has to stay true.
 *
 * It is true only because of a corpus coincidence, not a rule: a victim needs BOTH of
 *   (a) a Stasis clause whose target reaches past the anchor, and
 *   (b) a damage footprint covering more than the anchor's own cell,
 * to be a covered victim the cast also re-inflicts. The census arm below pins which ships satisfy
 * (a); each one is then required to fail (b).
 *
 * SCOPE — READ THIS BEFORE TRUSTING A GREEN. This tripwire covers FIRING-SLOT clauses only, and
 * that is a known gap, not a complete argument. Meiying's PASSIVE inflicts Stasis on
 * `adjacent-enemies` from an `on-enemy-destroyed` trigger while her cast fires on
 * `Pattern-Backline-Range-2` (3 cells), so a charged cast that kills a debuffed enemy can
 * re-stasis a covered victim of that same cast — satisfying (a) and (b) together. That vector
 * routes through `triggers.ts` rather than the cast-path `inflictedEnemyDebuffs` push, so
 * `resolveAnchorStasisBreak` would not see it for the ANCHOR either; it is a pre-existing gap in
 * both sets, awaiting a ruling (#534). Widening the scan here without that ruling would only
 * assert a behaviour nobody has decided.
 *
 * If the firing-slot arm goes red, the unconditional covered break in engine.ts has become
 * reachable from a cast clause and needs a ruling before the fixture is adjusted — see
 * `resolveAnchorStasisBreak` and the comment on `coveredStasisVictims`.
 *
 * CORPUS ACCESS: both reference files are gitignored, so this skips on a clean checkout. The
 * pattern half matters as much as the text half — without `docs/ship-data.json` every footprint
 * measures 0 cells and the reachability arm passes over nothing.
 */
import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { parsePattern } from '../../targetingParser';
import { resolveCells } from '../../targeting/resolvePattern';
import { ALL_POSITIONS } from '../../targeting/board';
import type { Ship } from '../../../types/ship';
import type { Ability } from '../../../types/abilities';

const FIRING_SLOTS = ['active', 'charged'] as const;
type FiringSlot = (typeof FIRING_SLOTS)[number];

/** The ONLY enemy-facing target that resolves to the anchor by construction. The three
 *  `enemy-highest-*` / `enemy-most-buffs` selectors are deliberately NOT here: they are global
 *  selectors resolved live against the whole opposing roster (see `AbilityTarget` and
 *  `enemySelectorId`), so one can land on a covered footprint victim. No Stasis clause carries one
 *  today, which is exactly why leaving them out of the census would hide the day one does. */
const ANCHOR_ONLY_ENEMY_TARGETS = ['enemy'];

const isStasis = (a: Ability): boolean =>
    (a.config.type === 'control' && a.config.effect === 'stasis') ||
    (a.config.type === 'debuff' && /stasis/i.test(a.config.buffName ?? ''));

/** Widest footprint the pattern reaches ANYWHERE on the board. Measuring at one anchor understates
 *  it in the direction that hides a hit: `Pattern-Scattershot-Range-1` and `Pattern-Split-Range-1`
 *  both resolve to a single cell from M2 and to several from other positions. `'unresolvable'`
 *  keeps a pattern `resolveCells` cannot parse (the data already carries the typo
 *  `Patern-Support-All`) as a visible finding rather than a thrown test. */
const widestFootprint = (raw: string): number | 'unresolvable' => {
    try {
        const parsed = parsePattern(raw);
        return Math.max(...ALL_POSITIONS.map((p) => resolveCells(parsed, p).length));
    } catch {
        return 'unresolvable';
    }
};

interface WideStasisClause {
    ship: string;
    slot: FiringSlot;
    target: string;
    footprint: number | 'unresolvable';
}

const wideScopedStasisClauses = (): WideStasisClause[] => {
    const found: WideStasisClause[] = [];
    for (const rec of loadShipSkillRecords()) {
        const ship = buildTraceShip(rec.name, { refitLevel: 4 }) as Ship;
        const skills = buildShipAbilities(ship);
        for (const slot of FIRING_SLOTS) {
            const abilities = skills.slots.find((s) => s.slot === slot)?.abilities ?? [];
            const wide = abilities.filter(
                (a) => isStasis(a) && !ANCHOR_ONLY_ENEMY_TARGETS.includes(a.target)
            );
            if (wide.length === 0) continue;
            // A charged row with no pattern of its own fires on the active's (`chargedPattern ??
            // pattern`, playerTurn.ts and the engine's pattern reads); a ship with neither has no
            // positional footprint at all, so it produces no covered victims.
            const raw =
                (slot === 'charged' ? ship.chargedPattern : undefined) || ship.activePattern;
            const footprint = raw ? widestFootprint(raw) : 0;
            for (const a of wide) found.push({ ship: rec.name, slot, target: a.target, footprint });
        }
    }
    return found;
};

describe.skipIf(!csvAvailable() || !shipDataAvailable())(
    'covered-victim Stasis re-inflict precondition (tripwire)',
    () => {
        it('the census of past-the-anchor firing-slot Stasis clauses is unchanged', () => {
            // Doubles as the non-vacuity guard: a parser change that stopped producing a
            // past-the-anchor Stasis target would otherwise leave the assertion below passing over
            // an empty list forever. Asphyxiator's charged reads "on the targeted enemy and all
            // enemies adjacent to the enemy"; it contributes both a control and a debuff ability,
            // hence the dedupe to ship/slot.
            const census = [
                ...new Set(wideScopedStasisClauses().map((c) => `${c.ship}/${c.slot}`)),
            ].sort();
            expect(census).toEqual(['Asphyxiator/charged']);
        });

        it('no firing-slot clause combines a past-the-anchor Stasis with a multi-cell footprint', () => {
            const reachable = wideScopedStasisClauses().filter(
                (c) => c.footprint === 'unresolvable' || c.footprint > 1
            );
            expect(reachable).toEqual([]);
        });
    }
);
