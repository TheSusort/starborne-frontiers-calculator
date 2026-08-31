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
    perTarget?: { targetId: string; amount: number; overheal?: number }[];
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
        perTarget: args.perTarget ?? [{ targetId: ALLY_ID, amount: 5_000, overheal: 4_000 }],
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
        expect(intents[0].eventCtx?.repairedRecipientIds).toEqual([ALLY_ID]);
        expect(intents[0].eventCtx?.overhealAmount).toBe(4_000);
        expect(intents[0].eventCtx?.overhealByRecipient).toEqual({ [ALLY_ID]: 4_000 });
    });

    // R-C, RE-RULED 2026-08-31. This case used to assert the opposite: that a caster's own
    // wasted repair was not an "ally over-repair" and had to be filtered out of the aggregate
    // (94515b6e). The owner ruled both consumers the other way — Chimei's redirect "is fed by all
    // heal targets, himself included", and a ship that over-repairs itself while healing the team
    // does earn Abundant Renewal's shield. So the caster's entry now reaches BOTH the aggregate
    // and the per-recipient map, while `repairedRecipientIds` — a different question, who the repair
    // REACHED — stays non-self.
    it("counts the caster's own over-repair in the overheal aggregate", () => {
        const intents = captureIntentsForReactiveRepair({
            abilities: [fontOfPower()],
            sourceAbilityId: 'ab-mixed-repair',
            perTarget: [
                { targetId: ALLY_ID, amount: 1_000 }, // ally repaired with NO waste
                { targetId: OWNER_ID, amount: 5_000, overheal: 4_000 }, // caster over-repairs itself
            ],
        });
        expect(intents).toHaveLength(1);
        // Self-inclusive since #444 — the repair reached the caster too, so Font of Power's grant
        // list carries it.
        expect(intents[0].eventCtx?.repairedRecipientIds).toEqual([ALLY_ID, OWNER_ID]);
        expect(intents[0].eventCtx?.overhealAmount).toBe(4_000);
        expect(intents[0].eventCtx?.overhealByRecipient).toEqual({ [OWNER_ID]: 4_000 });
    });

    // #444, owner ruling 2026-08-31: "font of power procs on all heals, including self heals."
    // This case used to assert the opposite — a repair reaching only the caster enqueued nothing,
    // so the implant never rolled. The buff now fans out onto the caster like any other repaired
    // ship. (The shipped implant text still says "when applying repair to another ally"; the
    // ruling is from observed play and overrides it.)
    it('enqueues Font of Power off a repair that reached ONLY the caster', () => {
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
        expect(intents).toHaveLength(1);
        expect(intents[0].eventCtx?.repairedRecipientIds).toEqual([OWNER_ID]);
    });

    // The OTHER arm of that gate, re-ruled 2026-08-31. An `overheal`-BASIS reaction is sized by
    // what a repair WASTED, not by who received it, and the caster's own waste now counts — so it
    // fires off a repair that reached only the caster. The in-game case: Chimei's start-of-round
    // passive repairs allies with Stealth, she is the only Stealthed ship, and it over-repairs
    // her. The redirect still lands on an ally (the selector excludes her), not on herself.
    it('DOES enqueue an overheal-sized reaction off a caster-only repair', () => {
        const intents = captureIntentsForReactiveRepair({
            abilities: [redirect()],
            sourceAbilityId: 'ab-some-passive-repair',
            perTarget: [{ targetId: OWNER_ID, amount: 5_000, overheal: 4_000 }],
        });
        expect(intents).toHaveLength(1);
        expect(intents[0].eventCtx?.repairedRecipientIds).toEqual([OWNER_ID]);
        expect(intents[0].eventCtx?.overhealAmount).toBe(4_000);
        expect(intents[0].eventCtx?.overhealByRecipient).toEqual({ [OWNER_ID]: 4_000 });
    });

    // …and only when that repair wasted something. A caster-only repair absorbed in full has
    // nothing to redirect, and must not burn an enqueue — one enqueue is one proc-gate roll. That
    // requirement is ENGINEERING, not an owner ruling, and it is scoped to the OVERHEAL shape:
    // Font of Power is sized by nothing and enqueues off the same event (case above).
    it('does NOT enqueue an overheal-sized reaction off a caster-only repair that wasted nothing', () => {
        const intents = captureIntentsForReactiveRepair({
            abilities: [redirect()],
            sourceAbilityId: 'ab-some-passive-repair',
            perTarget: [{ targetId: OWNER_ID, amount: 5_000 }],
        });
        expect(intents).toHaveLength(0);
    });

    // The other half of #444's ruling — "heal over time excluded" — needs no code, and this is
    // the tripwire that keeps it that way. A HoT tick emits `hot-ticked`, which has NO subscriber
    // anywhere in the engine ("a tick is not a performed repair", locked 2026-08-23; see the R2
    // note in playerTurn.ts). If some future change routed ticks through the repair events, this
    // reddens instead of silently arming every on-repair implant once per tick per holder.
    it('is not armed by a heal-over-time tick', () => {
        const bus = createEventBus();
        const intents: Intent[] = [];
        registerReactiveListeners({
            bus,
            perOwner: [
                {
                    ownerId: OWNER_ID,
                    reactiveAbilities: [
                        { ability: fontOfPower(), sourceSlot: 'passive' },
                        { ability: redirect(), sourceSlot: 'passive' },
                    ],
                },
            ],
            enqueue: (i) => intents.push(i),
            isOpposing: (id) => id === 'enemy',
        });
        bus.emit({
            type: 'hot-ticked',
            holderId: ALLY_ID,
            applierId: OWNER_ID,
            amount: 5_000,
            round: 1,
        });
        expect(intents).toHaveLength(0);

        // …and the instrument could have reported the opposite: the SAME bus, with the SAME two
        // listeners armed, enqueues both of them off a real repair event. Without this arm a
        // zero above would be indistinguishable from a bus that dropped the emit.
        bus.emit({
            type: 'reactive-heal-performed',
            casterId: OWNER_ID,
            round: 1,
            amount: 5_000,
            perTarget: [{ targetId: ALLY_ID, amount: 5_000, overheal: 4_000 }],
            sourceAbilityId: 'ab-some-passive-repair',
        });
        expect(intents).toHaveLength(2);
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

    // The CAST arm's mirror of R-C above, and re-ruled with it. `heal-performed` is the emit a
    // `target: 'all-allies'` cast produces, self INCLUDED (playerTurn.ts) — so the caster's own
    // wasted share is part of what the cast wasted, on the same terms as the reactive arm.
    it("counts the caster's own over-repair in the overheal aggregate on the CAST path", () => {
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
            type: 'heal-performed',
            casterId: OWNER_ID,
            targets: [ALLY_ID, OWNER_ID],
            round: 1,
            amount: 5_000,
            overheal: 4_000, // the cast's raw aggregate — INCLUDES the caster's own waste
            perTarget: [
                { targetId: ALLY_ID, amount: 1_000 }, // ally repaired with NO waste
                { targetId: OWNER_ID, amount: 5_000, overheal: 4_000 }, // caster over-repairs itself
            ],
        });
        expect(intents).toHaveLength(1);
        // Self-inclusive since #444 — the repair reached the caster too, so Font of Power's grant
        // list carries it.
        expect(intents[0].eventCtx?.repairedRecipientIds).toEqual([ALLY_ID, OWNER_ID]);
        expect(intents[0].eventCtx?.overhealAmount).toBe(4_000);
        expect(intents[0].eventCtx?.overhealByRecipient).toEqual({ [OWNER_ID]: 4_000 });
    });

    // A cast that wastes on BOTH the caster and an ally: every wasted point reaches the
    // aggregate, and the per-recipient map carries one entry each. The caster's entry appearing
    // here is the whole 2026-08-31 ruling — it is what Abundant Renewal fans a shield out over and
    // what Chimei's redirect sums.
    it('carries every recipient’s waste, the caster’s included, on a cast that wastes on both', () => {
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
            type: 'heal-performed',
            casterId: OWNER_ID,
            targets: [ALLY_ID, OWNER_ID],
            round: 1,
            amount: 10_000,
            overheal: 7_000,
            perTarget: [
                { targetId: ALLY_ID, amount: 5_000, overheal: 3_000 },
                { targetId: OWNER_ID, amount: 5_000, overheal: 4_000 },
            ],
        });
        expect(intents).toHaveLength(1);
        expect(intents[0].eventCtx?.overhealAmount).toBe(7_000);
        expect(intents[0].eventCtx?.overhealByRecipient).toEqual({
            [ALLY_ID]: 3_000,
            [OWNER_ID]: 4_000,
        });
        // …and the recipient list carries both, self-inclusive since #444.
        expect(intents[0].eventCtx?.repairedRecipientIds).toEqual([ALLY_ID, OWNER_ID]);
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
