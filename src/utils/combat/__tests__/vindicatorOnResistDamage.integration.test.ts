import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { simulateBattle, BattlePlacement } from '../../calculators/battleSimulator';
import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import { flattenRound } from '../log/__testutils__/flattenCombatLog';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import { dealtBy } from '../__testutils__/perTargetDealt';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const debuffEnemy = (id: string, debuffs = 1): EnemyAttacker => ({
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
});

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
            position: 'M4',
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
                    position: 'M4',
                    shipSkills: { slots: [noopActive, onResistPassive(30)] },
                },
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

// ----------------------------------------------------------------------------------------------
// PER-ATTACK GRANULARITY (owner ruling, 2026-08-28): "it should be 2 procs if it's 2 sub attacks.
// If it's one attack applying 2 debuffs it should proc once."
//
// The second half is already covered above ("procs once when two debuffs from ONE cast are both
// resisted") and is unchanged. The first half was NOT: #413 corrected the dedupe key to
// (owner, ability, target, subAttackIndex) but wired the `subAttackIndex` stamp onto the sibling
// `on-enemy-debuff-resisted` listener only, so Vindicator's intents still reached the guard with
// no attack identity and fell to the `'x'` key. A 2-hit enemy cast resisted TWICE retaliated once.
//
// These arms need the POSITIONAL harness (`simulateBattle`) rather than the `runCombat` fixtures
// above: sub-attack identity only exists on the positional path, where the engine buffers each
// sub-attack's enemy-application emitters under its own index. The non-positional path resolves a
// whole cast in one call and legitimately has no index to stamp.
// ----------------------------------------------------------------------------------------------

/** One proc: a flat 30% of the carrier's MAX HP (not a compounding basis), so N procs read as N×. */
const ONE_PROC = CARRIER_HP * 0.3;

/** A real Vindicator on its verbatim CSV kit. 4 refits → `getShipSkillRows` selects
 *  `secondPassiveSkillText`, the R2 row that carries the on-resist clause (the R1 row has only the
 *  Shield Penetration + Magnetized Shielding half). */
function vindicatorShip(id: string): Ship {
    const rec = loadShipSkillRecords().find((r) => r.name.toUpperCase() === 'VINDICATOR');
    if (!rec) throw new Error('docs/ship-skills.csv: no record for "Vindicator"');
    return {
        id,
        name: 'Vindicator',
        rarity: 'legendary',
        faction: 'ATLAS_SYNDICATE',
        type: 'Defender',
        baseStats: {
            hp: 0,
            attack: 0,
            defence: 0,
            hacking: 200,
            security: 100,
            crit: 0,
            critDamage: 0,
            speed: 100,
        },
        equipment: {},
        implants: {},
        refits: Array.from({ length: 4 }, () => ({})) as unknown as Ship['refits'],
        affinity: 'chemical',
        activeSkillText: rec.active,
        chargeSkillCharge: rec.chargeCharge,
        chargeSkillText: rec.charge,
        secondPassiveSkillText: rec.passives[1],
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
    };
}

/** An enemy debuffer with a caller-supplied active text. Its hacking is forced to 0 against
 *  Vindicator's security 100, so every debuff it inflicts is resisted by a DRAWN-and-failed roll —
 *  the only cause that procs. */
const enemyDebuffer = (id: string, activeSkillText: string): Ship => ({
    id,
    name: 'Debuffer',
    rarity: 'legendary',
    faction: 'AURELIAN_SOVEREIGNTY',
    type: 'Attacker',
    baseStats: {
        hp: 0,
        attack: 0,
        defence: 0,
        hacking: 200,
        security: 100,
        crit: 0,
        critDamage: 0,
        speed: 100,
    },
    equipment: {},
    implants: {},
    refits: [],
    affinity: 'antimatter',
    activeSkillText,
    chargeSkillCharge: 0,
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
});

const placement = (
    ship: Ship,
    position: Position,
    over: Partial<BattlePlacement['statOverrides']> = {}
): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: 1,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 200,
        defence: 0,
        hp: CARRIER_HP,
        security: 100,
        speed: 100,
        ...over,
    },
});

/** Vindicator's retaliation rows for the round. Its own 100%-of-attack(1) cast is ~1 damage, three
 *  orders of magnitude below a 300,000 proc, so the magnitude filter is a clean split. */
const procDamage = (
    result: ReturnType<typeof simulateBattle>,
    round: number,
    actorId: string
): number[] =>
    flattenRound(result.combatLog.find((r) => r.round === round)!)
        .filter((e) => e.kind === 'attack' && e.actorId === actorId)
        .flatMap((e) => e.targets)
        .map((t) => t.amount ?? 0)
        .filter((amount) => amount > 1_000);

