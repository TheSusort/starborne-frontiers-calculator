import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
    foldActorBuffTotals,
    effectiveOutgoingStatsOf,
    effectiveDamageStatsOf,
} from '../effectiveStats';
import { victimSelfBuffs } from '../triggers';
import { createStatusEngine, RegisteredAbilityStatus, StatusEngine } from '../statusEngine';
import { SelectedGameBuff } from '../../../types/calculator';
import { CombatActor } from '../state';
import { calculateBuffTotals } from '../buffTotals';
import { toSimBuffs } from '../../calculators/dpsBuffHelpers';
import type { ConditionContext } from '../../abilities/evaluateConditions';
import type { Ability } from '../../../types/abilities';
import { runCombat, type CombatEngineInput, type TeamActorEngineInput } from '../engine';
import { parsePattern, parseTarget } from '../../targetingParser';
import { bareEnemy } from '../__testutils__/bareRosterFixture';
import { dealtBy } from '../__testutils__/perTargetDealt';

const sel = (
    id: string,
    buffName: string,
    parsedEffects: SelectedGameBuff['parsedEffects']
): SelectedGameBuff => ({ id, buffName, stacks: 1, parsedEffects, isStackable: false });

const timedStatus = (
    buffName: string,
    parsedEffects: SelectedGameBuff['parsedEffects'],
    duration = 5
): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
    payload: { buffName, stacks: 1, parsedEffects },
    side: 'self',
    sourceSlot: 'active',
    duration,
    conditions: [],
    kind: 'timed',
});

function actor(): CombatActor {
    return {
        id: 'attacker',
        side: 'player',
        kind: 'attacker',
        stats: {
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            shieldPenetration: 0,
            defence: 1000,
            hp: 10000,
            speed: 100,
            hacking: 0,
            security: 0,
        },
        currentHp: 10000,
        shieldPool: 0,
        turnMeter: 0,
        charges: 0,
        chargeCount: 0,
        corrosionEntries: [],
        infernoEntries: [],
        genericDoTEntries: [],
        pendingBombs: [],
        pendingAccumulators: [],
        turnsTaken: 0,
        chargeLossImmune: false,
    };
}

/** Engine with the given names scheduled on the attacker plus the given timed self statuses live. */
function engineWith(
    scheduled: SelectedGameBuff[],
    timed: Array<Extract<RegisteredAbilityStatus, { kind: 'timed' }>>
): StatusEngine {
    const eng = createStatusEngine({ selfBuffs: scheduled, enemyDebuffs: [] });
    if (timed.length > 0) eng.registerAbilityStatuses(timed, 'attacker');
    eng.beginRound(1);
    for (const t of timed) eng.applyTimedAbilityStatus(1, t, 'attacker');
    return eng;
}

describe('own buff families count once', () => {
    it('scheduled twice inside layer 1', () => {
        const entries = [
            sel('a1', 'Attack Up III', { attack: 45 }),
            sel('a2', 'Attack Up III', { attack: 45 }),
        ];
        const eng = engineWith([entries[0]], []);
        const lookup = new Map([['Attack Up III', entries]]);
        expect(foldActorBuffTotals(eng, lookup, 'attacker').attackBuff).toBe(45);
        expect(victimSelfBuffs(eng, 'attacker', lookup)).toHaveLength(1);
    });

    it('scheduled + timed of the same family', () => {
        const scheduled = sel('a1', 'Attack Up III', { attack: 45 });
        const eng = engineWith([scheduled], [timedStatus('Attack Up III', { attack: 45 })]);
        const lookup = new Map([['Attack Up III', [scheduled]]]);
        expect(foldActorBuffTotals(eng, lookup, 'attacker').attackBuff).toBe(45);
        expect(effectiveOutgoingStatsOf(eng, lookup, actor(), []).attack).toBeCloseTo(1000 * 1.45);
    });

    it('every channel: defence, speed and the victim fold', () => {
        const d = sel('d1', 'Defense Up III', { defense: 45 });
        const s = sel('s1', 'Speed Up II', { speed: 30 });
        const eng = engineWith(
            [d, s],
            [
                timedStatus('Defense Up III', { defense: 45 }),
                timedStatus('Speed Up II', { speed: 30 }),
            ]
        );
        const lookup = new Map([
            ['Defense Up III', [d]],
            ['Speed Up II', [s]],
        ]);
        const totals = foldActorBuffTotals(eng, lookup, 'attacker');
        expect(totals.defenceBuff).toBe(45);
        expect(totals.speedBuff).toBe(30);
        expect(
            calculateBuffTotals(toSimBuffs(victimSelfBuffs(eng, 'attacker', lookup))).defenceBuff
        ).toBe(45);
    });
});

