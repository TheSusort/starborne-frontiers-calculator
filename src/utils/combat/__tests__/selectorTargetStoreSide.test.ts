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
 *   CONTROL  — target:'enemy', trigger:'on-cast' → lands in the ANCHOR's enemy store. This arm is
 *              the INSTRUMENT VALIDATION. If it is empty, a null in SELECTOR measures nothing but
 *              the probe's own wiring (this is exactly how #398's first probe went blind).
 *   SELECTOR — byte-identical payload, target:'enemy-highest-attack', trigger:'on-cast' → lands on
 *              the CASTER's SELF store and is ABSENT from both enemies' stores. The defect,
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
 * STORE-SIDE behaviour instead of the broken one. The pre-fix reading above is left intact — it is
 * the only record that the defect was real.
 *
 * #399 final-review Finding 3: the original SELECTOR arm seeded exactly ONE enemy, so "landed on
 * the selector's resolved victim" and "landed on the cast anchor" were the same actor — the arm
 * could not tell the store-side fix apart from a fully-correct recipient resolution. The roster
 * below adds a SECOND enemy with a much higher attack than the cast anchor, so the two questions
 * come apart. Measured result: the debuff still lands on the ANCHOR (`ANCHOR_ID`), never on the
 * true highest-attack enemy (`HIGH_ATTACK_ID`) — `resolveDebuffRecipientIds`
 * (`debuffRecipients.ts`) has no arm for the three selector targets, so it falls to the tail
 * `[anchorId]`. #403 closed the RECIPIENT axis: `resolveDebuffRecipientIds` now resolves the three
 * selector targets through engine.ts's `selectorEnemyIdFor` delegate, so the SELECTOR arm below
 * asserts the true highest-attack enemy (`HIGH_ATTACK_ID`) and the ABSENCE of the mark from the
 * anchor. The pre-#403 reading — the mark on `ANCHOR_ID`, never on the real selector victim — is
 * left recorded above because it is the only evidence that defect existed. The CONTROL arm is
 * unchanged and is still the instrument validation: `target:'enemy'` must keep landing on the
 * anchor. If CONTROL ever moves, this file is measuring its own wiring, not the engine.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { StatusEngine } from '../statusEngine';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import type { Ship } from '../../../types/ship';

const CASTER_ID = 'attacker';
// The cast ANCHOR: `normalizeCombatRoster` places `enemyAttackers[0]` on the front slot
// (DEFAULT_ENEMY_SLOT) and every actor's target defaults to DEFAULT_FRONT_ENEMY_TARGET, so the
// FIRST enemy in the roster array is always the one a non-positional single-target cast resolves
// against. Empirically confirmed (see the #399 final-review notes): with a second, later-indexed
// enemy present, `target:'enemy'` still lands on this one.
const ANCHOR_ID = 'e-anchor';
// A SECOND enemy, listed after the anchor and given a far higher attack, so
// `enemy-highest-attack` names a specific, different actor than the one the cast would otherwise
// hit. Deliberately NOT the anchor — see the header comment's Finding 3 note.
const HIGH_ATTACK_ID = 'e-high-attack';

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
    anchorEnemyStore: string[];
    highAttackEnemyStore: string[];
    casterSelfStore: string[];
}

interface ProbeEnemy {
    id: string;
    attack: number;
}

/** The focus casts the debuff under test from its ACTIVE slot. Field-for-field the minimal
 *  `runCombat` input from `enemyChargeRemoval.integration.test.ts:118-145`, with the healing-mode
 *  keys dropped (`mode` is optional — `engine.ts:1398`) and `numRounds` cut to 2: this probe reads
 *  a store, not an outcome. Speed 100 vs every enemy's 10 so the caster acts first, every round. */
