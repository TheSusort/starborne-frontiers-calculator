/**
 * #434 Task 1 — `reactive-heal-performed` carries the per-target clipped excess and the id of
 * the ability that produced it.
 *
 * The overheal figure is what an `overheal`-basis reaction (Abundant Renewal, and #435's
 * redirect) scales from; without it the event cannot drive one. `sourceAbilityId` is the
 * re-entrancy guard's key — see the termination proof at the listener in Task 2.
 *
 * ⚠️ `sourceAbilityId` is an in-memory routing key. It must never reach a golden or a
 * combat-log row: `nextId()` runs off a module-level counter that is never reset, so the same
 * ability gets a different id depending on how many kits were built before it.
 */
import { describe, it, expect } from 'vitest';
import {
    executeIntent,
    Intent,
    IntentExecContext,
    ReactiveAbility,
    registerReactiveListeners,
} from '../triggers';
import { createEventBus, CombatEvent } from '../events';
import { createStatusEngine } from '../statusEngine';
import type { CombatActor } from '../state';
import type { Ability } from '../../../types/abilities';

const OWNER_ID = 'medic';
const ALLY_ID = 'ally';
const MAX_HP = 50_000;

// A reactive ally repair. `raw` will be 10% of 50,000 = 5,000; the harness clips 4,000 of it.
const reactiveAllyRepair = (): Ability => ({
    id: 'ab-repair',
    type: 'heal',
    target: 'ally',
    trigger: 'start-of-round',
    conditions: [],
    config: { type: 'heal', pct: 10, basis: 'hp' },
});

function runReactiveRepair(): Extract<CombatEvent, { type: 'reactive-heal-performed' }>[] {
    const bus = createEventBus();
    const emitted: Extract<CombatEvent, { type: 'reactive-heal-performed' }>[] = [];
    bus.on('reactive-heal-performed', (e) => emitted.push(e));

    const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    const healing = {
        targetId: ALLY_ID,
        credit: () => {},
        creditRecipient: () => {},
        creditPerformed: () => {},
        perRecipientApply: true,
        // 5,000 raw arrives; 1,000 is consumed and 4,000 is clipped.
        applyHealToTarget: () => ({ reversed: false as const, consumed: 1_000, overheal: 4_000 }),
        grantShieldToTarget: () => ({ applied: 0, overshield: 0 }),
        recipientMaxHp: () => MAX_HP,
        recipientIncomingHealPct: () => 0,
        recipientActor: (id: string) =>
            id === ALLY_ID ? ({ id: ALLY_ID } as unknown as CombatActor) : undefined,
    } as unknown as IntentExecContext['healing'];

    const intent: Intent = {
        ownerId: OWNER_ID,
        ability: reactiveAllyRepair(),
        sourceSlot: 'passive',
    } as unknown as Intent;

    const ctx = {
        bus,
        round: 1,
        statusEngine: se,
        healing,
        // The brief's harness (mirroring `reactiveOverhealShield.test.ts`'s `makeShieldCtx`) omits
        // these, but `executeIntent` dereferences them unconditionally in `buildDrainContext`
        // (corrosion/inferno/bomb counts) and in the heal branch (`lastTurnCtxByActor.get`) before
        // ever reaching the heal config — an empty/absent value here throws, not fails an
        // assertion. Copied across from `makeShieldCtx` rather than loosening the cast further.
        corrosionEntries: [],
        infernoEntries: [],
        pendingBombs: [],
        lastTurnCtxByActor: new Map(),
        // The owner's own runtime entry: `executeIntent` throws if `runtimes.get(ownerId)` misses,
        // and the heal fold reads `owner.actor.destroyedRound`, `owner.hp` (the 'hp'-basis fallback
        // this ability's config uses), and `owner.healModifier`.
        runtimes: new Map([
            [
                OWNER_ID,
                {
                    actor: { id: OWNER_ID, currentHp: MAX_HP } as unknown as CombatActor,
                    attack: 0,
                    defence: 0,
                    hp: MAX_HP,
                    healModifier: 0,
                } as never,
            ],
        ]),
        playerIds: [OWNER_ID, ALLY_ID],
        lowestHpAllyIdFor: () => ALLY_ID,
    } as unknown as IntentExecContext;

    executeIntent(intent, ctx);
    return emitted;
}

describe('#434 Task 1 — reactive-heal-performed payload', () => {
    it('carries the per-target clipped excess', () => {
        const [e] = runReactiveRepair();
        expect(e).toBeDefined();
        expect(e.perTarget).toEqual([{ targetId: ALLY_ID, amount: 5_000, overheal: 4_000 }]);
    });

    it('stamps the id of the ability that produced it', () => {
        const [e] = runReactiveRepair();
        expect(e.sourceAbilityId).toBe('ab-repair');
    });
});

const FONT_OF_POWER_ID = 'ab-font-of-power';
const REDIRECT_ID = 'ab-redirect';

// Font of Power's shape: a buff grant on the trigger. Stands in for "any observer that is not
// the producing ability".
const fontOfPower = (): Ability => ({
    id: FONT_OF_POWER_ID,
    type: 'buff',
    target: 'ally',
    trigger: 'on-own-repair-to-ally',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Power Infused Nanobots',
        duration: 1,
        stacks: 1,
        isStackable: false,
        parsedEffects: {},
    },
});

