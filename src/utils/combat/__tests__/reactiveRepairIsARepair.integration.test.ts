/**
 * A REACTIVE repair is still "an enemy performing a repair" — and a reactive duration-shrink is
 * visible in the log.
 *
 * USER-REPORTED (combat log): Ruiner's passive "inflicts Bomb II for 2 turns on any enemy
 * performing a repair" never fired against the enemies that repair the MOST — the reaction-healers:
 *
 *     ↳ reacts: Enemy Heliodor heals → Enemy Heliodor: 4,297
 *     ↳ reacts: Enemy Cultivator heals → Enemy Heliodor: 5,339
 *     (no Bomb on either)
 *
 * ROOT CAUSE: `on-enemy-repaired` rides `heal-performed`. A drain-time REACTIVE heal deliberately
 * emits NO `heal-performed` — that is the chain guard stopping a reactive repair from re-triggering
 * the repairer's own on-repair listeners — and emits only the LOG-ONLY `reactive-heal-performed`,
 * which nothing subscribed to. So every repair that arrives as a REACTION was invisible to Ruiner.
 * Fixed by subscribing `on-enemy-repaired` to that event too; it cannot reopen the chain because
 * no on-enemy-repaired rider in the corpus heals (Bomb debuff, Overload self-buff, charge removal,
 * Defense Shred), and MAX_INTENT_GENERATIONS backstops any future one that does.
 *
 * SECOND FINDING (same log): Heliodor's "When directly damaged, this Unit reduces the duration of
 * all active Debuffs on itself by 1 turn and repairs itself for 8%" showed the repair but never the
 * shrink. The reduce-duration executor branch emitted no event at ALL (unlike `remove` mode, which
 * emits reactive-cleanse-performed), so a working mechanic was indistinguishable from a missing
 * one. It now emits the same log-only event flagged `mode: 'reduce-duration'`.
 *
 * Both ships run through the REAL production path — verbatim skill text from docs/ship-skills.csv
 * through buildShipAbilities, driven by runCombat.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability } from '../../../types/abilities';
import { parsePattern, parseTarget } from '../../targetingParser';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}], ...over } as Ship;
}

/** Ruiner's R2 passive, verbatim from docs/ship-skills.csv (second passive column). */
const RUINER_R2 =
    'This Unit inflicts <unit-skill>Bomb II</unit-skill> for 2 turns on any enemy performing a ' +
    '<unit-aid>repair</unit-aid>, once per round per enemy.<br /><br />This Unit gains 1 stack of ' +
    '<unit-skill>Overload</unit-skill> when an enemy performs a <unit-aid>repair</unit-aid>, upon ' +
    'killing an enemy, this Unit removes <unit-skill>Overload</unit-skill>.';

/** Heliodor's R2 passive, verbatim from docs/ship-skills.csv (second passive column). */
const HELIODOR_R2 =
    'When directly damaged, this Unit reduces the duration of all active <unit-aid>Debuffs</unit-aid> ' +
    'on itself by 1 turn and <unit-damage>repairs itself for 8%</unit-damage> of its Max HP.';

const passiveAbilitiesOf = (text: string): Ability[] =>
    buildShipAbilities(ship({ secondPassiveSkillText: text })).slots.find(
        (s) => s.slot === 'passive'
    )?.abilities ?? [];

describe('extracted shapes (mutation guard)', () => {
    it('Ruiner R2 inflicts a real Bomb DoT on on-enemy-repaired', () => {
        const bomb = passiveAbilitiesOf(RUINER_R2).find(
            (a) => a.config.type === 'dot' && a.config.dotType === 'bomb'
        );
        if (!bomb) throw new Error('mutation guard: Ruiner Bomb rider not found');
        expect(bomb.trigger).toBe('on-enemy-repaired');
        expect(bomb.target).toBe('enemy');
        // The corpus cap that keeps this from firing on every reaction-heal in a round.
        expect(bomb.oncePerRoundPerEnemy).toBe(true);
    });

    it('Heliodor R2 shrinks debuff durations and repairs, both on on-attacked', () => {
        const abilities = passiveAbilitiesOf(HELIODOR_R2);
        const shrink = abilities.find(
            (a) => a.config.type === 'cleanse' && a.config.mode === 'reduce-duration'
        );
        const heal = abilities.find((a) => a.config.type === 'heal');
        if (!shrink || !heal) throw new Error('mutation guard: Heliodor R2 riders not found');
        expect(shrink.trigger).toBe('on-attacked');
        expect(heal.trigger).toBe('on-attacked');
    });
});

