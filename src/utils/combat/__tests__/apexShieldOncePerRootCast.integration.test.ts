/**
 * APEX's passive fires at most once per SKILL CAST that set the chain off, whoever cast it (owner
 * ruling, measured in game 2026-10-05; `Ability.oncePerRootCast`):
 *   "This Unit gains a shield equal to 3% of their max HP when an enemy gets inflicted with a
 *    debuff." (refit 0) — "If that enemy has 3 or more debuffs on a debuff infliction, this Unit
 *    inflicts Block Shield for 1 turn." (refit 4)
 *
 * In game, APEX + Provider against one enemy: APEX's active lands 2 debuffs and Provider's passive
 * answers each with Crit Rate Down II — ONE 3% shield for that whole cast. Provider's own active
 * then lands 2 debuffs — ONE more. Warden's on-hit reaction debuffs during an ENEMY's attack are
 * that enemy's cast — ONE shield for APEX. Block Shield follows the same cap, spent only when its
 * 3-debuff condition passes.
 *
 * Real parsed kits (buildTraceShip): APEX at refit 0 or 4, Provider and Warden at refit 4, cast
 * slots narrowed to the active so every turn is the same skill. Every landing roll lands (hacking
 * dwarfs security). Run with APEX on the player side and on the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildTraceShip, type RefitLevel } from '../../../../scripts/lib/traceShipFactory';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import {
    boardInput,
    hitKit,
    NO_KIT,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import type { ShipSkills, SkillSlot } from '../../../types/abilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(11));

/** `ship`'s real kit at `refitLevel`, narrowed to `slots`. */
const kit = (ship: string, refitLevel: RefitLevel, slots: SkillSlot[]): ShipSkills => {
    const built = buildTraceShip(ship, { refitLevel });
    if (!built) throw new Error(`${ship} missing from reference data`);
    const full = buildShipAbilities(built);
    const narrowed = full.slots.filter((s) => slots.includes(s.slot));
    // A unit with no active of its own still needs an (empty) active slot to take its turns.
    return {
        ...full,
        slots: narrowed.some((s) => s.slot === 'active')
            ? narrowed
            : [{ slot: 'active', abilities: [] }, ...narrowed],
    };
};

interface TurnRecord {
    actorId: string;
    /** APEX's shield grants during this turn. */
    shields: number;
    /** APEX's Block Shield landings during this turn. */
    blockShields: number;
    /** Every debuff landed on an opponent of APEX during this turn, as `inflictor:name`. */
    landed: string[];
}

/** Runs the board for `numRounds`, bucketing APEX's shields, her Block Shields and every debuff
 *  landed on her opponents by the turn they happened in. Anything before the first turn (start of
 *  round) lands in a `(round start)` bucket. */
const runTurns = (
    placement: Placement,
    apex: BoardUnit,
    allies: BoardUnit[],
    opponents: BoardUnit[],
    numRounds = 1
): { turns: TurnRecord[]; id: (u: BoardUnit) => string } => {
    const { input, id } = boardInput(placement, apex, allies, opponents, numRounds);
    const apexId = id(apex);
    const opponentIds = new Set(opponents.map(id));
    const turns: TurnRecord[] = [];
    const current = (): TurnRecord => {
        if (turns.length === 0)
            turns.push({ actorId: '(round start)', shields: 0, blockShields: 0, landed: [] });
        return turns[turns.length - 1];
    };
    const bus = createEventBus();
    bus.on('turn-started', (e: Extract<CombatEvent, { type: 'turn-started' }>) => {
        turns.push({ actorId: e.actorId, shields: 0, blockShields: 0, landed: [] });
    });
    bus.on('shield-applied', (e: Extract<CombatEvent, { type: 'shield-applied' }>) => {
        if (e.granterId === apexId && !e.uncast) current().shields += 1;
    });
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (!opponentIds.has(e.targetId)) return;
        current().landed.push(`${e.sourceId}:${e.buffName}`);
        if (e.sourceId === apexId && e.buffName === 'Block Shield') current().blockShields += 1;
    });
    bus.on('dot-applied', (e: Extract<CombatEvent, { type: 'dot-applied' }>) => {
        if (opponentIds.has(e.targetId)) current().landed.push(`${e.sourceId}:${e.dotType}`);
    });
    runCombat({ ...input, bus });
    return { turns, id };
};

const turnOf = (turns: TurnRecord[], actorId: string): TurnRecord => {
    const found = turns.filter((t) => t.actorId === actorId);
    expect(found).toHaveLength(1);
    return found[0];
};

