import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import { dealtBy } from '../__testutils__/perTargetDealt';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const debuffEnemy = (id: string, debuffs = 1): EnemyAttacker =>
    ({
        id,
        stats: {
            attack: 1,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 10,
            hacking: 0,
        },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: Array.from({ length: debuffs }, (_, i) => ({
                        id: `enemy-debuff-${i}`,
                        type: 'debuff' as const,
                        target: 'enemy' as const,
                        trigger: 'on-cast' as const,
                        conditions: [],
                        config: {
                            type: 'debuff' as const,
                            buffName: `Def Down ${i}`,
                            parsedEffects: {},
                            stacks: 1,
                            isStackable: false,
                            application: 'inflict' as const,
                            duration: 1,
                        },
                    })),
                },
            ],
        },
    }) as EnemyAttacker;

// Vindicator's on-resist HP proc, injected directly (the builder path is covered by Task 2).
const onResistPassive = (pct = 30): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        {
            id: 'vindi-onresist',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-debuff-resisted',
            conditions: [],
            config: { type: 'damage', multiplier: 0, hits: 1, hpBasisPct: pct },
        },
    ],
});

const noopActive: ShipSkills['slots'][number] = {
    slot: 'active',
    abilities: [
        {
            id: 'noop',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 0 },
        },
    ],
};

const CARRIER_HP = 1_000_000;
const BASE = (
    slots: ShipSkills['slots'],
    overrides: Partial<CombatEngineInput> = {}
): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots },
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: CARRIER_HP,
    speed: 100,
    healTargetId: 'attacker',
    mode: 'healing',
    ...overrides,
});

// Sums direct-channel creditDamage attributed to `sourceId` across the run.
const creditedDirectFor = (sourceId: string, input: CombatEngineInput): number => {
    let total = 0;
    runCombat({
        ...input,
        __testTapCreditDamage: (id, channel, amount) => {
            if (id === sourceId && channel === 'direct') total += amount;
        },
    });
    return total;
};

// Sums the PER-VICTIM dealt credit attributed to `sourceId` across the run. Against a real,
// positioned opposing roster a reactive proc reduces the victim's real HP through applyVictimDamage
// and books its intake there (creditDealt → RoundData.perTargetDealt) instead of on the credit-only
// `creditDamage` channel above — see engine.ts's applyReactiveDamage gate.
const dealtFor = (sourceId: string, input: CombatEngineInput): number =>
    dealtBy(runCombat(input).rounds, sourceId);

// SP-4b-1: the normalization boundary places every actor and synthesizes the focus's missing
// `target`/`pattern`, so the carrier's proc now resolves POSITIONALLY onto the real
// `enemyAttackers[]` entry instead of the legacy dummy sink. `applyReactiveDamage` therefore takes
// its per-victim branch: the proc lowers that enemy's real HP and books the intake via
// `creditDealt` (→ `RoundData.perTargetDealt`), and the credit-only `creditDamage('direct')`
// channel — the one `creditedDirectFor` taps — is no longer written at all. Every magnitude below
// moves to `dealtFor` and additionally pins the old channel EMPTY: the two destinations are
// mutually exclusive per proc, so asserting only `dealt > 0` would still pass if a later change
// re-credited both and double-counted.
describe('Vindicator on-resist HP damage — engine integration', () => {
    it('deals ~30% of the carrier max HP to the resisted enemy (defence-0, mitigation ~none)', () => {
        const input = BASE([noopActive, onResistPassive(30)], {
            enemyAttackers: [debuffEnemy('enemy-deb', 1)],
        });
        expect(dealtFor('attacker', input)).toBeCloseTo(CARRIER_HP * 0.3, 0);
        // The scalar sink is not credited in parallel.
        expect(creditedDirectFor('attacker', input)).toBe(0);
    });

    it('is mitigated by the victim defence', () => {
        const lowDefInput = BASE([noopActive, onResistPassive(30)], {
            enemyAttackers: [debuffEnemy('enemy-deb', 1)],
        });
        const lowDef = dealtFor('attacker', lowDefInput);
        const highDefEnemy = debuffEnemy('enemy-deb', 1);
        (highDefEnemy.stats as { defence: number }).defence = 50_000;
        const highDefInput = BASE([noopActive, onResistPassive(30)], {
            enemyAttackers: [highDefEnemy],
        });
        const highDef = dealtFor('attacker', highDefInput);
        expect(highDef).toBeGreaterThan(0);
        expect(highDef).toBeLessThan(lowDef);
        // Neither run leaks a parallel scalar credit that could carry the mitigation instead.
        expect(creditedDirectFor('attacker', lowDefInput)).toBe(0);
        expect(creditedDirectFor('attacker', highDefInput)).toBe(0);
    });

    it('procs once when two debuffs from ONE cast are both resisted', () => {
        const input = BASE([noopActive, onResistPassive(30)], {
            enemyAttackers: [debuffEnemy('enemy-deb', 2)],
        });
        expect(dealtFor('attacker', input)).toBeCloseTo(CARRIER_HP * 0.3, 0); // one proc, not two
        expect(creditedDirectFor('attacker', input)).toBe(0);
    });

    it('procs once per DISTINCT enemy resisting in the same round', () => {
        const input = BASE([noopActive, onResistPassive(30)], {
            enemyAttackers: [debuffEnemy('enemy-a', 1), debuffEnemy('enemy-b', 1)],
        });
        expect(dealtFor('attacker', input)).toBeCloseTo(CARRIER_HP * 0.6, 0); // two procs
        expect(creditedDirectFor('attacker', input)).toBe(0);
    });

    it('control: no on-resist passive → no credit', () => {
        const input = BASE([noopActive], { enemyAttackers: [debuffEnemy('enemy-deb', 1)] });
        // Extended to BOTH channels — pinning only the scalar one would have gone vacuous the
        // moment the proc moved to the per-victim channel.
        expect(creditedDirectFor('attacker', input)).toBe(0);
        expect(dealtFor('attacker', input)).toBe(0);
    });
});