/** Heliodor as the sole enemy: reaction-heals and duration-shrinks whenever directly damaged. */
const heliodor = (): EnemyAttacker =>
    ({
        id: 'heliodor',
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 500_000, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position: 'M4',
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        shipSkills: {
            slots: [
                {
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
                },
                { slot: 'passive', abilities: passiveAbilitiesOf(HELIODOR_R2) },
            ],
        },
    }) as EnemyAttacker;

/** Ruiner attacks Heliodor. The hit is DIRECT damage, so Heliodor's on-attacked passive fires:
 *  it repairs itself (a REACTIVE heal) and shrinks its own debuff durations. Ruiner should see
 *  that repair and bomb it. */
function runRuinerVsHeliodor() {
    const input: CombatEngineInput = {
        attack: 4000,
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
                            id: 'ruiner-active',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 160 },
                        },
                    ],
                },
                { slot: 'passive', abilities: passiveAbilitiesOf(RUINER_R2) },
            ],
        },
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
        speed: 500,
        hacking: 100_000, // debuff landing is not what this test is about — never resist
        healTargetId: 'attacker', // healing mode on, so reactive repairs actually resolve
        mode: 'healing',
        position: 'M1',
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        enemyAttackers: [heliodor()],
    };

    const bus = createEventBus();
    const events: CombatEvent[] = [];
    bus.on('dot-applied', (e) => events.push(e));
    bus.on('bomb-detonated', (e) => events.push(e));
    bus.on('reactive-heal-performed', (e) => events.push(e));
    bus.on('reactive-cleanse-performed', (e) => events.push(e));
    runCombat({ ...input, bus });
    return events;
}

describe('on-enemy-repaired sees REACTIVE repairs', () => {
    it('Ruiner bombs Heliodor for its on-damaged self-repair, capped once per round per enemy', () => {
        const events = runRuinerVsHeliodor();

        // The reaction-heal must actually have happened, or the rest proves nothing.
        const heals = events.filter((e) => e.type === 'reactive-heal-performed');
        expect(heals.length).toBeGreaterThan(0);
        expect(heals.every((e) => e.casterId === 'heliodor')).toBe(true);

        // Pre-fix: zero Bombs — the repair arrived only as reactive-heal-performed, which
        // on-enemy-repaired did not listen to. The Bomb is a real DoT since 2026-07-31, so the
        // discrete infliction event is `dot-applied`, not `debuff-applied`.
        const bombs = events.filter(
            (e) => e.type === 'dot-applied' && e.dotType === 'bomb' && e.targetId === 'heliodor'
        );
        expect(bombs.length).toBeGreaterThan(0);
        // `oncePerRoundPerEnemy` holds: at most one Bomb per round across 2 rounds, even though
        // Heliodor reaction-heals off every hit it takes.
        expect(bombs.length).toBeLessThanOrEqual(2);
    });

    it("Heliodor's debuff-duration shrink emits a log-visible reactive-cleanse-performed", () => {
        const events = runRuinerVsHeliodor();
        const shrinks = events.filter(
            (e): e is Extract<CombatEvent, { type: 'reactive-cleanse-performed' }> =>
                e.type === 'reactive-cleanse-performed' && e.mode === 'reduce-duration'
        );
        // Pre-fix: the reduce-duration branch emitted nothing, so a working mechanic was
        // invisible in the log. Heliodor is carrying Ruiner's Bomb, so there IS something to shrink.
        expect(shrinks.length).toBeGreaterThan(0);
        expect(shrinks[0]).toMatchObject({
            casterId: 'heliodor',
            mode: 'reduce-duration',
            durationTurns: 1,
        });
        expect(shrinks[0].perTarget.map((pt) => pt.targetId)).toEqual(['heliodor']);
    });

    // THIRD FINDING (same user log, 2026-07-31): the Bomb Ruiner plants never went off. Two
    // reasons, both fixed — it was an inert name-only status rather than a real bomb (see the
    // mutation guard above), and the shrink that should have detonated it only ever walked the
    // StatusEngine debuff maps, never `PendingBomb.countdown`. A Bomb IS a Debuff: shrinking it to
    // 0 turns explodes it.
    it("Heliodor's shrink drives Ruiner's Bomb to 0 turns and detonates it", () => {
        const events = runRuinerVsHeliodor();
        const bursts = events.filter(
            (e): e is Extract<CombatEvent, { type: 'bomb-detonated' }> =>
                e.type === 'bomb-detonated'
        );
        expect(bursts.length).toBeGreaterThan(0);
        const burst = bursts[0];
        // Damage is credited to the bomb's ORIGINAL applier (Ruiner), not to the shrinker…
        expect(burst.actorId).toBe('attacker');
        expect(burst.victimId).toBe('heliodor');
        expect(burst.damage).toBeGreaterThan(0);
        // …while Heliodor, whose shrink forced the burst, is the detonator.
        expect(burst.detonatorId).toBe('heliodor');
    });
});