/** APEX (fastest), Provider, then a lone enemy that does nothing. */
const apexProviderBoard = (placement: Placement, apexRefit: RefitLevel) => {
    const apex: BoardUnit = {
        id: 'apex',
        kit: kit('APEX', apexRefit, ['active', 'passive']),
        position: 'M4',
        speed: 300,
        attack: 1000,
        hacking: 1e6,
        hp: 100_000,
    };
    const provider: BoardUnit = {
        id: 'provider',
        kit: kit('Provider', 4, ['active', 'passive']),
        position: 'M3',
        speed: 200,
        attack: 1000,
        hacking: 1e6,
    };
    const enemy: BoardUnit = { id: 'victim', kit: NO_KIT, position: 'M4', speed: 1 };
    const { turns, id } = runTurns(placement, apex, [provider], [enemy]);
    return {
        apexTurn: turnOf(turns, id(apex)),
        providerTurn: turnOf(turns, id(provider)),
        enemyTurn: turnOf(turns, id(enemy)),
        turns,
        id: { apex: id(apex), provider: id(provider) },
    };
};

describe.each<Placement>(['player', 'enemy'])('APEX on the %s side', (placement) => {
    it('one cast plus the reactions it wakes → exactly one 3% shield', () => {
        const { apexTurn, id } = apexProviderBoard(placement, 0);
        // Instrument: APEX's active landed its two debuffs and Provider's passive answered with
        // Crit Rate Down II — four or more debuff landings, all inside APEX's turn.
        const own = apexTurn.landed.filter((l) => l.startsWith(`${id.apex}:`));
        const reactions = apexTurn.landed.filter((l) => l === `${id.provider}:Crit Rate Down II`);
        expect(own).toEqual([`${id.apex}:Speed Down II`, `${id.apex}:Crit Power Down III`]);
        expect(reactions.length).toBeGreaterThanOrEqual(1);
        expect(apexTurn.shields).toBe(1);
    });

    it("a second ship's cast in the same round → one more shield, not one per debuff", () => {
        const { providerTurn, enemyTurn, turns, id } = apexProviderBoard(placement, 0);
        expect(providerTurn.landed.filter((l) => l.startsWith(`${id.provider}:`))).toEqual([
            `${id.provider}:Hacking Down II`,
            `${id.provider}:Security Down I`,
        ]);
        expect(providerTurn.shields).toBe(1);
        // The enemy's turn lands nothing, so it gives nothing: the round's two shields are the
        // round's two inflicting casts — per cast, not per round.
        expect(enemyTurn.landed).toEqual([]);
        expect(turns.reduce((n, t) => n + t.shields, 0)).toBe(2);
    });

    it("an enemy's attack waking Warden's reaction debuffs → one shield on the enemy's turn", () => {
        const apex: BoardUnit = {
            id: 'apex',
            kit: kit('APEX', 0, ['passive']),
            position: 'M3',
            speed: 1,
            hacking: 1e6,
            hp: 100_000,
        };
        const warden: BoardUnit = {
            id: 'warden',
            kit: kit('Warden', 4, ['active', 'passive']),
            position: 'M4',
            speed: 2,
            hacking: 1e6,
        };
        const attacker: BoardUnit = {
            id: 'hitter',
            kit: hitKit(100),
            position: 'M4',
            speed: 300,
            attack: 1000,
        };
        const { turns, id } = runTurns(placement, apex, [warden], [attacker]);
        const enemyTurn = turnOf(turns, id(attacker));
        // The enemy acts first: nothing shielded APEX before its turn.
        expect(turns[0].actorId).toBe(id(attacker));
        // Instrument: Warden's on-hit Corrosion I and the Out. Damage Down II it wakes both landed
        // on the enemy during its own turn.
        expect(enemyTurn.landed).toEqual(
            expect.arrayContaining([`${id(warden)}:corrosion`, `${id(warden)}:Out. Damage Down II`])
        );
        expect(enemyTurn.shields).toBe(1);
    });

    it('Block Shield: once per cast, even when every landing of the cast qualifies', () => {
        const { apexTurn, providerTurn, id } = apexProviderBoard(placement, 4);
        // Instrument: the enemy reaches 3 debuffs inside APEX's turn (her two plus Provider's
        // Crit Rate Down II), and more qualifying landings follow in the same cast.
        expect(apexTurn.landed.length).toBeGreaterThanOrEqual(4);
        expect(apexTurn.blockShields).toBe(1);
        expect(apexTurn.shields).toBe(1);
        // Provider's own cast lands on an enemy already at 3 or more: one Block Shield for it
        // (whose landing Provider's passive then answers with a Crit Rate Down II).
        expect(providerTurn.landed).toEqual(
            expect.arrayContaining([
                `${id.provider}:Hacking Down II`,
                `${id.provider}:Security Down I`,
            ])
        );
        expect(providerTurn.blockShields).toBe(1);
        expect(providerTurn.shields).toBe(1);
    });
});