// Team symmetry: an ENEMY-owned Vindicator resisting a PLAYER debuff procs identically.
//
// NOTE on targeting: this block states `position`/`target`/`pattern` on both sides EXPLICITLY, so
// the player's cast resolves via `resolvePositionalTarget` over `enemyAttackerActors` and lands on
// 'enemy-vindi' — the recipe `enemySideAttacked.integration.test.ts` uses for its positional
// two-team battle. Since SP-4b-1's normalization boundary those three axes are filled for any
// caller that omits them too, so the routing no longer depends on the fixture stating them; they
// stay spelled out here because the SPECIFIC victim matters, not merely that one exists.
const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

describe('Vindicator on-resist HP damage — team symmetry (enemy-owned)', () => {
    it('an enemy carrier deals ~30% of ITS max HP to the resisting player when it resists a player debuff', () => {
        const ENEMY_HP = 2_000_000;
        // Player casts a timed debuff at the (positionally-targeted) enemy carrier; the player's
        // hacking 0 vs the carrier's default security 100 → landing chance clamps to 0 → the
        // debuff is RESISTED every time (deterministic, no RNG pin needed).
        const input: CombatEngineInput = {
            attack: 1,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'player-debuff',
                                type: 'debuff',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [],
                                config: {
                                    type: 'debuff',
                                    buffName: 'Def Down',
                                    parsedEffects: {},
                                    stacks: 1,
                                    isStackable: false,
                                    application: 'inflict',
                                    duration: 1,
                                },
                            },
                        ],
                    },
                ],
            },
            enemyDefense: 0,
            enemyHp: ENEMY_HP,
            numRounds: 1,
            selfBuffs: [],
            enemyDebuffs: [],
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            hasChargedSkill: false,
            startCharged: false,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 100,
            healTargetId: 'attacker',
            mode: 'healing',
            hacking: 0,
            position: 'M4' as Position,
            target: parsedTarget('front'),
            pattern: basePattern(),
            enemyAttackers: [
                {
                    id: 'enemy-vindi',
                    stats: {
                        attack: 1,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: ENEMY_HP,
                        speed: 10,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: 'M4' as Position,
                    shipSkills: { slots: [noopActive, onResistPassive(30)] },
                } as EnemyAttacker,
            ],
        };
        // This fixture positions BOTH sides (it must, to route the player's debuff at the real
        // enemy Vindicator), so the retaliation reduces the player's real HP and books its intake
        // per-victim rather than on the credit-only `creditDamage` channel the non-positional
        // fixtures above read. Same magnitude, different channel.
        const dealt = dealtFor('enemy-vindi', input);
        expect(dealt).toBeGreaterThan(0);
        expect(dealt).toBeCloseTo(ENEMY_HP * 0.3, 0);
        // And nothing lands on the credit-only channel — the two are mutually exclusive by
        // construction, so a regression that silently reverted the routing would fail here.
        expect(creditedDirectFor('enemy-vindi', input)).toBe(0);
    });
});
