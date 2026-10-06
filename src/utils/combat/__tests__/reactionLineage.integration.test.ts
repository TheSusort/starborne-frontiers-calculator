/**
 * The lineage rule (owner ruling, measured in game 2026-10-06; `reactionKey` in triggers.ts): a
 * passive never fires on an event that its OWN earlier firing caused, directly or through other
 * reactions, and it still fires once for each separate event.
 *
 *  - Fight 6: an enemy Purifier R4 ("When directly damaged this Unit cleanses 2 debuffs") holding
 *    debuffs is hit → his passive cleanses 2 → Grif ("When an enemy cleanses a debuff, this Unit
 *    deals 75% damage") hits him → his passive does NOT cleanse again. On his own turn his active
 *    cleanses 1 → Grif hits him → his passive cleanses 2: a new chain rooted in his cast.
 *  - Fight 1: Provider ("When another ally inflicts a debuff onto an enemy, deals 50% damage")
 *    hits twice off APEX's one active landing two debuffs — two separate events.
 *  - Two opposing Nuqtus stop answering each other's buff gains.
 *
 * Real parsed kits (buildTraceShip) narrowed to the slots each case needs; the attacker and the
 * opening buff are hand-built. Run with the subject on the player side and on the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { reactionChainProbe } from '../triggers';
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
import type { CombatActor } from '../state';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => {
    setupKeyedRng(5);
    reactionChainProbe.maxDepth = 0;
    reactionChainProbe.dropped = 0;
    reactionChainProbe.lineageDropped = 0;
});

/** `ship`'s real kit at `refitLevel`, narrowed to `slots` (an empty active is kept so the unit
 *  still takes its turns). */
const kit = (ship: string, refitLevel: RefitLevel, slots: SkillSlot[]): ShipSkills => {
    const built = buildTraceShip(ship, { refitLevel });
    if (!built) throw new Error(`${ship} missing from reference data`);
    const full = buildShipAbilities(built);
    const narrowed = full.slots.filter((s) => slots.includes(s.slot));
    return {
        ...full,
        slots: narrowed.some((s) => s.slot === 'active')
            ? narrowed
            : [{ slot: 'active', abilities: [] }, ...narrowed],
    };
};

/** Events bucketed by the turn they happened in. */
interface Turn {
    actorId: string;
    /** Debuffs each of Purifier's passive cleanses removed. */
    passiveCleanses: number[];
    /** Debuffs each of Purifier's cast cleanses removed. */
    castCleanses: number[];
    /** `sourceId → count` of reactive hits. */
    hits: Record<string, number>;
    /** `actorId → count` of Core Charge I grants. */
    coreCharges: Record<string, number>;
}

const runTurns = (
    input: ReturnType<typeof boardInput>['input'],
    tap?: (all: CombatActor[]) => void
): Turn[] => {
    const turns: Turn[] = [];
    const current = (): Turn => {
        if (turns.length === 0) throw new Error('an event before the first turn');
        return turns[turns.length - 1];
    };
    const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);
    const bus = createEventBus();
    bus.on('turn-started', (e: Extract<CombatEvent, { type: 'turn-started' }>) => {
        turns.push({
            actorId: e.actorId,
            passiveCleanses: [],
            castCleanses: [],
            hits: {},
            coreCharges: {},
        });
    });
    bus.on(
        'reactive-cleanse-performed',
        (e: Extract<CombatEvent, { type: 'reactive-cleanse-performed' }>) => {
            current().passiveCleanses.push(e.perTarget.reduce((n, t) => n + t.count, 0));
        }
    );
    bus.on('cleanse-performed', (e: Extract<CombatEvent, { type: 'cleanse-performed' }>) => {
        current().castCleanses.push(e.count);
    });
    bus.on(
        'reactive-damage-performed',
        (e: Extract<CombatEvent, { type: 'reactive-damage-performed' }>) => {
            bump(current().hits, e.sourceId);
        }
    );
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (e.buffName === 'Core Charge I') bump(current().coreCharges, e.actorId);
    });
    runCombat({ ...input, bus, ...(tap ? { __testTapActors: tap } : {}) });
    return turns;
};

const turnOf = (turns: Turn[], actorId: string): Turn => {
    const found = turns.filter((t) => t.actorId === actorId);
    expect(found).toHaveLength(1);
    return found[0];
};

const SEEDED_DEBUFFS = 6;

