/**
 * COVERED VICTIMS HAVE NO SAME-TURN STASIS RE-APPLY VECTOR — the corpus precondition.
 *
 * The engine keeps two Stasis-break sets. The ANCHOR's marks go through
 * `resolveAnchorStasisBreak`, which suppresses a break when the same cast re-inflicted Stasis on
 * that victim; the COVERED footprint's marks are set unconditionally, on the stated ground that a
 * covered victim cannot be re-inflicted by the cast that hit it. Merging the two would make
 * covered breaks re-inflict-suppressible, which is unruled — so that ground has to stay true.
 *
 * It is true only because of a corpus coincidence, not a rule: a victim needs BOTH of
 *   (a) a firing-slot Stasis clause whose target reaches past the anchor, and
 *   (b) a damage footprint covering more than the anchor's own cell,
 * to be a covered victim the cast also re-inflicts. Which ships satisfy (a) is pinned by the census
 * arm below rather than stated here; each one is then required to fail (b).
 *
 * If this goes red, the unconditional covered break in engine.ts has become reachable and needs a
 * ruling before the fixture is adjusted — see `resolveAnchorStasisBreak` and the comment on
 * `coveredStasisVictims`.
 *
 * CORPUS ACCESS: the reference CSVs are gitignored, so this skips on a clean checkout — the same
 * pattern the other corpus-scanning tests use.
 */
import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { parsePattern } from '../../targetingParser';
import { resolveCells } from '../../targeting/resolvePattern';
import type { Ship } from '../../../types/ship';
import type { Ability } from '../../../types/abilities';

const FIRING_SLOTS = ['active', 'charged'] as const;
type FiringSlot = (typeof FIRING_SLOTS)[number];

/** Enemy-facing targets that resolve to the anchor ALONE. Anything else in `AbilityTarget`'s enemy
 *  family reaches at least one non-anchor victim. */
const ANCHOR_ONLY_ENEMY_TARGETS = [
    'enemy',
    'enemy-most-buffs',
    'enemy-highest-attack',
    'enemy-highest-speed',
];

const isStasis = (a: Ability): boolean =>
    (a.config.type === 'control' && a.config.effect === 'stasis') ||
    (a.config.type === 'debuff' && /stasis/i.test(a.config.buffName ?? ''));

/** Anchor position is arbitrary — `M2` is mid-board, so no pattern is clipped by an edge into
 *  looking single-cell when it is not. */
const ANCHOR = 'M2' as const;

interface WideStasisClause {
    ship: string;
    slot: FiringSlot;
    target: string;
    footprintCells: number;
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
            // A charged row with no pattern of its own fires on the active's; a ship with neither
            // has no positional footprint at all, so it produces no covered victims.
            const raw =
                (slot === 'charged' ? ship.chargedPattern : undefined) || ship.activePattern;
            const footprintCells = raw ? resolveCells(parsePattern(raw), ANCHOR).length : 0;
            for (const a of wide) {
                found.push({ ship: rec.name, slot, target: a.target, footprintCells });
            }
        }
    }
    return found;
};

describe.skipIf(!csvAvailable())('covered-victim Stasis re-inflict precondition (tripwire)', () => {
    it('the census of past-the-anchor Stasis clauses is unchanged', () => {
        // Doubles as the non-vacuity guard: a parser change that stopped producing a
        // past-the-anchor Stasis target would otherwise leave the assertion below passing over an
        // empty list forever. Asphyxiator's charged reads "on the targeted enemy and all enemies
        // adjacent to the enemy"; it contributes both a control and a debuff ability, hence the
        // dedupe to ship/slot.
        const census = [
            ...new Set(wideScopedStasisClauses().map((c) => `${c.ship}/${c.slot}`)),
        ].sort();
        expect(census).toEqual(['Asphyxiator/charged']);
    });

    it('no ship combines a past-the-anchor Stasis clause with a multi-cell footprint', () => {
        const reachable = wideScopedStasisClauses().filter((c) => c.footprintCells > 1);
        expect(reachable).toEqual([]);
    });
});
