/**
 * #363 (Task 8) — Fuying's reactive Stasis honours its own "ally in Stealth" precondition.
 *
 * Her R3/R4 refit passive's second sentence reads:
 *
 *   "When an ally in <unit-skill>Stealth</unit-skill> within the active pattern is directly
 *    damaged, this Unit inflicts <unit-skill>Stasis</unit-skill> for 1 turn onto the enemy."
 *
 * The Stealth precondition was not checked at all: the clause built as a bare `on-ally-attacked`
 * debuff, so it fired on ANY ally being damaged. Measured in the `plain` fingerprint scenario at
 * this branch's base (`9eb6974b`): 40 `Stasis` log mentions (20 applications + 20 expiries) with
 * ZERO Stealth anywhere on the board. The faction fix earlier on this branch made it more visibly
 * wrong, not less — a team with no Tianchao ally now never has anyone Stealthed, and it still
 * fired.
 *
 * OWNER RULINGS this file encodes (2026-08-22 — do not re-derive from code or sibling ships):
 *  1. Being hit does NOT consume Stealth; it ends by expiry or the holder's own action. So the
 *     damaged ally still holds Stealth when the reaction resolves — a LIVE read is the whole rule,
 *     with no snapshot and no pre/post-hit ordering question.
 *  2. Therefore the reaction may fire on EVERY qualifying hit. There is deliberately NO
 *     once-per-round / once-per-ally cap: a cap is legitimate only if the ability's TEXT says so,
 *     and this text says nothing. A high post-fix rate would be the game, not a bug.
 *  3. Stealth affects only being CHOSEN as a target; damage lands normally. So a Stealthed ally
 *     really does take direct hits and the gate is genuinely reachable — which is what the engine
 *     board below rests on.
 *  4. "within the active pattern" governs this passive (it says so itself) — `patternScoped` was
 *     already set and is untouched here.
 *
 * WHAT THIS FILE DOES *NOT* ASSERT: that a Stealthed ally OUTSIDE her footprint fails to trigger
 * the reaction. No footprint gate exists on the `on-ally-attacked` damaged-ally axis today, and
 * adding one is not this task. The footprint reads below are PRECONDITIONS documenting the
 * fixture's geometry, not behaviour claims.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { detectDamageReactionTrigger } from '../../skillTextParser';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { registerReactiveListeners, type Intent, type ReactiveAbility } from '../triggers';
import { footprintAllies } from '../footprintAllies';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedPattern, ParsedTarget } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor } from '../state';
import type { Ship } from '../../../types/ship';

// `docs/` is gitignored reference data and a fresh worktree does not have it. Without this guard
// the file fails to COLLECT rather than reporting a readable reason (realKitFingerprints.test.ts:41).
function requireReferenceData(): void {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree ' +
                '(gitignored reference data) — needed to resolve real ship skill text/stats.'
        );
    }
}
beforeAll(requireReferenceData);

/** The corpus Ship builder. `refitLevel` defaults to 4, so this is the R4 refit-active passive. */
const fuyingShip = (): Ship => {
    const s = buildTraceShip('Fuying');
    if (!s) throw new Error('Fuying missing from the corpus');
    return s;
};

/** Her R4 passive row, verbatim from docs/ship-skills.csv (the DR-aura sentence, then the
 *  reactive one, separated by the row's own `<br />` paragraph break). */
const FUYING_PASSIVE_R4 =
    'All Tianchao allies with <unit-skill>Stealth</unit-skill> take ' +
    '<unit-damage>30% less direct damage</unit-damage>.<br /><br />\n' +
    'When an ally in <unit-skill>Stealth</unit-skill> within the active pattern is directly ' +
    'damaged, this Unit inflicts <unit-skill>Stasis</unit-skill> for 1 turn onto the enemy.';

/** Fuying's reactive Stasis ability, exactly as `buildShipAbilities` emits it — PRODUCTION slot
 *  routing, never a hand-written stand-in. */
