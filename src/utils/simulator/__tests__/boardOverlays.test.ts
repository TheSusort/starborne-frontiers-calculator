import { describe, it, expect } from 'vitest';
import { overlaysForRound } from '../boardOverlays';
import type { BattleRound, BattleResult, ShipRoundState } from '../../calculators/battleSimulator';

const shipState = (over: Partial<ShipRoundState> & { actorId: string }): ShipRoundState => ({
    side: 'player',
    damageDealt: 0,
    damageTaken: 0,
    healingDone: 0,
    healingReceived: 0,
    shieldsAbsorbed: 0,
    shieldGranted: 0,
    currentShieldPool: 0,
    incomingDamage: 0,
    incomingShieldAbsorbed: 0,
    incomingBarrierAbsorbed: 0,
    hpPct: 100,
    alive: true,
    activeBuffs: [],
    activeDebuffs: [],
    ...over,
});

const roster: BattleResult['roster'] = [
    { actorId: 'attacker', side: 'player', name: 'Nova', position: 'T1' },
    { actorId: 'p:s2:1', side: 'player', name: 'Lyra', position: 'M2' },
    { actorId: 'e:s3:0', side: 'enemy', name: 'Hexa', position: 'T4' },
];

describe('overlaysForRound', () => {
    it('places a damaged player ship at its position with effect "damage"', () => {
        const round: BattleRound = {
            round: 1,
            ships: [
                shipState({ actorId: 'attacker', side: 'player', hpPct: 30, damageTaken: 500 }),
            ],
            turnOrder: [],
        };
        const overlays = overlaysForRound(round, 'player', roster);
        expect(overlays.T1).toMatchObject({
            actorId: 'attacker',
            name: 'Nova',
            hpPct: 30,
            alive: true,
            effect: 'damage',
        });
    });

    it('marks a dead ship alive:false', () => {
        const round: BattleRound = {
            round: 2,
            ships: [shipState({ actorId: 'attacker', side: 'player', hpPct: 0, alive: false })],
            turnOrder: [],
        };
        const overlays = overlaysForRound(round, 'player', roster);
        expect(overlays.T1?.alive).toBe(false);
    });

    it('uses effect "heal" when healingReceived > 0 and no damage taken', () => {
        const round: BattleRound = {
            round: 3,
            ships: [
                shipState({ actorId: 'attacker', side: 'player', healingReceived: 200, hpPct: 80 }),
            ],
            turnOrder: [],
        };
        const overlays = overlaysForRound(round, 'player', roster);
        expect(overlays.T1?.effect).toBe('heal');
    });

    it('prefers "damage" over "heal" when both occurred', () => {
        const round: BattleRound = {
            round: 4,
            ships: [
                shipState({
                    actorId: 'attacker',
                    side: 'player',
                    damageTaken: 100,
                    healingReceived: 200,
                }),
            ],
            turnOrder: [],
        };
        expect(overlaysForRound(round, 'player', roster).T1?.effect).toBe('damage');
    });

    it('leaves effect undefined when neither damage nor heal occurred', () => {
        const round: BattleRound = {
            round: 5,
            ships: [shipState({ actorId: 'attacker', side: 'player' })],
            turnOrder: [],
        };
        expect(overlaysForRound(round, 'player', roster).T1?.effect).toBeUndefined();
    });

    it('uses effect "shield" when shieldsAbsorbed > 0 and no damage or heal', () => {
        const round: BattleRound = {
            round: 7,
            ships: [shipState({ actorId: 'attacker', side: 'player', shieldsAbsorbed: 300 })],
            turnOrder: [],
        };
        expect(overlaysForRound(round, 'player', roster).T1?.effect).toBe('shield');
    });

    it('prefers "damage" over "shield" when both occurred', () => {
        const round: BattleRound = {
            round: 8,
            ships: [
                shipState({
                    actorId: 'attacker',
                    side: 'player',
                    damageTaken: 100,
                    shieldsAbsorbed: 300,
                }),
            ],
            turnOrder: [],
        };
        expect(overlaysForRound(round, 'player', roster).T1?.effect).toBe('damage');
    });

    it('prefers "heal" over "shield" when both occurred', () => {
        const round: BattleRound = {
            round: 9,
            ships: [
                shipState({
                    actorId: 'attacker',
                    side: 'player',
                    healingReceived: 200,
                    shieldsAbsorbed: 300,
                }),
            ],
            turnOrder: [],
        };
        expect(overlaysForRound(round, 'player', roster).T1?.effect).toBe('heal');
    });

    it('carries buffs and debuffs from the ship state', () => {
        const round: BattleRound = {
            round: 6,
            ships: [
                shipState({
                    actorId: 'attacker',
                    side: 'player',
                    activeBuffs: ['Attack Up'],
                    activeDebuffs: ['Defense Shred'],
                }),
            ],
            turnOrder: [],
        };
        const overlay = overlaysForRound(round, 'player', roster).T1;
        expect(overlay?.buffs).toEqual(['Attack Up']);
        expect(overlay?.debuffs).toEqual(['Defense Shred']);
    });

    it('filters to the requested side only (enemy)', () => {
        const round: BattleRound = {
            round: 1,
            ships: [
                shipState({ actorId: 'attacker', side: 'player', hpPct: 50 }),
                shipState({ actorId: 'e:s3:0', side: 'enemy', hpPct: 70 }),
            ],
            turnOrder: [],
        };
        const enemy = overlaysForRound(round, 'enemy', roster);
        expect(Object.keys(enemy)).toEqual(['T4']);
        expect(enemy.T4?.actorId).toBe('e:s3:0');
        const player = overlaysForRound(round, 'player', roster);
        expect(Object.keys(player).sort()).toEqual(['T1']);
    });

    it('skips a roster entry with no matching ship state', () => {
        const round: BattleRound = {
            round: 1,
            // Only one of two player ships has a state this round.
            ships: [shipState({ actorId: 'attacker', side: 'player' })],
            turnOrder: [],
        };
        const overlays = overlaysForRound(round, 'player', roster);
        expect(overlays.M2).toBeUndefined();
        expect(overlays.T1).toBeDefined();
    });
});
