/**
 * #415 per-channel coverage.
 *
 * The DPS calculator used to run a PARTIAL engine: `runCombat` set
 * `healTarget = explicitHealTarget ?? (runMode === 'battle' ? attacker : undefined)`, so a DPS run
 * got `undefined`, `healingCtx` was never built, and a whole runtime layer died from one line.
 * `dpsFullEngineRun.test.ts` pins the shield grant and the report split; this file pins the REST,
 * one test per revived path, because mutating the feature once would leave the others unproven.
 *
 * The two leech classes in particular come from SEPARATE setup scans in `engine.ts`
 * (`standingLeeches` and `takenLeechesByOwner`), each previously wrapped in `if (healTarget)`, so
 * one probe cannot cover both.
 *
 * WHAT IS OBSERVABLE FROM A DPS RESULT, AND WHAT IS NOT. `RoundData` (`dpsSimulator.ts`) carries
 * `perActorShield` / `perActorReflected` / `perActorSplash` / `perActorDetonation` /
 * `perActorIncoming` — and NO heal field at all. The per-recipient healing block that
 * `src/utils/combat/__tests__/lowestHpAllyRouting.test.ts` asserts against is exactly what
 * `healReportActive` keeps out of a DPS result, by design. So the two repair channels below are
 * observed on the EVENT BUS instead: `simulateDPS` accepts `bus?: CombatEventBus` and fans every
 * engine event to it as a write-only tap. A real `createEventBus()` is used rather than a cast
 * stub — the interface is `{ on, emit }`, and the collecting wrapper inside `simulateDPS` calls
 * `input.bus?.emit(e)`, which dispatches to listeners registered with `on`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { simulateDPS } from '../dpsSimulator';
import { setupKeyedTestRng } from '../rateAccumulator';
import { baseInput, damageKit } from '../__testutils__/dpsRealEnemyFixture';
import { createEventBus } from '../../combat/events';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { TeamActorInput } from '../../../types/calculator';

/** A real enemy that ACTS. Several channels below are only OBSERVABLE against one: at the
 *  0-attack default the focus never takes damage, so no `attacked` event is emitted at all (the
 *  damage-taken leech cannot fire), the focus is always full (every repair is pure overheal and
 *  books nothing the bus can see) and a "below 40% HP" gate can never open. `hp: 10_000_000` on
 *  the enemy keeps IT alive for the whole run, so the fight is never truncated by a roster wipe. */
const attackingEnemy = (attack: number) => [
    {
        id: 'enemy-1',
        stats: {
            attack,
            crit: 0,
            critDamage: 150,
            speed: 9999,
            defence: 1000,
            hp: 10_000_000,
            security: 100,
        },
        chargeCount: 0,
        startCharged: false,
        shipSkills: damageKit(),
    },
];

// ─────────────────────────────────────────────────────────────────────────────────────────────
// (a) The STANDING leech — `engine.ts`'s `standingLeeches` scan.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Passive-slot `basis: 'damage-dealt'` — a STANDING leech, owned by the engine's per-victim
 *  credit hook rather than by the cast path (`isHookOwned` in playerTurn skips it). */
const standingLeechKit = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: damageKit().slots[0].abilities },
        {
            slot: 'passive',
            abilities: [
                {
                    id: 'p1',
                    type: 'shield',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'shield', pct: 50, basis: 'damage-dealt' },
                },
            ],
        },
    ],
});

describe('#415 standing leech', () => {
    beforeEach(() => setupKeyedTestRng(12345));

    it('shields the focus for a share of the damage it deals', () => {
        const { rounds } = simulateDPS(
            baseInput({ shipSkills: standingLeechKit(), hp: 1_000_000, rounds: 3 })
        );
        // Red on main: the `standingLeeches` scan sat inside `if (healTarget)`, so it never ran and
        // this was 0 on every round.
        expect(rounds.every((r) => (r.perActorShield?.attacker?.granted ?? 0) > 0)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// (b) The DAMAGE-TAKEN leech — `engine.ts`'s `takenLeechesByOwner` scan. A DIFFERENT site.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Passive-slot `basis: 'damage-taken'` — the OTHER scan, owned by the enemy-attack block. */
const takenLeechKit = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: damageKit().slots[0].abilities },
        {
            slot: 'passive',
            abilities: [
                {
                    id: 'p2',
                    type: 'shield',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'shield', pct: 50, basis: 'damage-taken' },
                },
            ],
        },
    ],
});

