/**
 * #363 (Task 9) — "within the active pattern" is enforced on the AFFECTED-ALLY axis, as a FAMILY.
 *
 * Four reactive abilities across three corpus supporters gate on an ally being "within the active
 * pattern", and the parser already marks all four `patternScoped`:
 *
 *   on-ally-attacked            "an ally in Stealth within the active pattern is directly damaged"
 *                               → inflicts Stasis onto the enemy            (target: 'enemy')
 *   on-ally-attacked            "when an ally is directly damaged within the active pattern"
 *                               → repairs that ally 8%                      (target: 'ally')
 *   on-ally-shield-destroyed    "when an ally within the active pattern has their shield destroyed"
 *                               → grants Defense Up II / cleanses all       (target: 'ally')
 *
 * `registerReactiveListeners` never consulted `patternScoped` on that axis, so the reaction was
 * enqueued for ANY same-side unit. OWNER RULING 2026-08-22: the pattern limit governs; fix it as a
 * family, with no per-ship special case. That is `affectedAllyOutsideActivePattern` in triggers.ts.
 *
 * ── MEASURED BLAST RADIUS (read this before believing the family framing) ────────────────────────
 * Only ONE of the four abilities changed observable behaviour, and this file says which:
 *
 *  - The THREE `target: 'ally'` abilities were ALREADY scoped, one layer downstream. Their intent
 *    was enqueued, but `footprintFilteredRecipients` then intersected their recipient list —
 *    which for these abilities is exactly `[the affected ally]` — with the very same footprint, so
 *    an off-pattern ally received nothing. Measured before the fix on the real boards in §5/§6:
 *    an off-footprint ally, hit twice, took 0 repair; an off-footprint ally whose shield was
 *    destroyed got 0 Defense Up II. `onAllyShieldDestroyed.test.ts`'s "footprint gate: an AEGIS
 *    OUTSIDE the ally's support pattern never reacts" has been pinning that since SP-4b-1.
 *  - The ONE `target: 'enemy'` ability (the Stasis inflictor) had a real, user-visible gap: its
 *    recipient is the ENEMY, so no recipient-side narrowing could ever scope its trigger. It
 *    reacted to a Stealthed ally standing anywhere on the owner's side. §4 measures it: 6 Stasis
 *    applications before, 4 after, on a board whose off-pattern ally is hit twice.
 *
 * So the trigger-axis gate CLOSES one gap and RE-STATES three at the layer the clause actually
 * names. §5 and §6 therefore assert behaviour that was already correct — they are labelled as such
 * and are here because a family rule needs a per-trigger-type, per-arm pin at the production layer,
 * not because they were red.
 *
 * ── FALLBACKS (each pinned, each a mutation tripwire) ────────────────────────────────────────────
 *  - resolver ABSENT (no positional view supplied at all) → gate NOT satisfied. Conservative, like
 *    `statusNamesOf`/`roleOf`; a pattern gate that silently opened where the resolver is unwired
 *    would restore the defect it closes.
 *  - resolver RETURNS `undefined` (no active SUPPORT pattern / non-positional board) → pass
 *    through. A real answer, not an omission — and required by the owner ruling recorded at
 *    supportRecipients.ts ("`undefined` means DO NOT NARROW … do not split it into two outcomes").
 *
 * ── OWNER INCLUSION ─────────────────────────────────────────────────────────────────────────────
 * The shield-destroyed reaction deliberately fires on the owner's OWN destroyed shield. No special
 * case is needed or added: every non-`Not-Self` support pattern covers its own origin cell, so the
 * owner is in its own footprint and passes the same membership test as any ally. §3 pins that.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { registerReactiveListeners, type Intent, type ReactiveAbility } from '../triggers';
import { supportFootprintAllyIds } from '../supportFootprint';
import { runCombat, type CombatEngineInput, type TeamActorEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { parsePattern } from '../../targetingParser';
import type { Ability, AbilityTrigger, ShipSkills } from '../../../types/abilities';
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

/** The two triggers that carry an AFFECTED-ALLY axis and therefore consult the new gate. */
const AFFECTED_ALLY_TRIGGERS: AbilityTrigger[] = ['on-ally-attacked', 'on-ally-shield-destroyed'];

const shipOf = (name: string): Ship => {
    const s = buildTraceShip(name);
    if (!s) throw new Error(`${name} missing from the corpus`);
    return s;
};

/** Every ability PRODUCTION builds for `name` at the default refit (4), flattened over slots. */
const builtAbilities = (name: string): Ability[] =>
    buildShipAbilities(shipOf(name)).slots.flatMap((s) => s.abilities);