describe.each<Placement>(['player', 'enemy'])('subject on the %s side', (placement) => {
    it('Fight 6: Purifier cleanses once per chain; Grif hits once per chain', () => {
        const attacker: BoardUnit = {
            id: 'hitter',
            kit: hitKit(100),
            position: 'M4',
            speed: 300,
            attack: 100,
        };
        const grif: BoardUnit = {
            id: 'grif',
            kit: kit('Grif', 4, ['passive']),
            position: 'M3',
            speed: 1,
            attack: 100,
        };
        const purifier: BoardUnit = {
            id: 'purifier',
            kit: kit('Purifier', 4, ['active', 'passive']),
            position: 'M4',
            speed: 200,
            hp: 1e9,
        };
        const { input, id } = boardInput(placement, attacker, [grif], [purifier], 1);
        let actors: CombatActor[] = [];
        const turns = runTurns(input, (all) => {
            actors = all;
            const p = all.find((a) => a.id === id(purifier))!;
            for (let i = 0; i < SEEDED_DEBUFFS; i++)
                p.corrosionEntries.push({ stacks: 1, tier: 1, remainingRounds: 9, sourceId: 'x' });
        });

        // The attacker's hit: Purifier's passive cleanses 2, Grif answers once, and Grif's hit
        // does not wake the passive again although 4 debuffs remain.
        const hitTurn = turnOf(turns, id(attacker));
        expect(hitTurn.passiveCleanses).toEqual([2]);
        expect(hitTurn.hits).toEqual({ [id(grif)]: 1 });

        // Purifier's own turn: his active cleanses 1, Grif answers, and Grif's hit wakes the
        // passive — it is not in this chain yet — which cleanses 2. Grif does not answer that.
        const ownTurn = turnOf(turns, id(purifier));
        expect(ownTurn.castCleanses).toEqual([1]);
        expect(ownTurn.passiveCleanses).toEqual([2]);
        expect(ownTurn.hits).toEqual({ [id(grif)]: 1 });

        // 6 − 2 − 1 − 2.
        const p = actors.find((a) => a.id === id(purifier))!;
        expect(p.corrosionEntries.reduce((n, e) => n + e.stacks, 0)).toBe(1);
        expect(reactionChainProbe.dropped).toBe(0);
    });

    it("Fight 1: Provider answers each of APEX's two debuffs — siblings both fire", () => {
        const apex: BoardUnit = {
            id: 'apex',
            kit: kit('APEX', 0, ['active']),
            position: 'M4',
            speed: 300,
            attack: 1000,
            hacking: 1e6,
        };
        const provider: BoardUnit = {
            id: 'provider',
            kit: kit('Provider', 4, ['passive']),
            position: 'M3',
            speed: 200,
            attack: 1000,
            hacking: 1e6,
        };
        const enemy: BoardUnit = { id: 'victim', kit: NO_KIT, position: 'M4', speed: 1 };
        const { input, id } = boardInput(placement, apex, [provider], [enemy], 1);
        const turns = runTurns(input);
        expect(turnOf(turns, id(apex)).hits).toEqual({ [id(provider)]: 2 });
    });

    it('two opposing Nuqtus answer each other a bounded number of times', () => {
        // Nuqtu R4 parses to two abilities on "when an enemy gains a buff": Terran Bolster III and
        // Core Charge I. A buffer beside Nuqtu A gains Attack Up II:
        //  - B's two abilities answer it → B: 1 Core Charge, and two buff gains (TB, CC).
        //  - A's two abilities answer each of those two → A: 2 Core Charge, four buff gains.
        //  - For each of those four, B's ability that started that branch is in its lineage and
        //    stays silent; B's OTHER ability answers → B: 2 more Core Charge (3 in all), whose
        //    own buff gains A answers only with the ability not yet in that branch → A: 2 more
        //    (4 in all). Every branch then holds all four abilities, and the chain ends.
        // Per-(owner, ability) lineage is unconfirmed; keyed per owner instead, the same board
        // stops after A's first answer (B 1, A 2 — measured 2026-10-06).
        const selfBuff: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'self-buff',
                            type: 'buff',
                            target: 'self',
                            trigger: 'on-cast',
                            conditions: [],
                            config: {
                                type: 'buff',
                                buffName: 'Attack Up II',
                                parsedEffects: { attack: 20 },
                                stacks: 1,
                                isStackable: false,
                                duration: 2,
                            },
                        },
                    ],
                },
            ],
        };
        const nuqtuA: BoardUnit = {
            id: 'nuqtu-a',
            kit: kit('Nuqtu', 4, ['passive']),
            position: 'M4',
            speed: 2,
        };
        const buffer: BoardUnit = { id: 'buffer', kit: selfBuff, position: 'M3', speed: 300 };
        const nuqtuB: BoardUnit = {
            id: 'nuqtu-b',
            kit: kit('Nuqtu', 4, ['passive']),
            position: 'M4',
            speed: 1,
        };
        const { input, id } = boardInput(placement, nuqtuA, [buffer], [nuqtuB], 1);
        const turns = runTurns(input);
        expect(turnOf(turns, id(buffer)).coreCharges).toEqual({
            [id(nuqtuA)]: 4,
            [id(nuqtuB)]: 3,
        });
        // The chain ends on the lineage rule, not on the depth cap.
        expect(reactionChainProbe.lineageDropped).toBeGreaterThan(0);
        expect(reactionChainProbe.dropped).toBe(0);
    });
});
