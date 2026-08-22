/**
 * #363 Gap 1 — Fuying's Stealth grant honours its Tianchao recipient scope.
 *
 * Her active reads "grants Tianchao allies Stealth for 1 turn", but the faction word was
 * discarded: the ability built with `target: 'all-allies'` and reached every ally. Stealth is a
 * TARGETING-IMMUNITY status, so the over-grant did not merely inflate a number — it made allies
 * unselectable who should be selectable.
 *
 * ⚠️ DELIBERATELY NO ASSERTION ABOUT FUYING'S OWN REACH. Nothing here asserts how MANY allies she
 * reaches, WHICH ones, or whether she is her own recipient. Those all depend on her support
 * footprint (`Pattern-Wings-Support-Not-Self-Range-2`), which is a SEPARATE axis owned by a
 * separate change — an assertion about it here would pass today and read as a regression caused by
 * that change tomorrow. What is pinned instead: the parser's answer, the built ability's
 * `factionFilter`, the pure resolver's intersection against a SYNTHETIC faction map, and (at the
 * engine level) a synthetic non-positional kit where NO footprint exists, so faction narrowing is
 * the only narrowing in play and cannot be confounded by anyone's pattern.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { detectGrantFactionScope } from '../../skillTextParser';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { resolveSupportRecipients } from '../supportRecipients';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { bareEnemy } from '../__testutils__/bareRosterFixture';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { BUFFS } from '../../../constants/buffs';
import type { FactionKey } from '../../../constants/factions';
import type { ShipSkills } from '../../../types/abilities';

// `docs/` is gitignored reference data and a fresh worktree does not have it. Without this guard
// the file fails to COLLECT rather than reporting a readable skip reason — copy the pattern from
// realKitFingerprints.test.ts:41.
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
const fuyingShip = () => {
    const s = buildTraceShip('Fuying');
    if (!s) throw new Error('Fuying missing from the corpus');
    return s;
};

const FUYING_ACTIVE =
    'This Unit <unit-aid>cleanses 1 debuff</unit-aid>, grants ' +
    '<unit-skill>Security Up III</unit-skill> for 2 turns and grants Tianchao allies ' +
    '<unit-skill>Stealth</unit-skill> for 1 turn.';

describe('Fuying faction-scoped Stealth grant (#363) — parser', () => {
    it('reads Tianchao off the RECIPIENT phrase', () => {
        expect(detectGrantFactionScope(FUYING_ACTIVE, 'Stealth')).toEqual(['TIANCHAO']);
    });

    it('does NOT read a faction out of a faction-NAMED buff', () => {
        // Anjian's shape: the faction word belongs to the buff name, not to a recipient.
        const anjian =
            'This Unit grants <unit-skill>Tianchao Precision I</unit-skill> for 2 turns.';
        expect(detectGrantFactionScope(anjian, 'Tianchao Precision I')).toBeUndefined();
    });

    it('does NOT read a faction-NAMED buff plus a team receiver as a faction scope', () => {
        // Los's shape: "XAOC Swiftness III" (a NAME) granted "to all allies" (a receiver). Both a
        // faction word and "allies" are present, but not ADJACENT — the discriminator this
        // detector rests on. Reading it as a scope would silence a real team-wide grant.
        const los =
            'This Unit grants <unit-skill>XAOC Swiftness III</unit-skill> to all allies for ' +
            '2 turns and deals <unit-damage>100%</unit-damage> damage.';
        expect(detectGrantFactionScope(los, 'XAOC Swiftness III')).toBeUndefined();
    });

    it('scopes to the buff’s OWN clause span, not the whole sentence', () => {
        // Fuying's sibling grant sits in the SAME sentence as the Tianchao one. Reading the whole
        // text (rather than `buffGrantSpan`'s span) would leak Tianchao onto it and silently mute
        // a grant that really does reach every ally.
        expect(detectGrantFactionScope(FUYING_ACTIVE, 'Security Up III')).toBeUndefined();
    });
});

describe('Fuying faction-scoped Stealth grant (#363) — build', () => {
    it('builds the Stealth grant with factionFilter, through PRODUCTION slot routing', () => {
        const built = buildShipAbilities(fuyingShip());
        const stealth = built.slots
            .flatMap((s) => s.abilities)
            .find((a) => a.config.type === 'buff' && a.config.buffName === 'Stealth');
        expect(stealth).toBeDefined();
        expect(stealth!.target).toBe('all-allies'); // unchanged — the target was never the bug
        expect(stealth!.factionFilter).toEqual(['TIANCHAO']);
    });

    it('leaves her co-cast Security Up III grant unfiltered', () => {
        const built = buildShipAbilities(fuyingShip());
        const security = built.slots
            .flatMap((s) => s.abilities)
            .find((a) => a.config.type === 'buff' && a.config.buffName === 'Security Up III');
        expect(security).toBeDefined();
        expect(security!.factionFilter).toBeUndefined();
    });
});

describe('Fuying faction-scoped Stealth grant (#363) — recipient resolution', () => {
    it('narrows recipients to the matching faction, and drops unknown-faction actors', () => {
        const factions: Record<string, FactionKey> = {
            fuying: 'TIANCHAO',
            anjian: 'TIANCHAO',
            grif: 'XAOC',
        };
        const got = resolveSupportRecipients({
            target: 'all-allies',
            casterId: 'fuying',
            baseRecipients: ['fuying', 'anjian', 'grif', 'manual'],
            factionFilter: ['TIANCHAO'],
            factionOf: (id) => factions[id],
        });
        // 'grif' is the wrong faction; 'manual' has NO faction and is dropped per the
        // owner-approved conservative rule (unknown never matches).
        expect(got).toEqual(['fuying', 'anjian']);
    });

    it('composes with footprint narrowing rather than replacing it', () => {
        // The pattern says which allies the cast reaches; the faction says which of those qualify.
        // A caller supplying BOTH must get the intersection, not either one alone.
        const factions: Record<string, FactionKey> = {
            a: 'TIANCHAO',
            b: 'TIANCHAO',
            c: 'XAOC',
        };
        expect(
            resolveSupportRecipients({
                target: 'all-allies',
                casterId: 'a',
                baseRecipients: ['a', 'b', 'c'],
                footprintAllyIds: ['b', 'c'], // 'a' is off-pattern
                factionFilter: ['TIANCHAO'],
                factionOf: (id) => factions[id],
            })
        ).toEqual(['b']);
    });

    it('matches nobody when a filter is present but no faction reader is', () => {
        // The conservative answer, and the same one an all-unknown roster gets: a filter with no
        // way to read factions must not silently degrade to "reach everyone".
        expect(
            resolveSupportRecipients({
                target: 'all-allies',
                casterId: 'a',
                baseRecipients: ['a', 'b'],
                factionFilter: ['TIANCHAO'],
            })
        ).toEqual([]);
    });

    it('is inert when no factionFilter is present', () => {
        const base = ['a', 'b', 'c'];
        expect(
            resolveSupportRecipients({
                target: 'all-allies',
                casterId: 'a',
                baseRecipients: base,
                factionOf: () => undefined,
            })
        ).toEqual(base);
    });

    it('treats an EMPTY factionFilter as absent (canonical-absent convention)', () => {
        const base = ['a', 'b', 'c'];
        expect(
            resolveSupportRecipients({
                target: 'all-allies',
                casterId: 'a',
                baseRecipients: base,
                factionFilter: [],
                factionOf: () => undefined,
            })
        ).toEqual(base);
    });
});

describe('Fuying faction-scoped Stealth grant (#363) — corpus inertness', () => {
    it('matches exactly the recipient-scoped clauses, and none of the faction-NAMED ones', () => {
        // Guards the ONE thing this detector must get right: a faction inside a buff NAME is not
        // a recipient scope. Measured over all 149 ships (2026-08-22): 4 recipient-scoped clauses
        // (Fuying's active Stealth grant + the three refit tiers of her damage-reduction aura,
        // which repeat the same "All Tianchao allies with Stealth" phrase) vs 31 clauses where a
        // faction word is part of a buff name. The task brief predicted 3/31+1 — it counted two
        // aura tiers where the corpus has three; the 35-clause total is the same either way.
        const scoped =
            loadShipSkillRecords()
                .flatMap((r) => [r.active, r.charge, ...r.passives])
                .join('\n')
                .match(
                    /\b(?:Tianchao|XAOC|Binderburg|Everliving|Gelecek|Marauders|MPL|Atlas Syndicate|Frontier Legion|Terran Combine)\s+all(?:y|ies)\b/gi
                ) ?? [];
        expect(scoped).toHaveLength(4);
    });

    it('fires on Fuying alone across all 149 ships', () => {
        // The end the previous test cannot reach: that the DETECTOR (not just the phrase) is inert
        // for the other 148 ships. Every (row, buff-name) pair in the corpus, exactly the pairs
        // `mergeBuff` puts through it in production.
        const hits: string[] = [];
        for (const record of loadShipSkillRecords()) {
            for (const text of [record.active, record.charge, ...record.passives]) {
                if (!text) continue;
                for (const buff of BUFFS) {
                    if (!text.includes(buff.name)) continue;
                    if (detectGrantFactionScope(text, buff.name)) {
                        hits.push(`${record.name}:${buff.name}`);
                    }
                }
            }
        }
        expect([...new Set(hits)]).toEqual(['Fuying:Stealth']);
    });
});

// ---------------------------------------------------------------------------
// Engine wiring — SYNTHETIC kit, no positions, no patterns.
//
// Why synthetic rather than Fuying herself: with no `position`/`pattern` anywhere, the engine's
// support footprint is `undefined` ("do not narrow"), so the faction intersection is the ONLY
// narrowing in play. A test built on Fuying's real kit would instead measure her footprint AND her
// faction scope at once — and would move the moment either axis changed. This one measures the
// engine THREADING (`factionByActorId` → `buildTurnArgs` → `runPlayerTurn` → the per-slot timed
// status's own `factionFilter`) and nothing else.
// ---------------------------------------------------------------------------

const factionScopedGrantKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'fs-scoped',
                    type: 'buff',
                    target: 'all-allies',
                    trigger: 'on-cast',
                    conditions: [],
                    factionFilter: ['TIANCHAO'],
                    config: {
                        type: 'buff',
                        buffName: 'Stealth',
                        parsedEffects: {},
                        stacks: 1,
                        isStackable: false,
                        duration: 1,
                    },
                },
                {
                    id: 'fs-open',
                    type: 'buff',
                    target: 'all-allies',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'buff',
                        buffName: 'Security Up III',
                        parsedEffects: {},
                        stacks: 1,
                        isStackable: false,
                        duration: 2,
                    },
                },
            ],
        },
    ],
});

const inertWalkStats = (hp: number) => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    hacking: 0,
    defence: 0,
    hp,
});

/** Enemy-attacker stats are a DIFFERENT shape from walk stats (`speed` is required here and
 *  `defensePenetration` is not part of it) — vitest cannot tell them apart, only `tsc` can. */
