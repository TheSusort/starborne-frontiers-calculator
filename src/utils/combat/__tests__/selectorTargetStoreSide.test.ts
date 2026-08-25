/**
 * #399 — REACHABILITY MEASUREMENT for the store-axis classification at `engine.ts:284`.
 *
 * `registerActorAbilityStatuses` picks the store a buff/debuff status lands in from a hand-written
 * list of enemy-side targets. The three SELECTOR targets ('enemy-most-buffs',
 * 'enemy-highest-attack', 'enemy-highest-speed') are missing from it, so they fall through to
 * 'self' — the CASTER's own store, which no enemy-store reader ever consults.
 *
 * #399 claims this breaks Selenite's Concentrate Fire. PREDICTION, recorded before running:
 *
 *   CONTROL  — target:'enemy', trigger:'on-cast' → lands in the VICTIM's enemy store. This arm is
 *              the INSTRUMENT VALIDATION. If it is empty, a null in SELECTOR measures nothing but
 *              the probe's own wiring (this is exactly how #398's first probe went blind).
 *   SELECTOR — byte-identical payload, target:'enemy-highest-attack', trigger:'on-cast' → lands on
 *              the CASTER's SELF store and is ABSENT from the victim's enemy store. The defect,
 *              reproduced.
 *   SELENITE — the real kit through runCombat → Concentrate Fire IS present on the highest-attack
 *              enemy. The stated symptom does NOT reproduce, because Selenite's CF carries
 *              trigger:'start-of-round', which is in LIVE_TRIGGERS, so partitionReactiveAbilities
 *              pulls it out of castSkills before registerActorAbilityStatuses ever sees it. Its
 *              real route is the reactive intent path, which resolves the selector at
 *              triggers.ts:3832.
 *
 * The SELECTOR arm is only reachable by a HAND-AUTHORED ability: no corpus ship pairs a
 * buff/debuff config with a selector target and a non-live trigger, and AbilityCard.tsx's
 * TARGET_OPTIONS does not offer the selector targets to the editor either.
 *
 * Task 2 (#399) fixed the store-axis classification (`engine.ts` now reads the shared
 * `isEnemyTarget` from `abilityTargetSide.ts`), so the SELECTOR arm below now asserts the FIXED
 * behaviour instead of the broken one. The pre-fix reading above is left intact — it is the only
 * record that the defect was real.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { StatusEngine } from '../statusEngine';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import type { Ship } from '../../../types/ship';

const CASTER_ID = 'attacker';
const VICTIM_ID = 'e-victim';

/** A named debuff with NO parsedEffects: this probe asks WHERE the status lands, not what it does.
 *  `application: 'apply'` skips the landing roll, so a miss can never explain an empty store. */
const debuffAbility = (target: Ability['target']): Ability => ({
    id: `ab-${target}`,
    type: 'debuff',
    target,
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Probe Mark',
        duration: 5,
        stacks: 1,
        isStackable: false,
        application: 'apply',
        parsedEffects: {},
    },
});

const skills = (abilities: Ability[]): ShipSkills => ({
    slots: [{ slot: 'active', abilities }],
});

interface Stores {
    victimEnemyStore: string[];
    casterSelfStore: string[];
}

/** The focus casts the debuff under test from its ACTIVE slot. Field-for-field the minimal
 *  `runCombat` input from `enemyChargeRemoval.integration.test.ts:118-145`, with the healing-mode
 *  keys dropped (`mode` is optional — `engine.ts:1398`) and `numRounds` cut to 2: this probe reads
 *  a store, not an outcome. Speed 100 vs the victim's 10 so the caster acts first. */
function runProbe(casterSkills: ShipSkills): Stores {
    let statusEngine: StatusEngine | undefined;
    const input: CombatEngineInput = {
        attack: 1000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: casterSkills,
        numRounds: 2,
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
        enemyAttackers: [
            {
                id: VICTIM_ID,
                stats: { attack: 100, crit: 0, critDamage: 0, speed: 10 },
                chargeCount: 0,
                startCharged: false,
                shipSkills: skills([]),
            },
        ],
        __testTapStatusEngine: (e) => {
            statusEngine = e;
        },
    };

    runCombat(input);

    return {
        victimEnemyStore: statusEngine!
            .timedAbilityStatuses('enemy', undefined, VICTIM_ID)
            .map((s) => s.payload.buffName),
        casterSelfStore: statusEngine!
            .timedAbilityStatuses('self', CASTER_ID)
            .map((s) => s.payload.buffName),
    };
}

describe('#399 reachability — selector targets and the status store side', () => {
    it('CONTROL: target:enemy on-cast debuff lands in the VICTIM enemy store (instrument is live)', () => {
        const stores = runProbe(skills([debuffAbility('enemy')]));
        // INSTRUMENT VALIDATION. Every null below is meaningless without this.
        expect(stores.victimEnemyStore).toContain('Probe Mark');
        expect(stores.casterSelfStore).not.toContain('Probe Mark');
    });

    it('SELECTOR: target:enemy-highest-attack on-cast debuff lands in the VICTIM enemy store', () => {
        const stores = runProbe(skills([debuffAbility('enemy-highest-attack')]));
        expect(stores.victimEnemyStore).toContain('Probe Mark');
        expect(stores.casterSelfStore).not.toContain('Probe Mark');
    });
});

function shipFromCsv(name: string): Ship {
    const rec = loadShipSkillRecords().find((r) => r.name.toUpperCase() === name.toUpperCase());
    if (!rec) throw new Error(`docs/ship-skills.csv: no record for "${name}"`);
    return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}],
        activeSkillText: rec.active,
        chargeSkillText: rec.charge,
        chargeSkillCharge: rec.chargeCharge,
        firstPassiveSkillText: rec.passives[0],
        secondPassiveSkillText: rec.passives[1],
        thirdPassiveSkillText: rec.passives[2],
    } as Ship;
}

describe.skipIf(!csvAvailable())('#399 — the real Selenite kit', () => {
    it("Concentrate Fire reaches the enemy store: the issue's stated symptom does NOT reproduce", () => {
        const stores = runProbe(buildShipAbilities(shipFromCsv('Selenite')));
        expect(stores.victimEnemyStore).toContain('Concentrate Fire');
        expect(stores.casterSelfStore).not.toContain('Concentrate Fire');
    });
});