const ctx: ConditionContext = {
    selfBuffNames: [],
    selfDebuffNames: [],
    enemyBuffNames: [],
    enemyDebuffCount: 0,
    effectiveCritRate: 0,
    adjacentAllyCount: 0,
    enemyAdjacentCount: 0,
    enemyDestroyedCount: 0,
    selfHpPct: 100,
    enemyHpPct: 100,
};
const base = {
    attack: 1000,
    defence: 1000,
    crit: 0,
    critDamage: 150,
    hp: 10000,
    security: 0,
    defensePenetration: 0,
    castPenBonus: 0,
};
const noExtras = calculateBuffTotals([]);

describe('effectiveDamageStatsOf — one instance per family (#667)', () => {
    it('manual Attack Up III + kit Attack Up III folds +45, not +90', () => {
        const dmg = effectiveDamageStatsOf({
            base,
            selfNamedBuffs: [
                sel('m', 'Attack Up III', { attack: 45 }),
                sel('k', 'Attack Up III', { attack: 45 }),
            ],
            extras: noExtras,
            modifierAbilities: [],
            modifierCtx: ctx,
        });
        expect(dmg.attack).toBe(1450);
    });

    it('crit, crit power, outgoing and pen families dedupe too', () => {
        const twice = (n: string, e: SelectedGameBuff['parsedEffects']) => [
            sel(`${n}1`, n, e),
            sel(`${n}2`, n, e),
        ];
        const dmg = effectiveDamageStatsOf({
            base,
            selfNamedBuffs: [
                ...twice('Crit Rate Up II', { crit: 20 }),
                ...twice('Crit Power Up II', { critDamage: 30 }),
                ...twice('Out. Damage Up II', { outgoingDamage: 20 }),
                ...twice('Defense Penetration Up I', { defensePenetration: 10 }),
            ],
            extras: noExtras,
            modifierAbilities: [],
            modifierCtx: ctx,
        });
        expect(dmg.crit).toBe(20);
        expect(dmg.critDamage).toBe(180);
        expect(dmg.totals.outgoingDamageBuff).toBe(20);
        expect(dmg.effectivePen).toBe(10);
    });

    it('extras add on top, unreduced', () => {
        const extras = { ...calculateBuffTotals([]), outgoingDamageBuff: 15, attackBuff: -10 };
        const dmg = effectiveDamageStatsOf({
            base,
            selfNamedBuffs: [sel('a', 'Attack Up III', { attack: 45 })],
            extras,
            modifierAbilities: [],
            modifierCtx: ctx,
        });
        expect(dmg.attack).toBe(1350);
        expect(dmg.totals.outgoingDamageBuff).toBe(15);
    });
});