/** Vindicator slower than the attacker, so the enemy's cast (and the resists) resolve first. */
const runVsEnemyCasting = (activeSkillText: string) =>
    simulateBattle({
        playerTeam: [placement(vindicatorShip('v'), 'M4', { speed: 40 })],
        enemyTeam: [placement(enemyDebuffer('e1', activeSkillText), 'M4', { hacking: 0 })],
        rounds: 1,
    });

describe.skipIf(!csvAvailable())('Vindicator on-resist — per-attack granularity', () => {
    it('procs TWICE when a 2-sub-attack enemy cast is resisted on both sub-attacks', () => {
        const result = runVsEnemyCasting(
            'This Unit attacks twice dealing <unit-damage>1% damage</unit-damage> and Inflicts <unit-skill>Speed Down II</unit-skill> for 2 turns.'
        );
        const round1 = result.combatLog.find((r) => r.round === 1)!;

        // THE INSTRUMENT: two resists really did occur. A fixture whose skill parsed to a single
        // hit would assert the OLD behaviour and read as a pass.
        expect(flattenRound(round1).filter((e) => e.kind === 'debuff-resisted').length).toBe(2);
        // Two procs, each a flat 30% of max HP.
        const amounts = procDamage(result, 1, 'attacker');
        expect(amounts).toHaveLength(2);
        for (const amount of amounts) expect(amount).toBeCloseTo(ONE_PROC, 0);
    });

    it('procs ONCE when one attack applies two debuffs and both are resisted', () => {
        const result = runVsEnemyCasting(
            'This Unit Inflicts <unit-skill>Speed Down II</unit-skill> for 2 turns and Inflicts <unit-skill>Attack Down II</unit-skill> for 2 turns.'
        );
        const round1 = result.combatLog.find((r) => r.round === 1)!;

        // Same instrument, opposite conclusion: two resist events, ONE attack, so one proc. This
        // is the arm that would break if the guard were widened to key on the buff name.
        expect(flattenRound(round1).filter((e) => e.kind === 'debuff-resisted').length).toBe(2);
        expect(procDamage(result, 1, 'attacker')).toHaveLength(1);
    });

    // THE REACHABLE REAL-KIT CASE, and the reason this is not a theoretical fix. The corpus has
    // exactly one multi-hit ship (Enforcer) and it inflicts nothing directly — which is why the
    // synthetic arms above exist. But its PASSIVE inflicts Defense Shred ON CRIT, and a 3-hit cast
    // that crits on several sub-attacks really does produce several separate resists against the
    // same victim in one turn. That path goes through the REACTIVE infliction emit in triggers.ts,
    // a different site from the cast debuff loop the arms above exercise.
    it('procs per sub-attack against a real Enforcer crit-inflicting Defense Shred', () => {
        const rec = loadShipSkillRecords().find((r) => r.name.toUpperCase() === 'ENFORCER');
        if (!rec) throw new Error('docs/ship-skills.csv: no record for "Enforcer"');
        const enforcer: Ship = {
            ...enemyDebuffer('enforcer', rec.active),
            name: 'Enforcer',
            refits: Array.from({ length: 4 }, () => ({})) as unknown as Ship['refits'],
            secondPassiveSkillText: rec.passives[1],
            chargeSkillText: rec.charge,
            chargeSkillCharge: rec.chargeCharge,
        };
        const result = simulateBattle({
            playerTeam: [placement(vindicatorShip('v'), 'M4', { speed: 40 })],
            enemyTeam: [
                placement(enforcer, 'M4', {
                    // crit 100 so EVERY sub-attack crits and therefore inflicts; hacking 0 so every
                    // inflicted Defense Shred is resisted by a drawn-and-failed roll.
                    crit: 100,
                    hacking: 0,
                }),
            ],
            rounds: 1,
        });
        const round1 = result.combatLog.find((r) => r.round === 1)!;

        // THE INSTRUMENT: several resists, from ONE turn of ONE enemy. If Enforcer's kit ever
        // stops crit-inflicting, this drops to 0/1 and the arm fails rather than quietly asserting
        // the collapsed behaviour.
        const resists = flattenRound(round1).filter((e) => e.kind === 'debuff-resisted').length;
        expect(resists).toBeGreaterThan(1);
        // One retaliation per resisted sub-attack, each a flat 30% of max HP.
        const amounts = procDamage(result, 1, 'attacker');
        expect(amounts).toHaveLength(resists);
        for (const amount of amounts) expect(amount).toBeCloseTo(ONE_PROC, 0);
    });

    it('procs ONCE on a single-hit cast (the baseline both arms are measured against)', () => {
        const result = runVsEnemyCasting(
            'This Unit Inflicts <unit-skill>Speed Down II</unit-skill> for 2 turns.'
        );
        expect(procDamage(result, 1, 'attacker')).toHaveLength(1);
    });
});
