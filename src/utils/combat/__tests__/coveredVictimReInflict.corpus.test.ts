/**
 * THE STASIS-BREAK RE-INFLICT CHECK SEES CAST-PATH LANDINGS ONLY — the corpus census of what it
 * cannot see.
 *
 * A hit on a stasised enemy queues a §4.5 break, which the engine skips for any victim the SAME
 * cast landed Stasis on (`resolveStasisBreaks` in engine.ts, asked per victim — the aimed enemy and
 * every covered one alike). The "did this cast land Stasis on V" answer is `inflictedStasisOn`,
 * playerTurn's per-victim record of its own FIRING-slot clauses. A Stasis landed by a PASSIVE
 * clause routes through `triggers.ts` and never enters that record, so if such a clause lands on a
 * victim of its owner's own cast, that victim's break is NOT skipped (#534, awaiting a ruling).
 *
 * The census below pins every passive-slot Stasis clause aimed at the enemy side, each read:
 *   - Flamel ("on-attacked") and Fuying ("on-ally-attacked") stasis the enemy that attacked —
 *     the attacker of SOMEONE ELSE's hit, never a victim of the owner's own cast. Out of reach.
 *   - Meiying ("on-enemy-destroyed", adjacent enemies) fires off her own kill, so a charged cast on
 *     `Pattern-Backline-Range-2` that kills a debuffed enemy can stasis a struck neighbour of that
 *     same cast: the #534 gap.
 * A new entry is a new route around the re-inflict check and needs reading before it is added.
 *
 * CORPUS ACCESS: the reference file is gitignored, so this skips on a clean checkout.
 */
import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { isEnemyTarget } from '../../abilities/abilityTargetSide';
import type { Ship } from '../../../types/ship';
import type { Ability } from '../../../types/abilities';

const isControlStatus =
    (effect: 'stasis' | 'provoke') =>
    (a: Ability): boolean =>
        (a.config.type === 'control' && a.config.effect === effect) ||
        (a.config.type === 'debuff' && new RegExp(effect, 'i').test(a.config.buffName ?? ''));

const passiveEnemyClauses = (matches: (a: Ability) => boolean): string[] => {
    const found = new Set<string>();
    for (const rec of loadShipSkillRecords()) {
        const ship = buildTraceShip(rec.name, { refitLevel: 4 }) as Ship;
        const passive = buildShipAbilities(ship).slots.find((s) => s.slot === 'passive');
        for (const a of passive?.abilities ?? []) {
            if (matches(a) && isEnemyTarget(a.target))
                found.add(`${rec.name}/${a.trigger}/${a.target}`);
        }
    }
    return [...found].sort();
};

describe.skipIf(!csvAvailable() || !shipDataAvailable())(
    'passive-slot Stasis clauses the re-inflict check cannot see (census)',
    () => {
        it('the census of enemy-aimed passive Stasis clauses is unchanged', () => {
            expect(passiveEnemyClauses(isControlStatus('stasis'))).toEqual([
                'Flamel/on-attacked/enemy',
                'Fuying/on-ally-attacked/enemy',
                'Meiying/on-enemy-destroyed/adjacent-enemies',
            ]);
        });

        it('the census can see a passive control clause of another kind (validity)', () => {
            // Proves the scan reads passive slots at all: an empty Stasis census would otherwise
            // be indistinguishable from a scan that never looked.
            expect(passiveEnemyClauses(isControlStatus('provoke')).length).toBeGreaterThan(0);
        });
    }
);