describe('#415 damage-taken leech', () => {
    beforeEach(() => setupKeyedTestRng(12345));

    it('shields the focus for a share of the damage it takes', () => {
        const { rounds } = simulateDPS(
            baseInput({
                shipSkills: takenLeechKit(),
                // Large enough that the focus survives all three rounds: a truncated run would
                // make this test pass or fail for the wrong reason.
                hp: 10_000_000,
                rounds: 3,
                enemyAttackers: attackingEnemy(20_000),
            })
        );
        expect(rounds.some((r) => (r.perActorShield?.attacker?.granted ?? 0) > 0)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// (c) DRAIN-TIME self-HP gates, BOTH directions.
//
// WHICH self-HP read this is, and why the obvious probe would be VACUOUS. There are TWO
// independent self-HP readings in the engine and only ONE of them is a #415 channel:
//   • the CAST-path `selfHpPct` (engine.ts, in the per-actor turn-args block) is computed
//     per-actor straight off `a.currentHp / maxHp` and is NOT gated on the healing ctx. It already
//     read real HP in DPS mode before #415. A probe built on an `on-cast` gated damage ability
//     therefore passes with the fix REVERTED — measured, both directions — so it proves nothing.
//   • the DRAIN-TIME (reactive) gate reads `ctx.selfHpPctFor?.(ownerId) ?? 100` in
//     `buildDrainContext` (triggers.ts). Its player-side closure is built ONLY when `healTarget`
//     is defined (engine.ts's `bySide` block), so on main it was `undefined` in DPS mode and every
//     reactive self-HP gate fell back to a hardcoded 100. THAT is the revived channel, and this
//     pair pins it.
//
// A gate stuck at 100 passes any test that only checks the "healthy" direction, so both are here.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const LOW_HP_BUFF = 'Last Stand Surge';

/** A REACTIVE (`on-attacked`) self-buff gated on the OWNER being BELOW 40% of its own max HP.
 *  `hpSubject` DEFAULTS TO `'enemy'` (offensive scaling), so omitting it would gate on the enemy's
 *  HP and this pair would measure the wrong thing entirely. */
const lowHpReactiveKit = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: damageKit().slots[0].abilities },
        {
            slot: 'passive',
            abilities: [
                {
                    id: 'g1',
                    type: 'buff',
                    target: 'self',
                    trigger: 'on-attacked',
                    conditions: [
                        {
                            subject: 'hp-threshold',
                            derivable: true,
                            hpSubject: 'self',
                            hpComparator: 'below',
                            hpPercent: 40,
                        },
                    ],
                    config: {
                        type: 'buff',
                        buffName: LOW_HP_BUFF,
                        parsedEffects: { attack: 25 },
                        stacks: 1,
                        isStackable: false,
                        duration: 2,
                    },
                },
            ],
        },
    ],
});

describe('#415 drain-time self-HP gates read real HP', () => {
    beforeEach(() => setupKeyedTestRng(12345));

    /** Every `buff-applied` for the gated buff, off the write-only bus tap. */
    const runAndCollectGrants = (focusHp: number, enemyAttack: number): string[] => {
        const grants: string[] = [];
        const bus = createEventBus();
        bus.on('buff-applied', (e) => {
            if (e.buffName === LOW_HP_BUFF) grants.push(e.actorId);
        });
        simulateDPS(
            baseInput({
                shipSkills: lowHpReactiveKit(),
                hp: focusHp,
                rounds: 4,
                enemyAttackers: attackingEnemy(enemyAttack),
                bus,
            })
        );
        return grants;
    };

    it('BLOCKS the gate while the focus is healthy', () => {
        // The enemy DOES attack — 4 rounds × 20,000 attack against a 5,000,000 HP focus keeps it
        // far above 40%. That matters: a 0-attack enemy would never fire `on-attacked` at all and
        // this test would pass because the TRIGGER never armed, not because the GATE blocked.
        expect(runAndCollectGrants(5_000_000, 20_000)).toEqual([]);
    });

    it('OPENS the gate once the focus is actually hurt', () => {
        // Same kit, same trigger, same rounds — only the focus's live HP differs. Red on main in
        // THIS direction: the drain gate read a hardcoded 100, so it could never open however much
        // damage the focus took.
        expect(runAndCollectGrants(500_000, 200_000)).toContain('attacker');
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// (d) Repair-over-time ticks. Observable on the bus as `hot-ticked`, NOT `heal-performed`:
//     the HoT block emits no `heal-performed` on either side (playerTurn's R2 rule), and a DPS
//     result has no heal field to read.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** A self-granted Repair Over Time. The HoT SOURCE is a payload-carrying buff status
 *  (`payload.parsedEffects.hotPct`); the TICK lives inside the block that was fully gated on
 *  `args.healing`, so on main no ship ticked a Repair Over Time in DPS mode at all. */
const hotBuff: Ability = {
    id: 'h1',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Repair Over Time II',
        parsedEffects: { hotPct: 10 },
        stacks: 1,
        isStackable: false,
        duration: 5,
    },
};

const hotKit = (): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [...damageKit().slots[0].abilities, hotBuff] }],
});