const inertEnemyStats = (hp: number) => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    speed: 1,
    hacking: 0,
    defence: 0,
    hp,
});

const inertAlly = (id: string, faction?: FactionKey) => ({
    id,
    speed: 1,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    ...(faction ? { faction } : {}),
    walk: {
        shipSkills: { slots: [] },
        stats: inertWalkStats(500_000),
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

function recipientsOf(
    buffsApplied: Extract<CombatEvent, { type: 'buff-applied' }>[],
    name: string
) {
    return [
        ...new Set(buffsApplied.filter((e) => e.buffName === name).map((e) => e.actorId)),
    ].sort();
}

function runAndCollectBuffs(input: CombatEngineInput) {
    const bus = createEventBus();
    const buffsApplied: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
    bus.on('buff-applied', (e) => buffsApplied.push(e));
    runCombat({ ...input, bus });
    return buffsApplied;
}

const BASE_FOCUS = (): CombatEngineInput => ({
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: factionScopedGrantKit(),
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
    hp: 1_000_000,
    enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
});

describe('Fuying faction-scoped Stealth grant (#363) — engine wiring', () => {
    it('a PLAYER caster’s faction-scoped grant lands only on same-faction allies', () => {
        const buffs = runAndCollectBuffs({
            ...BASE_FOCUS(),
            faction: 'TIANCHAO',
            teamActors: [
                inertAlly('ally-tianchao', 'TIANCHAO'),
                inertAlly('ally-xaoc', 'XAOC'),
                inertAlly('ally-unknown'), // manual slot: no faction at all
            ],
        });
        // The unfiltered co-cast grant is the CONTROL: it proves the cast fired, reached every
        // ally, and that the faction filter — not some unrelated gate — is what removed the rest.
        // Without this the scoped assertion below could pass on a cast that never happened.
        expect(recipientsOf(buffs, 'Security Up III')).toEqual([
            'ally-tianchao',
            'ally-unknown',
            'ally-xaoc',
            'attacker',
        ]);
        // The scoped grant: the Tianchao ally AND the Tianchao caster; never the XAOC ally, never
        // the faction-less manual one (unknown never matches).
        expect(recipientsOf(buffs, 'Stealth')).toEqual(['ally-tianchao', 'attacker']);
    });

    it('an ENEMY caster’s faction-scoped grant narrows on its OWN side (team symmetry)', () => {
        // Combat-engine work in this project must be team-symmetric: `factionByActorId` is keyed
        // by actor id with no `side` branch, so the SAME kit on the enemy side must narrow the
        // same way against the enemy roster.
        const buffs = runAndCollectBuffs({
            ...BASE_FOCUS(),
            shipSkills: { slots: [] },
            enemyAttackers: [
                {
                    id: 'e-caster',
                    chargeCount: 0,
                    startCharged: false,
                    faction: 'TIANCHAO',
                    shipSkills: factionScopedGrantKit(),
                    stats: inertEnemyStats(10_000_000),
                },
                {
                    id: 'e-tianchao',
                    chargeCount: 0,
                    startCharged: false,
                    faction: 'TIANCHAO',
                    stats: inertEnemyStats(10_000_000),
                },
                {
                    id: 'e-xaoc',
                    chargeCount: 0,
                    startCharged: false,
                    faction: 'XAOC',
                    stats: inertEnemyStats(10_000_000),
                },
            ],
        });
        expect(recipientsOf(buffs, 'Security Up III')).toEqual([
            'e-caster',
            'e-tianchao',
            'e-xaoc',
        ]);
        expect(recipientsOf(buffs, 'Stealth')).toEqual(['e-caster', 'e-tianchao']);
    });
});
