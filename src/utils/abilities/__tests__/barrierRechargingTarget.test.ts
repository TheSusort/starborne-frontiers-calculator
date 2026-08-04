import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import type { Ship } from '../../../types/ship';
import type { Ability } from '../../../types/abilities';

const abilitiesFor = (text: string) =>
    buildShipAbilities({ refits: [], activeSkillText: text } as unknown as Ship).slots.find(
        (s) => s.slot === 'active'
    )?.abilities ?? [];

const rechargingIn = (abilities: Ability[]) =>
    abilities.find(
        (a) =>
            (a.config.type === 'buff' || a.config.type === 'debuff') &&
            a.config.buffName === 'Barrier Recharging'
    );

// The R2 passive is where both corpus clauses live (Panon's self-application, Quixilver's
// receiver-less one), so trace at refit level 2 — level 4 would resolve a (nonexistent) R4
// passive row instead. Skipped on a clean checkout, where docs/ship-skills.csv is absent.
const r2PassiveAbilities = (name: string) =>
    buildShipAbilities(buildTraceShip(name, { refitLevel: 2 }) as Ship).slots.find(
        (s) => s.slot === 'passive'
    )?.abilities ?? [];

describe('Barrier Recharging is a friendly-side status', () => {
    it('inherits the ally receiver rather than defaulting to the enemy', () => {
        const recharging = rechargingIn(
            abilitiesFor(
                'This Unit grants all allies <unit-skill>Barrier</unit-skill> for 1 hit and applies <unit-skill>Barrier Recharging</unit-skill> for 3 turns.'
            )
        );
        expect(recharging?.target).toBe('all-allies');
        expect(recharging?.config.type).toBe('buff');
    });

    it("keeps Panon's explicit self receiver", () => {
        const recharging = rechargingIn(
            abilitiesFor(
                'If this Unit is directly damaged, it gains <unit-skill>Barrier</unit-skill> for 1 turn and applies <unit-skill>Barrier Recharging</unit-skill> to itself for 3 turns.'
            )
        );
        expect(recharging?.target).toBe('self');
    });

    // NB the synthetic case above lands on 'self' for a weaker reason than it looks: its text
    // mentions no allies, so detectGrantScope's walk has no ally receiver to find. Feeding it an
    // ally-scoped sibling grant ("grants all allies Barrier … and applies Barrier Recharging to
    // itself") widens the lockout to 'all-allies' — pre-existing scope-walk behaviour, unchanged
    // by the friendly-side override and corpus-inert (no real clause pairs the two). The corpus
    // cases below are therefore the discriminating canaries: they run the real R2 passive text
    // through production slot routing.
    describe.skipIf(!csvAvailable())('corpus clauses', () => {
        it("routes Quixilver's R2 grant to its own team", () => {
            const recharging = rechargingIn(r2PassiveAbilities('Quixilver'));
            expect(recharging?.target).toBe('all-allies');
            expect(recharging?.config.type).toBe('buff');
        });

        it("leaves Panon's R2 lockout on itself", () => {
            const recharging = rechargingIn(r2PassiveAbilities('Panon'));
            expect(recharging?.target).toBe('self');
            expect(recharging?.config.type).toBe('buff');
        });
    });
});
