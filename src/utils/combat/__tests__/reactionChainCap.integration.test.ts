/**
 * Chained reactions trigger (owner ruling 66), and the lineage rule ends every chain: a passive
 * never fires on an event its own earlier firing caused (`reactionKey` in triggers.ts, owner
 * ruling 2026-10-06). `MAX_REACTION_CHAIN_DEPTH` is only a safety net behind it, not a game rule
 * (owner ruling R91): the game has no chain limit, so the net sits far above any real chain. This
 * file pins that no board reaches the net (measured 2026-10-06, keyed per clause — see
 * `reactionKey`):
 *   - the real-kit fingerprint battles: deepest chain 1;
 *   - a board of reacting real kits (Purifier, Opal and Stalwart against Hemlock, Wrecker and
 *     Ravager, each named ship in turn as the subject, on both sides): deepest chain 1;
 *   - Nuqtu with Grif/Pestilence/Larkspur against Purifier, AEGIS, Nuqtu and Hermes, where the two
 *     opposing Nuqtus answer each other's buff gains: deepest chain 3, each side;
 *   - APEX with Provider/Opal/Shepherd against Provider/Opal/Shepherd/Warden, where every debuff
 *     wakes Provider's hit-and-debuff and APEX's Block Shield: deepest chain 4, each side.
 * The two loop boards also report lineage drops, so the rule — not a quiet board — is what ends
 * their chains.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
    corpusNames,
    buildScenarioBattle,
    scenariosFor,
    SEED,
} from '../audit/kitFingerprintScenarios';
import { runSeededBattle } from '../../simulator/seededRuns';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { MAX_REACTION_CHAIN_DEPTH, reactionChainProbe } from '../triggers';
import type { BattleSimulationInput } from '../../calculators/battleSimulator';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data)'
        );
    }
});

const place = (name: string, position: string): BattleSimulationInput['playerTeam'][number] => {
    const ship = buildTraceShip(name);
    if (!ship) throw new Error(`${name} missing from reference data`);
    const b = ship.baseStats;
    return {
        ship,
        position: position as BattleSimulationInput['playerTeam'][number]['position'],
        statOverrides: {
            attack: b.attack,
            crit: 50,
            critDamage: 50,
            hacking: b.hacking,
            security: b.security,
            defence: b.defence,
            hp: b.hp * 8,
            speed: b.speed,
        },
    };
};

/** `subject` at M4 with `allies`, against `enemies`; `mirror` swaps the sides. */
const board = (
    subject: string,
    allies: string[],
    enemies: string[],
    mirror: boolean
): BattleSimulationInput => {
    const sub = place(subject, 'M4');
    const al = allies.map((n, i) => place(n, ['T4', 'T2', 'B4'][i]));
    const en = enemies.map((n, i) => place(n, ['M3', 'M2', 'M1', 'T3'][i]));
    return mirror
        ? { playerTeam: en, enemyTeam: [sub, ...al], rounds: 20 }
        : { playerTeam: [sub, ...al], enemyTeam: en, rounds: 20 };
};

const probe = (input: BattleSimulationInput, seed: number) => {
    reactionChainProbe.maxDepth = 0;
    reactionChainProbe.dropped = 0;
    reactionChainProbe.lineageDropped = 0;
    runSeededBattle(input, seed);
    return { ...reactionChainProbe };
};

describe('the reaction-chain safety net', () => {
    it('is a backstop far above every measured chain, not a game rule (R91)', () => {
        expect(MAX_REACTION_CHAIN_DEPTH).toBe(64);
    });

    it('is never reached by the real-kit fingerprint battles', () => {
        const reached: string[] = [];
        for (const name of corpusNames()) {
            const ship = buildTraceShip(name)!;
            for (const scenario of scenariosFor(ship)) {
                const p = probe(buildScenarioBattle(ship, scenario), SEED);
                if (p.dropped > 0) reached.push(`${name}/${scenario}`);
            }
        }
        expect(reached).toEqual([]);
    }, 120_000);

    it('is never reached on a board of reacting real kits; chains settle by depth 1', () => {
        const allies = ['Hemlock', 'Wrecker', 'Ravager'];
        const enemies = ['Purifier', 'Bedrock', 'Opal', 'Stalwart'];
        const subjects = ['Chakara', 'Judge', 'Grif', 'Incinerator', 'Provider', 'Sentinel'];
        let deepest = 0;
        for (const subject of [...subjects, 'Stalwart', 'Nyxen', 'Tormenter']) {
            for (const mirror of [false, true]) {
                const p = probe(board(subject, allies, enemies, mirror), 1);
                expect(p.dropped, `${subject} mirror=${mirror}`).toBe(0);
                deepest = Math.max(deepest, p.maxDepth);
            }
        }
        expect(deepest).toBe(1);
    }, 120_000);

    it.each([false, true])(
        'the Nuqtu loop board ends on the lineage rule: Grif, Pestilence, Larkspur and Nuqtu against Purifier, AEGIS, Nuqtu, Hermes (mirror=%s)',
        (mirror) => {
            const p = probe(
                board(
                    'Nuqtu',
                    ['Grif', 'Pestilence', 'Larkspur'],
                    ['Purifier', 'AEGIS', 'Nuqtu', 'Hermes'],
                    mirror
                ),
                1
            );
            expect(p.lineageDropped).toBeGreaterThan(0);
            expect(p.maxDepth).toBe(3);
            expect(p.dropped).toBe(0);
        },
        60_000
    );

    it.each([false, true])(
        'the APEX debuff board ends on the lineage rule: APEX, Provider, Opal and Shepherd against Provider, Opal, Shepherd, Warden (mirror=%s)',
        (mirror) => {
            const p = probe(
                board(
                    'APEX',
                    ['Provider', 'Opal', 'Shepherd'],
                    ['Provider', 'Opal', 'Shepherd', 'Warden'],
                    mirror
                ),
                1
            );
            expect(p.lineageDropped).toBeGreaterThan(0);
            expect(p.maxDepth).toBe(4);
            expect(p.dropped).toBe(0);
        },
        60_000
    );
});