/** The `patternScoped` reactives `name` carries on an affected-ally trigger, as built. */
const scopedAffectedAllyReactives = (name: string): Ability[] =>
    builtAbilities(name).filter(
        (a) =>
            a.patternScoped === true &&
            a.trigger !== undefined &&
            AFFECTED_ALLY_TRIGGERS.includes(a.trigger)
    );

/** A ship's REAL active pattern string from the data snapshot — the footprint every fixture below
 *  resolves through the PRODUCTION resolver rather than hand-listing cells. */
const realPattern = (name: string): ParsedPattern => {
    const raw = shipOf(name).activePattern;
    if (!raw) throw new Error(`${name} has no activePattern column`);
    const parsed = parsePattern(raw);
    if (!parsed) throw new Error(`${name}'s activePattern ${raw} did not parse`);
    return parsed;
};

/** The production footprint answer for `owner` anchored at `anchor` over `cells`. Used both to
 *  build the listener fixtures' resolver and to assert the engine fixtures' geometry, so a change
 *  to the offset tables breaks a PRECONDITION instead of silently invalidating an arm. */
const footprintOver = (
    name: string,
    anchor: Position,
    cells: Record<string, Position>
): string[] => {
    const ids = supportFootprintAllyIds({
        pattern: realPattern(name),
        anchor,
        sameSideLiving: Object.entries(cells).map(
            ([id, position]) => ({ id, position, currentHp: 1 }) as unknown as CombatActor
        ),
    });
    if (ids === undefined) throw new Error(`${name}'s pattern is not a support pattern`);
    return ids;
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §1 — SCOPE. The family is exactly four abilities on three ships, and nothing else is touched.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('#363 pattern-scoped reactive family — scope', () => {
    it('exactly four corpus reactives carry `patternScoped` on an affected-ally trigger', () => {
        const found: string[] = [];
        for (const rec of loadShipSkillRecords()) {
            const ship = buildTraceShip(rec.name);
            if (!ship) continue;
            for (const a of buildShipAbilities(ship).slots.flatMap((s) => s.abilities)) {
                if (
                    a.patternScoped === true &&
                    a.trigger !== undefined &&
                    AFFECTED_ALLY_TRIGGERS.includes(a.trigger)
                ) {
                    found.push(`${rec.name}|${a.trigger}|${a.target}|${a.config.type}`);
                }
            }
        }
        // PRECONDITION: the sweep really walked the corpus (a zero-ship sweep would make the
        // equality below vacuously satisfiable by an empty list).
        expect(loadShipSkillRecords().length).toBeGreaterThan(140);
        expect(found.sort()).toEqual([
            'AEGIS|on-ally-shield-destroyed|ally|buff',
            'AEGIS|on-ally-shield-destroyed|ally|cleanse',
            'Cultivator|on-ally-attacked|ally|heal',
            'Fuying|on-ally-attacked|enemy|debuff',
        ]);
    });

    it('a `patternScoped` reactive on a trigger with NO affected-ally axis is untouched', () => {
        // Graphite's start-of-round ally charge grant is `patternScoped` too, but its clause scopes
        // its RECIPIENTS, not a triggering ally — there is no affected ally for the new gate to
        // read. It must stay outside the family, or the gate would start deciding a question the
        // trigger cannot even ask.
        const charge = builtAbilities('Graphite').find((a) => a.config.type === 'charge');
        expect(charge?.patternScoped).toBe(true);
        expect(charge?.trigger).toBe('start-of-round');
        expect(AFFECTED_ALLY_TRIGGERS).not.toContain(charge!.trigger);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §2 — LISTENER GATE, `on-ally-attacked`. Per-affected-ally attribution with the REAL abilities.
//
// This is the only layer that can attribute a decision to ONE ally: the engine boards in §4–§6
// aggregate several simultaneous victims of a single AoE.
//
// The geometry is not invented. `PLAYER_CELLS` is a real board; the resolver handed to the listener
// is the PRODUCTION `supportFootprintAllyIds` answer for the ship's REAL pattern at `OWNER_CELL`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const OWNER_CELL: Position = 'T2';
/** The owner sits at T2; three allies sit along row M. Which of them the owner reaches is the
 *  production resolver's answer, asserted per ship in the PRECONDITION tests below. */
const PLAYER_CELLS: Record<string, Position> = {
    'ally-m3': 'M3',
    'ally-m2': 'M2',
    'ally-m1': 'M1',
};

type ListenerOpts = {
    ability: Ability;
    /** The ally whose damage / shield loss the event reports. */
    affectedId: string;
    /** Absent models "no positional view supplied at all" (the conservative arm). */
    footprintAllyIdsFor?: (ownerId: string) => string[] | undefined;
    statusNamesOf?: (actorId: string) => string[];
    /** 'enemy' flips which side the owner sits on (team-symmetry check). */
    ownerSide?: 'player' | 'enemy';
    /** Which event to emit. */
    event: 'attacked' | 'shield-destroyed';
};

const OWNER_ID = 'owner';

/** A hand bus + one owner, returning the intents a single event enqueues. */
function enqueuedFor(opts: ListenerOpts): Intent[] {
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
    // Owner and allies on ONE side, the striker on the other. Flipping `ownerSide` flips only which
    // label `isOpposing` calls opposing — the same closure, no mirrored code.
    const ownerSideIds = new Set([OWNER_ID, ...Object.keys(PLAYER_CELLS), 'ally-elsewhere']);
    registerReactiveListeners({
        bus: handBus,
        perOwner: [{ ownerId: OWNER_ID, reactiveAbilities: [ra] }],
        enqueue: (intent) => enqueued.push(intent),
        isOpposing:
            opts.ownerSide === 'enemy'
                ? (id: string) => !ownerSideIds.has(id)
                : (id: string) => id === 'striker',
        ...(opts.statusNamesOf ? { statusNamesOf: opts.statusNamesOf } : {}),
        ...(opts.footprintAllyIdsFor ? { footprintAllyIdsFor: opts.footprintAllyIdsFor } : {}),
    });
    handBus.emit(
        opts.event === 'attacked'
            ? {
                  type: 'attacked',
                  targetId: opts.affectedId,
                  attackerId: 'striker',
                  round: 1,
                  damage: 1000,
              }
            : { type: 'shield-destroyed', victimId: opts.affectedId, round: 1 }
    );
    return enqueued;
}

/** Every ally in `PLAYER_CELLS` holds Stealth — the Stasis reactive's OTHER gate (Task 8), which
 *  must be satisfied for this task's arms to be about the FOOTPRINT and nothing else. */
const allStealthed = () => (): string[] => ['Stealth'];

describe('#363 on-ally-attacked — the affected ally must stand in the active pattern', () => {
    // The reactive that had the real gap (recipient = the enemy) and the one that did not
    // (recipient = the ally), driven through the SAME listener gate.
    const stasis = (): Ability => {
        const a = scopedAffectedAllyReactives('Fuying').find((x) => x.config.type === 'debuff');
        if (!a) throw new Error('Fuying built no pattern-scoped Stasis reactive');
        return a;
    };
    const repair = (): Ability => {
        const a = scopedAffectedAllyReactives('Cultivator').find((x) => x.config.type === 'heal');
        if (!a) throw new Error('Cultivator built no pattern-scoped repair reactive');
        return a;
    };

    const cases: { label: string; ship: string; ability: () => Ability }[] = [
        { label: 'Stasis inflictor (target: enemy)', ship: 'Fuying', ability: stasis },
        { label: 'ally repair (target: ally)', ship: 'Cultivator', ability: repair },
    ];

    for (const c of cases) {
        describe(c.label, () => {
            const footprint = () => footprintOver(c.ship, OWNER_CELL, PLAYER_CELLS);
            const resolver = () => (): string[] => footprint();
            // Both arms need a Stealthed ally for the Stasis reactive's Task-8 gate; harmless for
            // the repair, which carries no status gate.
            const statuses = allStealthed();

            it('PRECONDITION: real ability, real trigger, real geometry — and the event IS accepted', () => {
                const ab = c.ability();
                expect(ab.patternScoped).toBe(true);
                expect(ab.trigger).toBe('on-ally-attacked');
                // The production resolver really splits this board into inside/outside allies. If
                // an offset table changed and every ally fell inside (or outside), both arms below
                // would be measuring nothing.
                const inside = footprint();
                expect(inside.length).toBeGreaterThan(0);
                expect(inside.length).toBeLessThan(Object.keys(PLAYER_CELLS).length);
                expect(inside).toContain('ally-m2');
                expect(inside).not.toContain('ally-m1');
                // Same event, `patternScoped` stripped → it DOES enqueue. So every zero below is
                // this gate's doing and not an event the listener scoped away for another reason.
                const unscoped: Ability = { ...ab };
                delete unscoped.patternScoped;
                expect(
                    enqueuedFor({
                        ability: unscoped,
                        affectedId: 'ally-m1',
                        event: 'attacked',
                        footprintAllyIdsFor: resolver(),
                        statusNamesOf: statuses,
                    })
                ).toHaveLength(1);
            });

            it('ARM A — a damaged ally INSIDE the footprint DOES trigger the reaction', () => {
                expect(footprint()).toContain('ally-m2'); // precondition, per-arm
                expect(
                    enqueuedFor({
                        ability: c.ability(),
                        affectedId: 'ally-m2',
                        event: 'attacked',
                        footprintAllyIdsFor: resolver(),
                        statusNamesOf: statuses,
                    })
                ).toHaveLength(1);
            });

            it('ARM B — a damaged ally OUTSIDE the footprint does NOT trigger it', () => {
                expect(footprint()).not.toContain('ally-m1'); // precondition, per-arm
                expect(
                    enqueuedFor({
                        ability: c.ability(),
                        affectedId: 'ally-m1',
                        event: 'attacked',
                        footprintAllyIdsFor: resolver(),
                        statusNamesOf: statuses,
                    })
                ).toEqual([]);
            });

            it('gates an ENEMY-side owner identically (team symmetry — one closure, no side branch)', () => {
                // Same ability, same resolver, same ids; only which side `isOpposing` calls
                // opposing changes. Both arms must answer exactly as above.
                expect(
                    enqueuedFor({
                        ability: c.ability(),
                        affectedId: 'ally-m2',
                        event: 'attacked',
                        footprintAllyIdsFor: resolver(),
                        statusNamesOf: statuses,
                        ownerSide: 'enemy',
                    })
                ).toHaveLength(1);
                expect(
                    enqueuedFor({
                        ability: c.ability(),
                        affectedId: 'ally-m1',
                        event: 'attacked',
                        footprintAllyIdsFor: resolver(),
                        statusNamesOf: statuses,
                        ownerSide: 'enemy',
                    })
                ).toEqual([]);
            });

            it('an owner whose footprint CANNOT be resolved never satisfies the gate (conservative)', () => {
                // MUTATION TRIPWIRE (a): making the resolver-absent fallback permissive reopens the
                // defect wherever the resolver is not wired.
                expect(
                    enqueuedFor({
                        ability: c.ability(),
                        affectedId: 'ally-m2', // an ally that WOULD be inside, so this is the fallback
                        event: 'attacked',
                        statusNamesOf: statuses,
                    })
                ).toEqual([]);
            });

            it('an owner with NO active support pattern narrows nothing (resolver answers undefined)', () => {
                // The other half of the two-answer contract: `undefined` is a real answer meaning
                // "there is no footprint here", and the owner ruling at supportRecipients.ts
                // forbids splitting it. So the reaction keeps its legacy team-wide reach — which is
                // exactly what `footprintFilteredRecipients` does with the same value.
                expect(
                    enqueuedFor({
                        ability: c.ability(),
                        affectedId: 'ally-m1',
                        event: 'attacked',
                        footprintAllyIdsFor: () => undefined,
                        statusNamesOf: statuses,
                    })
                ).toHaveLength(1);
            });
        });
    }

    it('INERTNESS — a reactive WITHOUT `patternScoped` is completely unaffected', () => {
        // Graphite's role-filtered ally reaction names no pattern, so it must fire with no resolver
        // wired at all — which is what keeps every pre-#363 ally reaction byte-identical. Both a
        // real corpus ability and the deliberate negative (an inside ally) are checked.
        const graphite = builtAbilities('Graphite').find(
            (a) => a.trigger === 'on-ally-attacked' && a.patternScoped !== true
        );
        expect(graphite, 'Graphite built no un-scoped on-ally-attacked reactive').toBeDefined();
        expect(graphite!.patternScoped).toBeUndefined();
        // No resolver, and an ally that no footprint would contain → still fires.
        expect(
            enqueuedFor({
                ability: { ...graphite!, roleFilter: undefined },
                affectedId: 'ally-elsewhere',
                event: 'attacked',
            })
        ).toHaveLength(1);
        // And with a resolver that excludes it → still fires. The gate is opt-in, not ambient.
        expect(
            enqueuedFor({
                ability: { ...graphite!, roleFilter: undefined },
                affectedId: 'ally-elsewhere',
                event: 'attacked',
                footprintAllyIdsFor: () => ['ally-m2'],
            })
        ).toHaveLength(1);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §3 — LISTENER GATE, `on-ally-shield-destroyed`. Both AEGIS abilities, plus the owner-self case.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('#363 on-ally-shield-destroyed — the affected unit must stand in the active pattern', () => {
    const aegisReactives = () => scopedAffectedAllyReactives('AEGIS');
    /** The owner sits at M2; its own cell is part of its cone, so it is in its own footprint. */
    const CELLS_WITH_OWNER: Record<string, Position> = { ...PLAYER_CELLS, [OWNER_ID]: 'M2' };
    const footprint = () => footprintOver('AEGIS', 'M2', CELLS_WITH_OWNER);
    const resolver = () => (): string[] => footprint();

    it('PRECONDITION: two real reactives, the real trigger, and a board the pattern really splits', () => {
        const abs = aegisReactives();
        expect(abs.map((a) => a.config.type).sort()).toEqual(['buff', 'cleanse']);
        for (const a of abs) {
            expect(a.patternScoped).toBe(true);
            expect(a.trigger).toBe('on-ally-shield-destroyed');
        }
        const inside = footprint();
        expect(inside).toContain('ally-m3'); // M3 is in the cone from M2
        expect(inside).toContain(OWNER_ID); // the owner's own cell is in its own footprint
        expect(inside).not.toContain('ally-m1'); // M1 is not
    });

    for (const kind of ['buff', 'cleanse'] as const) {
        const ability = () => {
            const a = aegisReactives().find((x) => x.config.type === kind);
            if (!a) throw new Error(`AEGIS built no ${kind} reactive`);
            return a;
        };

        describe(`the ${kind} reaction`, () => {
            it('PRECONDITION: the same event with `patternScoped` stripped DOES enqueue', () => {
                const unscoped: Ability = { ...ability() };
                delete unscoped.patternScoped;
                expect(
                    enqueuedFor({
                        ability: unscoped,
                        affectedId: 'ally-m1',
                        event: 'shield-destroyed',
                        footprintAllyIdsFor: resolver(),
                    })
                ).toHaveLength(1);
            });

            it('ARM A — a shield destroyed INSIDE the footprint DOES trigger it', () => {
                expect(
                    enqueuedFor({
                        ability: ability(),
                        affectedId: 'ally-m3',
                        event: 'shield-destroyed',
                        footprintAllyIdsFor: resolver(),
                    })
                ).toHaveLength(1);
            });

            it('ARM B — a shield destroyed OUTSIDE the footprint does NOT trigger it', () => {
                expect(
                    enqueuedFor({
                        ability: ability(),
                        affectedId: 'ally-m1',
                        event: 'shield-destroyed',
                        footprintAllyIdsFor: resolver(),
                    })
                ).toEqual([]);
            });

            it("the OWNER's OWN destroyed shield still self-reacts (no special case needed)", () => {
                // The pre-existing rule this must not break: a support pattern centred on the owner
                // covers the owner's own cell, so it passes the ordinary membership test.
                expect(footprint()).toContain(OWNER_ID);
                expect(
                    enqueuedFor({
                        ability: ability(),
                        affectedId: OWNER_ID,
                        event: 'shield-destroyed',
                        footprintAllyIdsFor: resolver(),
                    })
                ).toHaveLength(1);
            });

            it('an owner whose footprint CANNOT be resolved never satisfies the gate (conservative)', () => {
                expect(
                    enqueuedFor({
                        ability: ability(),
                        affectedId: 'ally-m3',
                        event: 'shield-destroyed',
                    })
                ).toEqual([]);
            });

            it('an owner with NO active support pattern narrows nothing (resolver answers undefined)', () => {
                expect(
                    enqueuedFor({
                        ability: ability(),
                        affectedId: 'ally-m1',
                        event: 'shield-destroyed',
                        footprintAllyIdsFor: () => undefined,
                    })
                ).toHaveLength(1);
            });

            it('gates an ENEMY-side owner identically (team symmetry)', () => {
                expect(
                    enqueuedFor({
                        ability: ability(),
                        affectedId: 'ally-m3',
                        event: 'shield-destroyed',
                        footprintAllyIdsFor: resolver(),
                        ownerSide: 'enemy',
                    })
                ).toHaveLength(1);
                expect(
                    enqueuedFor({
                        ability: ability(),
                        affectedId: 'ally-m1',
                        event: 'shield-destroyed',
                        footprintAllyIdsFor: resolver(),
                        ownerSide: 'enemy',
                    })
                ).toEqual([]);
            });
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §4 — ENGINE, the Stasis inflictor on a REAL board. THIS is the arm that was red before the fix.
//
// Geometry (the proven board from fuyingStasisStealthGate.integration.test.ts):
//   The owner is the FOCUS at T2 with her real Wings-Support-Not-Self-Range-2 pattern
//     → support footprint {M2, M3, B1, B2, B3}: ally-m3 and ally-m2 inside, ally-m1 OUTSIDE.
//   The enemy fires Line-Range-2 from row M and anchors on the front-most M-row player. M4 is
//     empty, so that is ally-m3, and the line extends back through M2 and M1 — one attack, three
//     victims, over two rounds.
//   Every ally holds Stealth for all 99 turns, satisfying the OTHER gate on this reactive (Task 8)
//     so this board measures the FOOTPRINT and nothing else. All-Stealthed (rather than
//     some-Stealthed) also keeps the positional stealth filter from moving the enemy's anchor.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const HUGE_HP = 1_000_000_000;
const ENEMY_ATTACK = 5000;

const lineRange2 = (): ParsedPattern => ({
    raw: 'Pattern-Line-Range-2',
    shape: 'line',
    range: 2,
    modifiers: {},
});
const frontTarget = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
const backTarget = (): ParsedTarget => ({ raw: 'back', side: 'enemy', selection: 'back' });
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const inertWalkStats = (hp: number) => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    hacking: 0,
    defence: 0,
    hp,
});

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

const lineEnemy = (id: string) => ({
    id,
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
    position: 'M1' as Position,
    target: frontTarget(),
    pattern: lineRange2(),
});

/** A focus board: the named ship's ONE pattern-scoped reactive in its passive slot, its real
 *  pattern, at `OWNER_CELL`; three harmless allies along row M; one line-attacking enemy. */
const focusBoard = (opts: {
    ship: string;
    ability: Ability;
    allyStatus: string;
    hacking?: number;
    /** Snapshot self-buffs on the FOCUS. Used to hand the Stasis board's owner her own Stealth:
     *  the positional stealth filter drops Stealthed cells from an enemy's candidate list UNLESS
     *  every candidate is Stealthed, so leaving the owner un-Stealthed while all three allies are
     *  Stealthed makes the owner the only pickable target and NO ally is ever hit — which is
     *  exactly how this board first came back with zero ally hits. */
    focusSelfBuffs?: CombatEngineInput['selfBuffs'];
}): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    hacking: opts.hacking ?? 0,
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
    position: OWNER_CELL,
    pattern: realPattern(opts.ship),
    selfBuffs: opts.focusSelfBuffs ?? [],
    shipSkills: {
        slots: [{ slot: 'passive', abilities: [opts.ability] } as ShipSkills['slots'][number]],
    },
    teamActors: Object.entries(PLAYER_CELLS).map(([id, cell]) =>
        buffedAlly(id, cell, opts.allyStatus)
    ),
    enemyAttackers: [lineEnemy('enemy-1')],
});

describe('#363 engine — the Stasis inflictor reacts only to hits inside its pattern', () => {
    const stasisAbility = () => {
        const a = scopedAffectedAllyReactives('Fuying').find((x) => x.config.type === 'debuff');
        if (!a) throw new Error('Fuying built no pattern-scoped Stasis reactive');
        return a;
    };

    const run = () => {
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
            if (e.targetId in PLAYER_CELLS) allyHits.push(e.targetId);
        });
        bus.on('debuff-applied', (e) => {
            if (e.buffName === 'Stasis' && e.sourceId === 'attacker') stasis.push(e.targetId);
        });
        runCombat({
            ...focusBoard({
                ship: 'Fuying',
                ability: stasisAbility(),
                allyStatus: 'Stealth',
                hacking: 2000, // she has to actually LAND the Stasis for the arm to be observable
                // Her own Stealth, so EVERY player cell is Stealthed and the enemy's ordinary
                // front-to-back line selection is restored (see focusSelfBuffs). Her pattern is
                // Not-Self so she can never self-cast it, and the enemy's line from row M never
                // reaches T2, so her own cell is never an ally-hit victim.
                focusSelfBuffs: [
                    {
                        id: 'owner-stealth-snapshot',
                        buffName: 'Stealth',
                        stacks: 1,
                        parsedEffects: {},
                        isStackable: false,
                    },
                ],
            }),
            bus,
        });
        return { granted, direct, allyHits, stasis };
    };

    const result = run();
    const inside = () => footprintOver('Fuying', OWNER_CELL, PLAYER_CELLS);

    it('PRECONDITION: every ally really holds Stealth, so this board measures the FOOTPRINT', () => {
        // The vacuity trap this branch shipped twice: an arm that passes because the watched ally
        // never held the status the OTHER gate on this ability requires.
        for (const id of Object.keys(PLAYER_CELLS)) {
            expect(result.granted.get(id), `${id} was granted nothing`).toBeDefined();
            expect([...result.granted.get(id)!]).toContain('Stealth');
        }
    });

    it('PRECONDITION: every ally — the off-pattern one INCLUDED — really was directly hit', () => {
        for (const id of Object.keys(PLAYER_CELLS)) {
            expect(result.direct.get(id), `${id} took no direct damage`).toBeGreaterThan(0);
        }
        expect(result.allyHits.length).toBe(6); // 3 victims × 2 rounds, one line attack each
    });

    it('PRECONDITION: the production resolver puts two allies inside the pattern and one outside', () => {
        expect(inside().sort()).toEqual(['ally-m2', 'ally-m3']);
    });

    it('ARM A — hits on the two allies INSIDE the pattern DO inflict Stasis, on the enemy', () => {
        expect(result.stasis.length).toBeGreaterThan(0);
        expect([...new Set(result.stasis)]).toEqual(['enemy-1']);
    });

    it('ARM B — the hits on the ally OUTSIDE the pattern inflict nothing (the closed gap)', () => {
        // Before the fix this board produced 6 applications — one per ally hit, the off-pattern
        // ally's two included. After it, exactly the 4 hits on the two in-pattern allies react.
        const insideIds = new Set(inside());
        const insideHits = result.allyHits.filter((id) => insideIds.has(id));
        const outsideHits = result.allyHits.filter((id) => !insideIds.has(id));
        expect(outsideHits.length).toBeGreaterThan(0); // there WERE hits to over-fire on
        expect(insideHits.length).toBe(4);
        expect(result.stasis.length).toBe(insideHits.length);
        expect(result.stasis.length).toBeLessThan(result.allyHits.length);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §5 — ENGINE, the ally repair on a REAL board.
//
// ⚠️ These two arms were ALREADY GREEN before this task: the repair targets the affected ally, so
// `footprintFilteredRecipients` intersected `[damagedAllyId]` with the same footprint and an
// off-pattern ally already received nothing. They are here because the family rule needs a
// production-layer both-arm pin per trigger type, and because they are the regression fence for
// the visible half of this behaviour — real HP on real allies.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('#363 engine — the ally repair reaches only allies inside its pattern', () => {
    const repairAbility = () => {
        const a = scopedAffectedAllyReactives('Cultivator').find((x) => x.config.type === 'heal');
        if (!a) throw new Error('Cultivator built no pattern-scoped repair reactive');
        return a;
    };

    const run = () => {
        const bus = createEventBus();
        const healed = new Map<string, number>();
        const allyHits: string[] = [];
        bus.on('reactive-heal-performed', (e) => {
            for (const p of e.perTarget ?? [])
                healed.set(p.targetId, (healed.get(p.targetId) ?? 0) + p.amount);
        });
        bus.on('attacked', (e) => {
            if (e.damage !== undefined && e.targetId in PLAYER_CELLS) allyHits.push(e.targetId);
        });
        runCombat({
            ...focusBoard({
                ship: 'Cultivator',
                ability: repairAbility(),
                allyStatus: 'Barrier', // no status gate on this reactive; an inert self-buff
            }),
            bus,
        });
        return { healed, allyHits };
    };

    const result = run();
    // Cultivator's real pattern is Circle-Support-Range-1; from T2 that covers M2 and M3.
    const inside = () => footprintOver('Cultivator', OWNER_CELL, PLAYER_CELLS);

    it('PRECONDITION: every ally was hit, and the resolver splits them 2 inside / 1 outside', () => {
        expect(result.allyHits.length).toBe(6);
        for (const id of Object.keys(PLAYER_CELLS)) {
            expect(result.allyHits, `${id} was never hit`).toContain(id);
        }
        expect(inside().sort()).toEqual(['ally-m2', 'ally-m3']);
    });

    it('ARM A — allies INSIDE the pattern are repaired', () => {
        for (const id of inside()) {
            expect(result.healed.get(id), `${id} inside the pattern got no repair`).toBeGreaterThan(
                0
            );
        }
    });

    it('ARM B — the ally OUTSIDE the pattern is not repaired at all', () => {
        expect(result.healed.get('ally-m1')).toBeUndefined();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §6 — ENGINE, the shield-destroyed reactions on a REAL board.
//
// ⚠️ As with §5, both arms were already green (the buff and the cleanse both target the affected
// ally). The value here is the production-layer pin per trigger type, and the owner-self arm.
//
// Geometry: the reacting supporter sits at M2 with its real Prolonged_Cone-Support-Range-2 pattern
// → footprint {M2, T2, M3, M4, B2}. `ally-in` (M3) is inside it, `ally-out` (M1) is not. Two
// single-target enemies, one aimed front and one aimed back, destroy both allies' shields.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('#363 engine — the shield-destroyed reactions reach only units inside the pattern', () => {
    const SHIELD_HP = 100_000;
    const AEGIS_CELL: Position = 'M2';
    const SHIELD_CELLS: Record<string, Position> = { 'ally-in': 'M3', 'ally-out': 'M1' };

    const noopActive = (): Ability => ({
        id: 'noop',
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier: 0 },
    });
    const hit = (): Ability => ({
        id: 'hit',
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier: 100 },
    });
    const preCombatShield = (): Ability => ({
        id: 'pre-shield',
        type: 'shield',
        target: 'self',
        trigger: 'pre-combat',
        conditions: [],
        config: { type: 'shield', pct: 100, basis: 'hp' },
    });

    const teamActor = (
        id: string,
        position: Position,
        abilities: Ability[],
        pattern: ParsedPattern
    ): TeamActorEngineInput =>
        ({
            id,
            speed: 1,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            position,
            target: frontTarget(),
            pattern,
            walk: {
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [noopActive()] },
                        { slot: 'passive', abilities },
                    ],
                },
                stats: inertWalkStats(SHIELD_HP),
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: false,
            },
        }) as unknown as TeamActorEngineInput;

    const breaker = (id: string, position: Position, target: ParsedTarget) => ({
        id,
        stats: {
            attack: SHIELD_HP,
            crit: 0,
            critDamage: 0,
            defence: 0,
            security: 0,
            hp: HUGE_HP,
            speed: 500,
        },
        chargeCount: 0,
        startCharged: false,
        position,
        target,
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active', abilities: [hit()] }] },
    });

    /** `ownerShielded` swaps to the owner-self variant: the reacting supporter is the ONLY team
     *  actor and carries its own pre-combat shield, so the single breaker's `front` pick lands on
     *  it. (Keeping the two shielded allies on the board makes them the front/back picks and the
     *  owner's own shield is never touched — the first version of this fixture failed exactly
     *  there, which is why the destroyed-shield precondition below is asserted, not assumed.) */
    const run = (opts: { ownerShielded: boolean }) => {
        const bus = createEventBus();
        const buffed: string[] = [];
        const destroyed: string[] = [];
        bus.on('buff-applied', (e) => {
            if (e.buffName === 'Defense Up II') buffed.push(e.actorId);
        });
        bus.on('shield-destroyed', (e) => destroyed.push(e.victimId));
        const aegisAbilities = scopedAffectedAllyReactives('AEGIS');
        runCombat({
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            chargeCount: 0,
            numRounds: 1,
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
            speed: 2,
            mode: 'battle',
            // The focus sits out of the way at B4 so the enemies' front/back picks land on the
            // shielded allies, never on it.
            position: 'B4',
            target: frontTarget(),
            pattern: basePattern(),
            selfBuffs: [],
            shipSkills: { slots: [{ slot: 'active', abilities: [noopActive()] }] },
            teamActors: [
                teamActor(
                    OWNER_ID,
                    AEGIS_CELL,
                    opts.ownerShielded
                        ? [...aegisAbilities, preCombatShield()]
                        : [...aegisAbilities],
                    realPattern('AEGIS')
                ),
                ...(opts.ownerShielded
                    ? []
                    : Object.entries(SHIELD_CELLS).map(([id, cell]) =>
                          teamActor(id, cell, [preCombatShield()], basePattern())
                      )),
            ],
            enemyAttackers: opts.ownerShielded
                ? [breaker('breaker-front', 'M1', frontTarget())]
                : [
                      breaker('breaker-front', 'M1', frontTarget()),
                      breaker('breaker-back', 'M3', backTarget()),
                  ],
            bus,
        } as unknown as CombatEngineInput);
        return { buffed, destroyed };
    };

    const result = run({ ownerShielded: false });
    const inside = () =>
        footprintOver('AEGIS', AEGIS_CELL, { ...SHIELD_CELLS, [OWNER_ID]: AEGIS_CELL });

    it('PRECONDITION: BOTH allies really had their shield destroyed, and the pattern splits them', () => {
        // The `undefined === undefined` trap: without this, ARM B would pass on an ally whose
        // shield was never destroyed at all.
        for (const id of Object.keys(SHIELD_CELLS)) {
            expect(result.destroyed, `${id}'s shield was never destroyed`).toContain(id);
        }
        expect(inside()).toContain('ally-in');
        expect(inside()).toContain(OWNER_ID);
        expect(inside()).not.toContain('ally-out');
    });

    it('ARM A — the ally INSIDE the pattern is granted Defense Up II', () => {
        expect(result.buffed).toContain('ally-in');
    });

    it('ARM B — the ally OUTSIDE the pattern is granted nothing', () => {
        expect(result.buffed).not.toContain('ally-out');
    });

    it("the owner's OWN destroyed shield still self-reacts on a real board", () => {
        const self = run({ ownerShielded: true });
        expect(self.destroyed, "the owner's own shield was never destroyed").toContain(OWNER_ID);
        expect(self.buffed).toContain(OWNER_ID);
    });
});