describe('turn loop — a family held via the schedule AND an ability status folds once (#667)', () => {
    const HP = 10_000_000;
    const ENEMY_DEFENSE = 3000;
    const attackUp = (): SelectedGameBuff => sel('manual-atk', 'Attack Up III', { attack: 45 });
    const dmgAbility = (): Ability => ({
        id: 'dmg',
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier: 100 },
    });
    const kitAttackUp = (): Ability => ({
        id: 'kit-atk',
        type: 'buff',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: {
            type: 'buff',
            buffName: 'Attack Up III',
            parsedEffects: { attack: 45 },
            stacks: 1,
            isStackable: false,
            duration: 3,
        },
    });
    const run = (opts: { scheduled: boolean; kit: boolean }) =>
        runCombat({
            enemyAttackers: bareEnemy({ stats: { hp: HP, defence: ENEMY_DEFENSE } }),
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 99,
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: opts.kit ? [kitAttackUp(), dmgAbility()] : [dmgAbility()],
                    },
                ],
            },
            numRounds: 2,
            selfBuffs: opts.scheduled ? [attackUp()] : [],
            enemyDebuffs: [],
            hasChargedSkill: false,
            startCharged: false,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            defence: 0,
            hp: HP,
            speed: 100,
        });
    const dealtPerRound = (r: ReturnType<typeof runCombat>) =>
        r.rounds.map((round) => dealtBy([round], 'attacker'));

    it('scheduled + kit equals the single-copy runs, every round', () => {
        const both = dealtPerRound(run({ scheduled: true, kit: true }));
        const kitOnly = dealtPerRound(run({ scheduled: false, kit: true }));
        const scheduledOnly = dealtPerRound(run({ scheduled: true, kit: false }));
        const none = dealtPerRound(run({ scheduled: false, kit: false }));

        // Vacuity guard: the kit status is live on the round-2 cast, so a missing fold would
        // equal the unbuffed run.
        expect(kitOnly[1]).toBeGreaterThan(none[1]);
        expect(scheduledOnly[1]).toBeGreaterThan(none[1]);
        expect(both).toEqual(scheduledOnly);
        expect(both[1]).toBe(kitOnly[1]);
    });
});

describe('turn loop — own duplicate family meets a stronger enemy-applied tier (#667)', () => {
    // The focus holds `Attack Down I` twice (scheduled + its own passive-slot status) and the
    // enemy applies `Attack Down III` before the focus's first turn. One own instance per family
    // means the shadowing comparison and the fold read the same list, so the turn lands on
    // exactly the applied -45: not -30 (the delta computed against the unreduced own sum), and
    // not -60 (additive).
    const HP = 10_000_000;
    const AD1 = { attack: -15 };
    const AD3 = { attack: -45 };
    const dmgAbility = (): Ability => ({
        id: 'dmg',
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier: 100 },
    });
    const selfGrant = (): Ability => ({
        id: 'kit-ad1',
        type: 'buff',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: {
            type: 'buff',
            buffName: 'Attack Down I',
            parsedEffects: AD1,
            stacks: 1,
            isStackable: false,
            duration: 10,
        },
    });
    const enemyCast = (buffName: string, parsedEffects: SelectedGameBuff['parsedEffects']) =>
        ({
            id: `cast-${buffName}`,
            type: 'debuff',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'debuff',
                buffName,
                parsedEffects,
                stacks: 1,
                isStackable: false,
                duration: 10,
                application: 'apply',
            },
        }) as Ability;

    const run = (opts: { scheduled: boolean; kit: boolean; applied: boolean }) => {
        let statusEngine: StatusEngine | undefined;
        const r = runCombat({
            numRounds: 2,
            selfBuffs: opts.scheduled ? [sel('manual-ad1', 'Attack Down I', AD1)] : [],
            enemyDebuffs: [],
            hasChargedSkill: false,
            startCharged: false,
            defensePenetration: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            chargeCount: 0,
            target: parseTarget('front'),
            pattern: parsePattern('Pattern-Base'),
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: HP,
            speed: 100,
            position: 'M1',
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [dmgAbility()] },
                    ...(opts.kit ? [{ slot: 'passive' as const, abilities: [selfGrant()] }] : []),
                ],
            },
            enemyAttackers: [
                {
                    id: 'applier',
                    stats: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: HP,
                        speed: 950,
                        hacking: 100_000,
                        security: 0,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: 'M1',
                    target: parseTarget('front'),
                    pattern: parsePattern('Pattern-Base'),
                    shipSkills: {
                        slots: [
                            {
                                slot: 'active',
                                abilities: [
                                    opts.applied
                                        ? enemyCast('Attack Down III', AD3)
                                        : enemyCast('Inert Marker', {}),
                                ],
                            },
                        ],
                    },
                },
            ],
            __testTapStatusEngine: (e) => {
                statusEngine = e;
            },
        });
        return {
            dealt: r.rounds.map((round) => dealtBy([round], 'attacker')),
            enemyStore: statusEngine!
                .timedAbilityStatuses('enemy', undefined, 'attacker')
                .map((s) => s.payload.buffName),
        };
    };

    it('scheduled + kit Attack Down I under an applied Attack Down III folds to exactly -45', () => {
        const both = run({ scheduled: true, kit: true, applied: true });
        const single = run({ scheduled: true, kit: false, applied: true });
        const appliedOnly = run({ scheduled: false, kit: false, applied: true });
        const ownOnly = run({ scheduled: true, kit: true, applied: false });
        const clean = run({ scheduled: false, kit: false, applied: false });

        // The payload really sits in the focus's own enemy store.
        expect(both.enemyStore).toContain('Attack Down III');
        expect(ownOnly.enemyStore).not.toContain('Attack Down III');
        // Instrument: the own instance (-15) and the applied tier (-45) each move the number.
        expect(ownOnly.dealt[0]).toBeLessThan(clean.dealt[0]);
        expect(appliedOnly.dealt[0]).toBeLessThan(ownOnly.dealt[0]);

        expect(both.dealt).toEqual(single.dealt);
        expect(both.dealt).toEqual(appliedOnly.dealt);
        // Exactly -45 on the attack channel: damage is linear in attack here (0 defence, no crit).
        for (let i = 0; i < clean.dealt.length; i++) {
            expect(both.dealt[i] / clean.dealt[i]).toBeCloseTo(0.55, 6);
        }
    });
});