function runProbe(casterSkills: ShipSkills, enemies: ProbeEnemy[]): Stores {
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
        enemyAttackers: enemies.map((e) => ({
            id: e.id,
            stats: { attack: e.attack, crit: 0, critDamage: 0, speed: 10 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: skills([]),
        })),
        __testTapStatusEngine: (e) => {
            statusEngine = e;
        },
    };

    runCombat(input);

    const storeFor = (victimId: string): string[] =>
        statusEngine!
            .timedAbilityStatuses('enemy', undefined, victimId)
            .map((s) => s.payload.buffName);

    return {
        anchorEnemyStore: storeFor(ANCHOR_ID),
        highAttackEnemyStore: storeFor(HIGH_ATTACK_ID),
        casterSelfStore: statusEngine!
            .timedAbilityStatuses('self', CASTER_ID)
            .map((s) => s.payload.buffName),
    };
}

/** The two-enemy Doomsayer-style board: the ANCHOR (low attack, resolved first by the cast's
 *  default front-target) and a second, far-higher-attack enemy that `enemy-highest-attack` must
 *  name if recipient resolution were selector-aware. */
const twoEnemyBoard = (): ProbeEnemy[] => [
    { id: ANCHOR_ID, attack: 100 },
    { id: HIGH_ATTACK_ID, attack: 9000 },
];

describe('#399 reachability — selector targets and the status store side', () => {
    it('CONTROL: target:enemy on-cast debuff lands in the ANCHOR enemy store (instrument is live)', () => {
        const stores = runProbe(skills([debuffAbility('enemy')]), twoEnemyBoard());
        // INSTRUMENT VALIDATION. Every assertion below is meaningless without this.
        expect(stores.anchorEnemyStore).toContain('Probe Mark');
        expect(stores.highAttackEnemyStore).not.toContain('Probe Mark');
        expect(stores.casterSelfStore).not.toContain('Probe Mark');
    });

    it('SELECTOR: target:enemy-highest-attack on-cast debuff lands on the HIGHEST-ATTACK enemy', () => {
        const stores = runProbe(skills([debuffAbility('enemy-highest-attack')]), twoEnemyBoard());
        // STORE axis (#399 Task 2): on an enemy store, never the caster's own self store.
        expect(stores.casterSelfStore).not.toContain('Probe Mark');
        // RECIPIENT axis (#403): the selector's victim, NOT the cast anchor. Before #403 this
        // asserted the opposite — `resolveDebuffRecipientIds` had no selector arm and fell to its
        // tail `[anchorId]`, so the mark sat on the front-most enemy while the 9,000-attack ship
        // behind it went untouched.
        expect(stores.highAttackEnemyStore).toContain('Probe Mark');
        expect(stores.anchorEnemyStore).not.toContain('Probe Mark');
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

// #399 review Finding 5: throw when the CSV is absent rather than `describe.skipIf`-vanishing —
// there is no CI test workflow here, husky is the only gate, and a silently skipped describe block
// is not a pass. Matches `chargeTargetSideWidening.test.ts`'s `requireCsv` convention so the two
// files added by this branch agree on CSV-absence policy.
function requireCsv(): void {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing from this worktree (gitignored reference data) — it is ' +
                "the parser's source of truth and this Selenite arm cannot run without it."
        );
    }
}

describe('#399 — the real Selenite kit', () => {
    beforeAll(requireCsv);

    it("Concentrate Fire reaches the enemy store: the issue's stated symptom does NOT reproduce", () => {
        // Selenite's CF is resolved through the REACTIVE intent path (triggers.ts:3832), which
        // already carries its own live selector resolution — unlike the hand-authored SELECTOR arm
        // above, this real kit correctly lands on the true highest-attack enemy. Single-enemy
        // roster is sufficient here: this arm asks "does CF reach the enemy store at all", not
        // "which of several enemies does it pick".
        const stores = runProbe(buildShipAbilities(shipFromCsv('Selenite')), [
            { id: ANCHOR_ID, attack: 100 },
        ]);
        expect(stores.anchorEnemyStore).toContain('Concentrate Fire');
        expect(stores.casterSelfStore).not.toContain('Concentrate Fire');
    });
});
