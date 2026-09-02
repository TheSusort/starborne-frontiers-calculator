import { describe, expect, it } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import { SelectedGameBuff } from '../../../types/calculator';
import { bareEnemy } from '../__testutils__/bareRosterFixture';

// ---------------------------------------------------------------------------
// A.3 equivalence guard: a buff-only team actor (no `walk` bundle) must apply
// BOTH its active-sourced and its charge-sourced enemy debuffs over rounds.
//
// This pins the spec's stated primary risk — an empty kit routed through
// runPlayerTurn via the synthesized walk. It passes today through the legacy
// non-walked-team branch, and must STILL pass after the runCombat-entry
// normalizer wires every team actor onto the walked path (and after the legacy
// branch is later deleted).
//
// Harness mirrors src/utils/combat/__tests__/engine.events.test.ts: same
// idCounter/ab helper, same baseInput shape, same all-event-type bus tap.
// ---------------------------------------------------------------------------

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `g${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

// Plain single-active-skill focus attacker so the only enemy debuffs observed
// come from the buff-only team actor.
const plainSkills = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } })],
        },
    ],
});

const baseInput = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    // A real opponent for the team actor's debuffs to land on. DAMAGE fixture (15000
    // attack x 150% over 4-6 rounds) so it takes the 10M-HP form. `enemyDefense: 8000` is carried
    // onto the roster entry's own stats.defence; the fight-wide scalar is inert positionally (M6).
    enemyAttackers: bareEnemy({ stats: { hp: 10_000_000, defence: 8000 } }),
    attack: 15000,
    crit: 50,
    critDamage: 150,
    defensePenetration: 10,
    chargeCount: 0,
    shipSkills: plainSkills(),
    numRounds: 6,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 6000,
    hp: 30000,
    ...overrides,
});

const collect = (input: CombatEngineInput) => {
    idCounter = 0;
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const types: CombatEvent['type'][] = [
        'round-started',
        'turn-started',
        'turn-ended',
        'skill-fired',
        'ability-performed',
        'buff-applied',
        'buff-expired',
        'debuff-applied',
        'debuff-resisted',
        'dot-applied',
        'dot-ticked',
        'dot-detonated',
        'bomb-detonated',
        'control-applied',
        'hp-changed',
        'ship-destroyed',
    ];
    for (const t of types) bus.on(t, (e) => events.push(e));
    const result = runCombat({ ...input, bus });
    return { events, result };
};

describe('A.3 equivalence — buff-only team actor applies both debuff sources', () => {
    it('buff-only team actor applies BOTH its active- and charge-sourced enemy debuffs over rounds', () => {
        // A buff-only team actor (no shipSkills / no walk bundle): chargeCount 2,
        // startCharged → round 1 is charged, then it banks 2 more rounds to charge
        // again at round 4. Active rounds fire the active-sourced debuff; charged
        // rounds fire the charge-sourced debuff.
        const chargeDebuff: SelectedGameBuff = {
            id: 'tdA',
            buffName: 'Team Defense Down',
            stacks: 1,
            isStackable: false,
            parsedEffects: { defense: -15 },
            skillSource: 'charge',
            skillDuration: 2,
        };
        const activeDebuff: SelectedGameBuff = {
            id: 'tdB',
            buffName: 'Team Attack Down',
            stacks: 1,
            isStackable: false,
            parsedEffects: { attack: -10 },
            skillSource: 'active',
            skillDuration: 2,
        };

        const { events } = collect(
            baseInput({
                numRounds: 4,
                teamActors: [
                    {
                        id: 'support-1',
                        speed: 140,
                        chargeCount: 2,
                        startCharged: true,
                        selfBuffs: [],
                        enemyDebuffs: [chargeDebuff, activeDebuff],
                    },
                ],
            })
        );

        const applied = events
            .filter((e) => e.type === 'debuff-applied' && e.sourceId === 'support-1')
            .map((e) => (e.type === 'debuff-applied' ? e.buffName : ''));

        // charge-sourced → fired on the charged turn (round 1 startCharged).
        expect(applied).toContain('Team Defense Down');
        // active-sourced → fired on an active turn.
        expect(applied).toContain('Team Attack Down');
    });
});