describe('#415 repair-over-time ticks in DPS mode', () => {
    beforeEach(() => setupKeyedTestRng(12345));

    it('restores HP to a focus that has been hurt', () => {
        const ticks: { holderId: string; amount: number }[] = [];
        const bus = createEventBus();
        bus.on('hot-ticked', (e) => ticks.push({ holderId: e.holderId, amount: e.amount }));

        simulateDPS(
            baseInput({
                shipSkills: hotKit(),
                hp: 1_000_000,
                rounds: 4,
                // A tick is only OBSERVABLE if there is a deficit to fill: `hot-ticked` is emitted
                // on `applied.consumed > 0`, so at the 0-attack default every tick is pure
                // overheal and this test would be vacuous.
                enemyAttackers: attackingEnemy(50_000),
                bus,
            })
        );

        // Red on main: zero `hot-ticked` events, because the tick never ran in DPS mode.
        expect(ticks.length).toBeGreaterThan(0);
        expect(ticks.every((t) => t.holderId === 'attacker')).toBe(true);
        expect(ticks.every((t) => t.amount > 0)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// (e) `lowest-hp-ally` routing. On main `lowestHpAllyIdForOwner` short-circuits to `undefined`
//     without a healing ctx and the selector resolves to NOBODY, so the cast produced no
//     recipient and no event. The point of the assertion is the recipient IDENTITY.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const ALLY_ID = 'ally-1';

/** A walked player-side ally. Hand-built rather than reusing `bareAlly` from
 *  `src/utils/combat/__testutils__/bareRosterFixture.ts`: that helper returns the ENGINE's
 *  `teamActors` shape (a pre-assembled `walk` bundle), whereas `simulateDPS` takes the
 *  calculator's `TeamActorInput` and builds the walk itself in `deriveTeamEngineActors` — which
 *  needs BOTH `shipSkills` and `stats` present or it leaves the actor a legacy scheduled-list
 *  source. The two contracts it does copy: speed 1 so the ally acts LAST and never reorders the
 *  turns, and position 'M4' — the FRONT of the player board (column 4, not column 1). */
const walkedAlly = (): TeamActorInput => ({
    id: ALLY_ID,
    speed: 1,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position: 'M4',
    shipSkills: { slots: [] },
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 0,
        defence: 0,
        hp: 500_000,
    },
});

/** A focus whose cast repairs the lowest-HP ally. `'lowest-hp-ally'` is a NAMED single-recipient
 *  selector — the living same-side ally with the lowest HP fraction, CASTER EXCLUDED, and nobody
 *  when the caster is alone. That is a different meaning from the plain `'ally'` on the cast path
 *  (which fans to the caster's whole footprint-narrowed side), which is why the recipient here is
 *  the ally and never the focus. */
const lowestHpAllyHealKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ...damageKit().slots[0].abilities,
                {
                    id: 'lh1',
                    type: 'heal',
                    target: 'lowest-hp-ally',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'heal', pct: 10, basis: 'hp' },
                },
            ],
        },
    ],
});

describe('#415 lowest-hp-ally resolves to a real recipient in DPS mode', () => {
    beforeEach(() => setupKeyedTestRng(12345));

    it('routes the repair to the ally, not to nobody', () => {
        const heals: { casterId: string; targets: string[] }[] = [];
        const bus = createEventBus();
        bus.on('heal-performed', (e) => heals.push({ casterId: e.casterId, targets: e.targets }));

        simulateDPS(
            baseInput({
                shipSkills: lowestHpAllyHealKit(),
                hp: 1_000_000,
                rounds: 3,
                teamActors: [walkedAlly()],
                bus,
            })
        );

        // Red on main: no `heal-performed` at all — the whole heal block was gated on the healing
        // ctx, and even reached, the selector had no live HP view and resolved to nobody.
        expect(heals.length).toBeGreaterThan(0);
        // The IDENTITY is the point: the one other living same-side ally, never the caster and
        // never an empty/undefined recipient list.
        expect(heals.every((h) => h.casterId === 'attacker')).toBe(true);
        expect(heals.map((h) => h.targets)).toEqual(heals.map(() => [ALLY_ID]));
    });
});