const stasisReactive = (ship: Ship = fuyingShip()): Ability => {
    const a = buildShipAbilities(ship)
        .slots.flatMap((s) => s.abilities)
        .find((x) => x.config.type === 'debuff' && x.config.buffName === 'Stasis');
    if (!a) throw new Error('Fuying built no Stasis reactive');
    return a;
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Parser — the status name comes off the TRIGGER phrase, keyed on the <unit-skill> tag boundary.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('Fuying reactive Stasis (#363) — parser reads the ally-status precondition', () => {
    /** The anchor every call below uses: the Stasis mention, which is what buildShipAbilities
     *  anchors this clause on (`findBuffNamePos(rowText, 'Stasis')`). */
    const stasisPos = (text: string) => text.indexOf('Stasis');

    it('reads Stealth off "when an ally IN <unit-skill>Stealth</unit-skill> … is directly damaged"', () => {
        expect(stasisPos(FUYING_PASSIVE_R4)).toBeGreaterThan(0); // precondition: the anchor exists
        expect(
            detectDamageReactionTrigger(FUYING_PASSIVE_R4, stasisPos(FUYING_PASSIVE_R4))
        ).toEqual({
            trigger: 'on-ally-attacked',
            allyStatusName: 'Stealth',
        });
    });

    it('does not leak the status name across the row’s <br /> paragraph break', () => {
        // The DR-aura sentence in the SAME row also says "allies with Stealth". Anchoring on THAT
        // sentence must not produce an ally-status gate — it is not even an ally-subject reaction.
        const auraPos = FUYING_PASSIVE_R4.indexOf('30%');
        expect(auraPos).toBeGreaterThan(0);
        expect(detectDamageReactionTrigger(FUYING_PASSIVE_R4, auraPos)).toBeUndefined();
    });

    it('yields NO gate for an UNRECOGNISED status name (leaves today’s behaviour)', () => {
        // A name that is not a canonical BUFFS entry must not produce a gate that can never
        // match — an un-gated reaction is the strictly safer failure mode.
        const invented = FUYING_PASSIVE_R4.replace(
            'ally in <unit-skill>Stealth</unit-skill>',
            'ally in <unit-skill>Wibblecloak</unit-skill>'
        );
        const got = detectDamageReactionTrigger(invented, stasisPos(invented));
        expect(got).toEqual({ trigger: 'on-ally-attacked' });
        expect(got!.allyStatusName).toBeUndefined();
    });

    it('yields NO gate when the trigger phrase names no status at all (Graphite keeps its roleFilter)', () => {
        const graphite =
            'When an ally attacker or debuffer is directly damaged, this Unit grants the ally ' +
            '<unit-skill>Repair Over Time III</unit-skill> for 2 turns.';
        const got = detectDamageReactionTrigger(graphite, graphite.indexOf('Repair Over Time'));
        expect(got).toEqual({
            trigger: 'on-ally-attacked',
            roleFilter: ['ATTACKER', 'DEBUFFER'],
        });
        expect(got!.allyStatusName).toBeUndefined();
    });

    it('reads the status from the TAG, not from a guess at where a capitalised phrase ends', () => {
        // Two-word status name with a trailing capitalised word right after the tag: a bare
        // capitalised-phrase scan would swallow "Within" (or stop short of "Up I").
        const tagged =
            'When an ally in <unit-skill>Attack Up I</unit-skill> Within the active pattern is ' +
            'directly damaged, this Unit inflicts <unit-skill>Stasis</unit-skill> for 1 turn.';
        expect(detectDamageReactionTrigger(tagged, stasisPos(tagged))?.allyStatusName).toBe(
            'Attack Up I'
        );
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Build — through PRODUCTION slot routing.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('Fuying reactive Stasis (#363) — build', () => {
    it('carries requireDamagedAllyStatus: Stealth, and keeps everything else about the clause', () => {
        const ab = stasisReactive();
        expect(ab.trigger).toBe('on-ally-attacked');
        expect(ab.target).toBe('enemy'); // "onto the enemy" — unchanged
        expect(ab.patternScoped).toBe(true); // "within the active pattern" — unchanged
        expect(ab.requireDamagedAllyStatus).toBe('Stealth');
    });

    it('is absent at R0/R2 for the reaction the R0 row does not carry, and present at R2', () => {
        // Her R0 passive row is the DR-aura sentence ALONE — no reactive clause — so there is no
        // Stasis ability at all to gate. R2 carries the same two-sentence row as R4.
        const r0 = buildShipAbilities(buildTraceShip('Fuying', { refitLevel: 0 })!)
            .slots.flatMap((s) => s.abilities)
            .find((x) => x.config.type === 'debuff' && x.config.buffName === 'Stasis');
        expect(r0).toBeUndefined();
        expect(
            stasisReactive(buildTraceShip('Fuying', { refitLevel: 2 })!).requireDamagedAllyStatus
        ).toBe('Stealth');
    });

    it('fires on Fuying ALONE across the whole corpus (no other ship gains a status gate)', () => {
        // Corpus inertness: the parser arm is new, so anything else it touches is a regression in
        // a ship nobody asked about.
        const gated: string[] = [];
        for (const rec of loadShipSkillRecords()) {
            const ship = buildTraceShip(rec.name);
            if (!ship) continue;
            for (const slot of buildShipAbilities(ship).slots) {
                for (const ab of slot.abilities) {
                    if (ab.requireDamagedAllyStatus !== undefined) {
                        gated.push(`${ship.name}:${ab.requireDamagedAllyStatus}`);
                    }
                }
            }
        }
        expect([...new Set(gated)]).toEqual(['Fuying:Stealth']);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Listener gate — per-damaged-ally attribution, with the REAL built ability.
//
// `registerReactiveListeners` is where `roleFilter` and `requireDamagedAllyAdjacent` already
// filter on the damaged ally, and it is the only place that can attribute a decision to ONE ally:
// the engine board further down aggregates over three simultaneous victims of one AoE.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** A hand bus + one owner, returning the intents a single `attacked` event enqueues. */
function enqueuedFor(opts: {
    ability: Ability;
    damagedAllyId: string;
    /** undefined models "no status resolver at all" (DPS / unit-fixture runs). */
    statusNamesOf?: (actorId: string) => string[];
    /** 'enemy-owner' flips which side the owner sits on (team-symmetry check). */
    ownerSide?: 'player' | 'enemy';
}): Intent[] {
    const listeners = new Map<string, ((e: CombatEvent) => void)[]>();
    const handBus = {
        on<T extends CombatEvent['type']>(
            type: T,
            listener: (event: Extract<CombatEvent, { type: T }>) => void
        ) {
            listeners.set(type, [
                ...(listeners.get(type) ?? []),
                listener as unknown as (e: CombatEvent) => void,
            ]);
        },
        emit(event: CombatEvent) {
            for (const l of listeners.get(event.type) ?? []) l(event);
        },
    };
    const enqueued: Intent[] = [];
    const ra: ReactiveAbility = { ability: opts.ability, sourceSlot: 'passive' };
    // The owner and its allies live on ONE side; the attacker on the other. Flipping `ownerSide`
    // flips only which label `isOpposing` treats as opposing — the same closure, no mirrored code.
    const enemySideIds = new Set(
        opts.ownerSide === 'enemy'
            ? ['striker']
            : ['striker', 'fuying', opts.damagedAllyId, 'other-ally']
    );
    registerReactiveListeners({
        bus: handBus,
        perOwner: [{ ownerId: 'fuying', reactiveAbilities: [ra] }],
        enqueue: (intent) => enqueued.push(intent),
        isOpposing:
            opts.ownerSide === 'enemy'
                ? (id: string) => enemySideIds.has(id)
                : (id: string) => id === 'striker',
        ...(opts.statusNamesOf ? { statusNamesOf: opts.statusNamesOf } : {}),
    });
    handBus.emit({
        type: 'attacked',
        targetId: opts.damagedAllyId,
        attackerId: 'striker',
        round: 1,
        damage: 1000,
    });
    return enqueued;
}

describe('Fuying reactive Stasis (#363) — the listener gate, per damaged ally', () => {
    const holds = (map: Record<string, string[]>) => (id: string) => map[id] ?? [];

    it('PRE-CONDITION: the ability under test really carries the gate, and the event really is an ally hit', () => {
        // Without this, both arms below could be reading a gate-less ability (arm A green for the
        // wrong reason) or an event scoped away entirely (arm B green vacuously).
        const ab = stasisReactive();
        expect(ab.requireDamagedAllyStatus).toBe('Stealth');
        expect(ab.trigger).toBe('on-ally-attacked');
        // Same event, gate stripped → it DOES enqueue. So the event is genuinely an ally hit this
        // listener accepts, and any non-enqueue below is the gate's doing and nothing else.
        const ungated: Ability = { ...ab };
        delete ungated.requireDamagedAllyStatus;
        expect(
            enqueuedFor({
                ability: ungated,
                damagedAllyId: 'ally-plain',
                statusNamesOf: holds({}),
            })
        ).toHaveLength(1);
    });

    it('ARM A — a Stealthed damaged ally DOES trigger the reaction', () => {
        expect(
            enqueuedFor({
                ability: stasisReactive(),
                damagedAllyId: 'ally-stealthed',
                statusNamesOf: holds({ 'ally-stealthed': ['Security Up III', 'Stealth'] }),
            })
        ).toHaveLength(1);
    });

    it('ARM B — a damaged ally with NO Stealth does NOT trigger it (the pre-fix defect)', () => {
        expect(
            enqueuedFor({
                ability: stasisReactive(),
                damagedAllyId: 'ally-plain',
                // Genuinely buffed, just not Stealthed — so this measures the NAME, not emptiness.
                statusNamesOf: holds({ 'ally-plain': ['Security Up III', 'Barrier'] }),
            })
        ).toEqual([]);
    });

    it('matches the status name EXACTLY — "Attack Up I" is not satisfied by "Attack Up II"', () => {
        // MUTATION TRIPWIRE: turning the comparison into a substring match makes this pass a
        // tier-I gate on a tier-II holder. 25 real BUFFS pairs stand in this prefix relation.
        const tierI: Ability = { ...stasisReactive(), requireDamagedAllyStatus: 'Attack Up I' };
        expect(
            enqueuedFor({
                ability: tierI,
                damagedAllyId: 'ally-tier2',
                statusNamesOf: holds({ 'ally-tier2': ['Attack Up II'] }),
            })
        ).toEqual([]);
        // Same ally, the exact name → fires. Proves the negative above is about the NAME.
        expect(
            enqueuedFor({
                ability: tierI,
                damagedAllyId: 'ally-tier2',
                statusNamesOf: holds({ 'ally-tier2': ['Attack Up I'] }),
            })
        ).toHaveLength(1);
    });

    it('an ally whose statuses CANNOT be read never satisfies the gate (conservative)', () => {
        // MUTATION TRIPWIRE: making the helper-absent fallback permissive (the shape
        // `requireDamagedAllyAdjacent` uses) reopens the exact defect this task closes — a status
        // gate that silently disappears wherever the resolver is not wired.
        expect(enqueuedFor({ ability: stasisReactive(), damagedAllyId: 'ally-unknown' })).toEqual(
            []
        );
        // …and an ally simply MISSING from a resolver that exists is equally unsatisfied.
        expect(
            enqueuedFor({
                ability: stasisReactive(),
                damagedAllyId: 'ally-unknown',
                statusNamesOf: holds({ 'someone-else': ['Stealth'] }),
            })
        ).toEqual([]);
    });

    it('gates an ENEMY-side owner identically (team symmetry — one closure, no side branch)', () => {
        const ability = stasisReactive();
        expect(
            enqueuedFor({
                ability,
                damagedAllyId: 'ally-stealthed',
                statusNamesOf: holds({ 'ally-stealthed': ['Stealth'] }),
                ownerSide: 'enemy',
            })
        ).toHaveLength(1);
        expect(
            enqueuedFor({
                ability,
                damagedAllyId: 'ally-plain',
                statusNamesOf: holds({ 'ally-plain': ['Barrier'] }),
                ownerSide: 'enemy',
            })
        ).toEqual([]);
    });

    it('leaves an UNGATED on-ally-attacked reaction alone (Graphite/Refine/Guardian)', () => {
        // The gate is opt-in: an ability without the field must fire even with no resolver wired,
        // which is what keeps every pre-#363 ally reaction byte-identical.
        const ungated: Ability = { ...stasisReactive() };
        delete ungated.requireDamagedAllyStatus;
        expect(enqueuedFor({ ability: ungated, damagedAllyId: 'ally-plain' })).toHaveLength(1);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Engine end-to-end, on a REAL board — proves `statusNamesOf` is actually wired and that the live
// status read happens at reaction time.
//
// Geometry (the same proven board as `fuyingFactionScope.integration.test.ts`'s aura fixture, so
// the reach question is already settled there):
//   Fuying is the FOCUS at T2 with her real `Pattern-Wings-Support-Not-Self-Range-2`
//     → support footprint {M2, M3, B1, B2, B3} (patternOffsets.ts's "Human-verified @ T2" line).
//   The enemy fires `Pattern-Line-Range-2` from row M and anchors on the front-most M-row player.
//     M4 is empty, so that is `ally-m3`; covered extends two steps back → M2, M1. One attack,
//     three victims.
//
// The CONTROL swaps the allies' self-cast status from Stealth to Barrier rather than removing it.
// That is deliberate and load-bearing: the positional stealth filter drops Stealthed cells from an
// enemy's candidate list UNLESS every candidate is Stealthed, so "all Stealthed" and "none
// Stealthed" both leave ordinary front-to-back selection intact and pick the SAME anchor, while
// "some Stealthed" would move it and change the victim set under test. The per-victim damage
// equality asserted below is the proof that the geometry really did not move.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const HUGE_HP = 1_000_000_000;
const ENEMY_ATTACK = 5000;

const wingsSupportNotSelf2 = (): ParsedPattern => ({
    raw: 'Pattern-Wings-Support-Not-Self-Range-2',
    shape: 'wings',
    range: 2,
    modifiers: { support: true, notSelf: true },
});
const lineRange2 = (): ParsedPattern => ({
    raw: 'Pattern-Line-Range-2',
    shape: 'line',
    range: 2,
    modifiers: {},
});
const frontTarget = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });

const inertWalkStats = (hp: number) => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    hacking: 0,
    defence: 0,
    hp,
});

/** A 99-turn self-buff of `buffName` (the idiom from incomingReductionEngine.test.ts). */
const selfStatusBuff = (id: string, buffName: string): Ability => ({
    id,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName,
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 99,
    },
});

/** A positioned, harmless player victim that self-casts `buffName` before the enemy acts. */
const buffedAlly = (id: string, position: Position, buffName: string) => ({
    id,
    speed: 1000, // ahead of the enemy, so the status is up before it fires
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    faction: 'TIANCHAO' as const,
    position,
    walk: {
        shipSkills: {
            slots: [
                { slot: 'active' as const, abilities: [selfStatusBuff(`${id}-buff`, buffName)] },
            ],
        },
        stats: inertWalkStats(HUGE_HP),
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

/** Fuying's kit as PRODUCTION builds it, reduced to the passive-slot Stasis reactive. Her DR aura
 *  and her active grant are deliberately left off: the aura is irrelevant to the gate, and her own
 *  Stealth grant is 1-turn and faction-scoped, which would make WHO is Stealthed a function of her
 *  cast timing rather than of the fixture. */
const stasisPassiveSlot = (): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [stasisReactive()],
});

const ALLY_CELLS: Record<string, Position> = { 'ally-m3': 'M3', 'ally-m2': 'M2', 'ally-m1': 'M1' };

const gateBoard = (allyStatus: string): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    hacking: 2000, // she has to actually LAND the Stasis for the arm to be observable
    chargeCount: 0,
    numRounds: 2,
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: HUGE_HP,
    speed: 2000,
    mode: 'healing',
    healTargetId: 'attacker',
    faction: 'TIANCHAO',
    position: 'T2',
    pattern: wingsSupportNotSelf2(),
    // Her own Stealth is a SNAPSHOT self-buff in BOTH runs: her pattern is Not-Self, so she can
    // never reach her own cell with a cast. It is here only so the "every candidate is Stealthed →
    // restore all" branch behaves identically to the sibling aura fixture; her own cell is never
    // an ally-hit victim (the enemy's line never reaches T2), so it cannot satisfy the gate.
    selfBuffs: [
        {
            id: 'fuying-stealth-snapshot',
            buffName: 'Stealth',
            stacks: 1,
            parsedEffects: {},
            isStackable: false,
        },
    ],
    shipSkills: { slots: [stasisPassiveSlot()] },
    teamActors: Object.entries(ALLY_CELLS).map(([id, cell]) => buffedAlly(id, cell, allyStatus)),
    enemyAttackers: [
        {
            id: 'enemy-1',
            stats: {
                attack: ENEMY_ATTACK,
                crit: 0,
                critDamage: 0,
                defence: 0,
                security: 0, // no resistance, so a qualifying reaction is observable
                hp: HUGE_HP,
                speed: 1, // acts last → sees every ally's status
            },
            chargeCount: 0,
            startCharged: false,
            position: 'M1',
            target: frontTarget(),
            pattern: lineRange2(),
        },
    ],
});

/** One board run, reduced to what the three arms need: who was granted what, who was hit for how
 *  much, and every Stasis Fuying inflicted. */
const runGateBoard = (allyStatus: string) => {
    const bus = createEventBus();
    const granted = new Map<string, Set<string>>();
    const direct = new Map<string, number>();
    const allyHits: string[] = [];
    const stasis: string[] = [];
    bus.on('buff-applied', (e) => {
        const set = granted.get(e.actorId) ?? new Set<string>();
        set.add(e.buffName);
        granted.set(e.actorId, set);
    });
    bus.on('attacked', (e) => {
        if (e.damage === undefined) return;
        direct.set(e.targetId, (direct.get(e.targetId) ?? 0) + e.damage);
        if (e.targetId in ALLY_CELLS) allyHits.push(e.targetId);
    });
    bus.on('debuff-applied', (e) => {
        if (e.buffName === 'Stasis' && e.sourceId === 'attacker') stasis.push(e.targetId);
    });
    runCombat({ ...gateBoard(allyStatus), bus });
    return { granted, direct, allyHits, stasis };
};

describe('Fuying reactive Stasis (#363) — engine, on a real board', () => {
    const stealthed = runGateBoard('Stealth');
    const control = runGateBoard('Barrier');

    it('PRE-CONDITION: the intended status really landed on all three allies, in both runs', () => {
        // The vacuity trap this branch has already shipped twice: an arm that passes because the
        // watched ally never held (or never lacked) the status at all.
        for (const id of Object.keys(ALLY_CELLS)) {
            expect(stealthed.granted.get(id), `${id} was granted nothing`).toBeDefined();
            expect([...stealthed.granted.get(id)!]).toContain('Stealth');
            expect([...control.granted.get(id)!]).toContain('Barrier');
            expect([...control.granted.get(id)!]).not.toContain('Stealth');
        }
    });

    it('PRE-CONDITION: all three allies really were DIRECTLY hit, for identical damage in both runs', () => {
        // "Really hit" makes the negative arm meaningful; "identical damage" proves swapping the
        // status did not move the enemy's anchor and quietly change the victim set.
        for (const id of Object.keys(ALLY_CELLS)) {
            expect(stealthed.direct.get(id), `${id} took no direct damage`).toBeGreaterThan(0);
            expect(control.direct.get(id)).toBe(stealthed.direct.get(id));
        }
        expect(stealthed.allyHits.length).toBe(control.allyHits.length);
        expect(stealthed.allyHits.length).toBeGreaterThan(0);
    });

    it('PRE-CONDITION: the fixture’s cells sit where the geometry comment claims', () => {
        // Reads the PRODUCTION footprint resolver rather than trusting the comment, so a change to
        // the wings table shows up here instead of silently invalidating the fixture. M3/M2 are
        // inside her support footprint and M1 is outside it — see the file header for why this is
        // documentation of the fixture and NOT a behaviour assertion.
        const actors = Object.entries(ALLY_CELLS).map(
            ([id, position]) => ({ id, position, currentHp: 1 }) as unknown as CombatActor
        );
        const inside = footprintAllies({
            pattern: wingsSupportNotSelf2(),
            anchor: 'T2',
            sameSideLiving: actors,
        }).map((a) => a.id);
        expect(inside.sort()).toEqual(['ally-m2', 'ally-m3']);
    });

    it('ARM A — Stasis IS inflicted when the damaged allies are Stealthed', () => {
        expect(stealthed.stasis.length).toBeGreaterThan(0);
        // Sanity bound from the task brief: an application can never outnumber the qualifying
        // hits (a direct hit on a Stealthed ally). Every ally is Stealthed here, so the qualifying
        // hits are exactly the ally hits.
        expect(stealthed.stasis.length).toBeLessThanOrEqual(stealthed.allyHits.length);
        // It really lands on the attacking enemy ("onto the enemy").
        expect([...new Set(stealthed.stasis)]).toEqual(['enemy-1']);
    });

    it('ARM B — Stasis is NOT inflicted when the damaged allies hold no Stealth (the defect)', () => {
        // The arm that fails at this branch's base: pre-fix the reaction fired on every ally hit
        // regardless, so this was `control.allyHits.length` applications with nobody Stealthed.
        expect(control.allyHits.length).toBeGreaterThan(0); // there WERE hits to over-fire on
        expect(control.stasis).toEqual([]);
    });
});