describe('status mode — own duplicate family meets a stronger enemy-applied tier (#667)', () => {
    const SD1 = { speed: -20 };
    const SD2 = { speed: -50 };

    const fold = (applied: boolean) => {
        const scheduled = sel('manual-sd1', 'Speed Down I', SD1);
        const eng = engineWith([scheduled], [timedStatus('Speed Down I', SD1)]);
        if (applied) {
            const enemyStatus: Extract<RegisteredAbilityStatus, { kind: 'timed' }> = {
                ...timedStatus('Speed Down II', SD2),
                side: 'enemy',
            };
            eng.registerAbilityStatuses([enemyStatus], 'applier', 'attacker');
            eng.applyTimedAbilityStatus(1, enemyStatus, undefined, 'attacker');
            expect(
                eng
                    .timedAbilityStatuses('enemy', undefined, 'attacker')
                    .map((s) => s.payload.buffName)
            ).toContain('Speed Down II');
        }
        const lookup = new Map([['Speed Down I', [scheduled]]]);
        return foldActorBuffTotals(eng, lookup, 'attacker').speedBuff;
    };

    it('scheduled + timed Speed Down I fold once, and an applied Speed Down II lands on -50', () => {
        expect(fold(true)).toBe(-50);
        // The no-enemy arm is the one that sees an unreduced own list: with the applied tier
        // standing, `shadowedDelta` subtracts the own `sum`, so -40 + -10 still lands on -50.
        expect(fold(false)).toBe(-20);
    });
});

