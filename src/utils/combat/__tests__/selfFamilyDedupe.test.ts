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
import { runCombat } from '../engine';
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
        expect(effectiveOutgoingStatsOf(eng, lookup, actor()).attack).toBeCloseTo(1000 * 1.45);
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