// #435's redirect shape: a heal on the same trigger. This is the ability that must not observe
// its OWN output.
const redirect = (): Ability => ({
    id: REDIRECT_ID,
    type: 'heal',
    target: 'lowest-hp-ally',
    trigger: 'on-own-repair-to-ally',
    conditions: [],
    config: { type: 'heal', pct: 100, basis: 'overheal' },
});

function captureIntentsForReactiveRepair(args: {
    abilities: Ability[];
    sourceAbilityId: string;
    ownerId?: string;
}): Intent[] {
    const ownerId = args.ownerId ?? OWNER_ID;
    const bus = createEventBus();
    const intents: Intent[] = [];
    registerReactiveListeners({
        bus,
        perOwner: [
            {
                ownerId,
                reactiveAbilities: args.abilities.map((ability): ReactiveAbility => ({
                    ability,
                    sourceSlot: 'passive',
                })),
            },
        ],
        enqueue: (i) => intents.push(i),
        isOpposing: (id) => id === 'enemy',
    });
    bus.emit({
        type: 'reactive-heal-performed',
        casterId: ownerId,
        round: 1,
        amount: 5_000,
        perTarget: [{ targetId: ALLY_ID, amount: 5_000, overheal: 4_000 }],
        sourceAbilityId: args.sourceAbilityId,
    });
    return intents;
}

describe('#434 Task 2 — on-own-repair-to-ally sees reactive repairs', () => {
    it('enqueues off a reactive repair, stamping the same eventCtx keys as the cast path', () => {
        const intents = captureIntentsForReactiveRepair({
            abilities: [fontOfPower()],
            sourceAbilityId: 'ab-some-passive-repair',
        });
        expect(intents).toHaveLength(1);
        expect(intents[0].eventCtx?.repairedAllyIds).toEqual([ALLY_ID]);
        expect(intents[0].eventCtx?.overhealAmount).toBe(4_000);
        expect(intents[0].eventCtx?.overhealByAlly).toEqual({ [ALLY_ID]: 4_000 });
    });

    it('ignores a reactive repair with no non-self recipient', () => {
        const bus = createEventBus();
        const intents: Intent[] = [];
        registerReactiveListeners({
            bus,
            perOwner: [
                {
                    ownerId: OWNER_ID,
                    reactiveAbilities: [{ ability: fontOfPower(), sourceSlot: 'passive' }],
                },
            ],
            enqueue: (i) => intents.push(i),
            isOpposing: (id) => id === 'enemy',
        });
        bus.emit({
            type: 'reactive-heal-performed',
            casterId: OWNER_ID,
            round: 1,
            amount: 5_000,
            perTarget: [{ targetId: OWNER_ID, amount: 5_000, overheal: 4_000 }],
            sourceAbilityId: 'ab-self-repair',
        });
        expect(intents).toHaveLength(0);
    });

    it('ignores a reactive repair performed by someone else', () => {
        const bus = createEventBus();
        const intents: Intent[] = [];
        registerReactiveListeners({
            bus,
            perOwner: [
                {
                    ownerId: OWNER_ID,
                    reactiveAbilities: [{ ability: fontOfPower(), sourceSlot: 'passive' }],
                },
            ],
            enqueue: (i) => intents.push(i),
            isOpposing: (id) => id === 'enemy',
        });
        bus.emit({
            type: 'reactive-heal-performed',
            casterId: 'someone-else',
            round: 1,
            amount: 5_000,
            perTarget: [{ targetId: ALLY_ID, amount: 5_000, overheal: 4_000 }],
            sourceAbilityId: 'ab-their-repair',
        });
        expect(intents).toHaveLength(0);
    });
});

describe('#434 Task 2 — the self-exclusion guard (R-B)', () => {
    // POSITIVE ARM: everything that is not the producing ability still observes the repair.
    it('lets a DIFFERENT ability observe a repair the redirect produced', () => {
        const intents = captureIntentsForReactiveRepair({
            abilities: [fontOfPower(), redirect()],
            sourceAbilityId: REDIRECT_ID,
        });
        const ids = intents.map((i) => i.ability.id);
        expect(ids).toContain(FONT_OF_POWER_ID);
    });

    // NEGATIVE ARM: the producing ability does not observe its own output. Without this arm the
    // test passes under a missing guard.
    it('does NOT let the redirect observe its own output', () => {
        const intents = captureIntentsForReactiveRepair({
            abilities: [fontOfPower(), redirect()],
            sourceAbilityId: REDIRECT_ID,
        });
        const ids = intents.map((i) => i.ability.id);
        expect(ids).not.toContain(REDIRECT_ID);
    });

    it('still lets the redirect observe a repair some OTHER ability produced', () => {
        const intents = captureIntentsForReactiveRepair({
            abilities: [redirect()],
            sourceAbilityId: 'ab-start-of-round-repair',
        });
        expect(intents.map((i) => i.ability.id)).toEqual([REDIRECT_ID]);
    });

    // Team symmetry: the guard is self-scoped, so an enemy-side owner behaves identically.
    it('behaves identically for an enemy-side owner', () => {
        const intents = captureIntentsForReactiveRepair({
            abilities: [fontOfPower(), redirect()],
            sourceAbilityId: REDIRECT_ID,
            ownerId: 'enemy-medic',
        });
        expect(intents.map((i) => i.ability.id)).toEqual([FONT_OF_POWER_ID]);
    });
});