describe('engine lookup — two carriers of one scheduled family expand to one instance (#667)', () => {
    // The engine's `selfBuffLookup` merges the focus's and every team actor's `selfBuffs` by
    // name, so a family scheduled on both expands to two entries for the focus. The turn loop
    // reduces that expansion, and `effectiveDamageStatsOf` reduces its input again, so this
    // pins the end-to-end result rather than any one reduction.
    const HP = 10_000_000;
    const attackUp = (id: string) => sel(id, 'Attack Up III', { attack: 45 });
    const ally = (selfBuffs: SelectedGameBuff[]): TeamActorEngineInput => ({
        id: 'ally',
        speed: 50,
        chargeCount: 0,
        startCharged: false,
        selfBuffs,
        enemyDebuffs: [],
        position: 'M4',
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        walk: {
            shipSkills: { slots: [] },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                security: 0,
                defence: 0,
                hp: HP,
            },
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });
    const run = (focusBuffs: SelectedGameBuff[], allyBuffs: SelectedGameBuff[]) => {
        const input: CombatEngineInput = {
            numRounds: 2,
            selfBuffs: focusBuffs,
            enemyDebuffs: [],
            hasChargedSkill: false,
            startCharged: false,
            defensePenetration: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            chargeCount: 0,
            target: parseTarget('front'),
            pattern: parsePattern('Pattern-Base'),
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: HP,
            speed: 100,
            position: 'M1',
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'dmg',
                                type: 'damage',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'damage', multiplier: 100 },
                            },
                        ],
                    },
                ],
            },
            teamActors: [ally(allyBuffs)],
            enemyAttackers: bareEnemy({
                position: 'M1',
                stats: { hp: HP },
            }),
        };
        const r = runCombat(input);
        return r.rounds.map((round) => dealtBy([round], 'attacker'));
    };

    it('focus damage with the family on focus AND ally equals the focus-only run', () => {
        const none = run([], []);
        const focusOnly = run([attackUp('f')], []);
        const both = run([attackUp('f')], [attackUp('a')]);
        expect(focusOnly[0]).toBeGreaterThan(none[0]);
        expect(both).toEqual(focusOnly);
        expect(both[0] / none[0]).toBeCloseTo(1.45, 6);
    });
});

describe('own-side folds go through strongestPerFamily (source tripwire)', () => {
    const combatDir = join(__dirname, '..');
    const read = (file: string) => readFileSync(join(combatDir, file), 'utf8');

    /** Source from `start` to the next top-level closing brace (`\n}\n`). */
    const bodyFrom = (source: string, start: string): string => {
        const at = source.indexOf(start);
        expect(at, `${start} not found`).toBeGreaterThanOrEqual(0);
        const end = source.indexOf('\n}\n', at);
        return source.slice(at, end === -1 ? undefined : end);
    };

    it('effectiveDamageStatsOf reduces the named own buffs', () => {
        const body = bodyFrom(read('effectiveStats.ts'), 'export function effectiveDamageStatsOf(');
        expect(body).toContain('strongestPerFamily(selfNamedBuffs)');
    });

    it('victimSelfBuffs returns the reduced own buffs', () => {
        const body = bodyFrom(read('triggers.ts'), 'export function victimSelfBuffs(');
        expect(body).toContain('strongestPerFamily(');
    });

    it('allSelfSourced reduces the own-source lists', () => {
        const source = read('effectiveStats.ts');
        const at = source.indexOf('const allSelfSourced');
        expect(at).toBeGreaterThanOrEqual(0);
        expect(source.slice(at, source.indexOf(';\n', at))).toContain('strongestPerFamily(');
    });

    it('the turn loop reduces scheduled and combined own buffs', () => {
        const source = read('playerTurn.ts');
        expect(source).toMatch(
            /const selfNamedBuffs = strongestPerFamily\(\[\s*\.\.\.scheduledSelfBuffs,\s*\.\.\.abilitySelfEffects\s*\]\)/
        );
        expect(source).toMatch(/strongestPerFamily\(\s*expandScheduledSelfBuffs\(/);
    });

    it('no combat module folds a spread of own lists straight through calculateBuffTotals', () => {
        const offenders = readdirSync(combatDir)
            .filter((f) => /\.tsx?$/.test(f) && f !== 'buffTotals.ts')
            .filter((f) => /calculateBuffTotals\(\s*toSimBuffs\(\s*\[/.test(read(f)));
        expect(offenders).toEqual([]);
    });
});
