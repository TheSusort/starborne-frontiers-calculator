import React, { useState } from 'react';
import { Ship } from '../../types/ship';
import { ShipSkills } from '../../types/abilities';
import { DefenseShipConfig, DefenseBuffTotals, SelectedGameBuff } from '../../types/calculator';
import { computeBuffedStats } from '../../utils/calculators/defenseCalculator';
import { DefenseSurvivabilityResult } from '../../utils/calculators/defenseSurvivabilitySim';
import { ShipSelector } from '../ship/ShipSelector';
import { CloseIcon } from '../ui';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { CollapsibleForm } from '../ui/layout/CollapsibleForm';
import { ChevronDownIcon } from '../ui/icons/ChevronIcons';
import { useShips } from '../../contexts/ShipsContext';
import { getSkillRowForSlot } from '../../utils/ship/skillRows';
import { SkillSlotList } from '../skills/SkillSlotList';
import { GameBuffPicker } from './GameBuffPicker';

interface DefenseShipCardProps {
    config: DefenseShipConfig;
    isBest: boolean;
    isComparing: boolean;
    /** The winning config's `damageAbsorbed` — the RANKING axis, so "Compared to best" measures the
     *  same quantity that chose "best" (finding I3). Undefined when nothing was measured. */
    bestDamageAbsorbed?: number;
    /** The configured length of the fight. Needed because `result.elapsedRounds` can be SHORTER
     *  than this on a survivor: a high-attack defender that wipes the enemy roster ends the fight
     *  early (#329), so "Survived all N rounds" would misreport the window. */
    rounds: number;
    /** True when the user has configured NO enemy attackers. The engine still runs the window
     *  against one inert, KILLABLE practice target, so an early finish here was not "the enemy team
     *  was wiped" — there was no enemy team. Without this the card named a roster the user never
     *  created, directly contradicting the page's own "nothing is being thrown at these ships"
     *  notice sitting above it. */
    noEnemiesConfigured?: boolean;
    buffTotals?: DefenseBuffTotals;
    /** The engine-measured survivability figure (Task 2's boundary). A LOWER BOUND when
     *  `survived` is true — see the render below for why survivors and casualties must never
     *  read as the same kind of number. */
    result?: DefenseSurvivabilityResult;
    onRemove: () => void;
    onUpdate: (field: 'name' | 'hp' | 'defense' | 'security', value: string | number) => void;
    onSelectShip: (ship: Ship) => void;
    onBuffsChange: (buffs: SelectedGameBuff[]) => void;
    onShipSkillsChange: (shipSkills: ShipSkills) => void;
}

export const DefenseShipCard: React.FC<DefenseShipCardProps> = ({
    config,
    isBest,
    isComparing,
    bestDamageAbsorbed,
    rounds,
    noEnemiesConfigured = false,
    buffTotals,
    result,
    onRemove,
    onUpdate,
    onSelectShip,
    onBuffsChange,
    onShipSkillsChange,
}) => {
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const { getShipById } = useShips();
    const selectedShip = config.shipId ? getShipById(config.shipId) : undefined;
    // Show the Passive slot whenever the ship has passive skill text to read/edit — not only
    // when the parser auto-filled abilities. Defensive/repair passives (e.g. Anemone) parse to
    // nothing but still need the Edit button so users can read and add abilities manually.
    const hasPassive =
        config.shipSkills.slots.some((s) => s.slot === 'passive') ||
        (selectedShip ? !!getSkillRowForSlot(selectedShip, 'passive') : false);

    const hasBuffs =
        (buffTotals?.defenseBuff ?? 0) !== 0 ||
        (buffTotals?.incomingDamageBuff ?? 0) !== 0 ||
        (buffTotals?.securityBuff ?? 0) !== 0;
    const { buffedDefense, damageReduction, effectiveHP, buffedSecurity } = computeBuffedStats(
        config.hp,
        config.defense,
        config.security,
        buffTotals
    );

    return (
        <div className={`card relative ${isBest ? 'border-primary' : ''}`}>
            <div className="mb-4">
                <ShipSelector
                    selected={selectedShip ?? null}
                    onSelect={onSelectShip}
                    variant="compact"
                />
            </div>
            <div className="flex justify-between items-center mb-4">
                <Input
                    value={config.name}
                    onChange={(e) => onUpdate('name', e.target.value)}
                    className="font-bold"
                />
                <Button variant="danger" onClick={onRemove} aria-label="Remove ship">
                    <CloseIcon />
                </Button>
            </div>

            <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                    <Input
                        label="HP"
                        type="number"
                        value={config.hp}
                        onChange={(e) => onUpdate('hp', parseInt(e.target.value) || 0)}
                    />
                    <Input
                        label="Defense"
                        type="number"
                        value={config.defense}
                        onChange={(e) => onUpdate('defense', parseInt(e.target.value) || 0)}
                    />
                    <Input
                        label="Security"
                        type="number"
                        value={config.security}
                        onChange={(e) => onUpdate('security', parseInt(e.target.value) || 0)}
                    />
                </div>

                <Button
                    variant="link"
                    onClick={() => setAdvancedOpen((v) => !v)}
                    className="w-full flex justify-between items-center mt-4"
                >
                    <span className="flex items-center gap-2">
                        <ChevronDownIcon
                            className={`text-sm text-theme-text-secondary h-8 w-8 p-2 transition-transform duration-300 ${advancedOpen ? 'rotate-180' : ''}`}
                        />
                        {advancedOpen ? 'Hide' : 'Show'} Advanced
                    </span>
                </Button>

                <CollapsibleForm isVisible={advancedOpen}>
                    <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">
                        Skills
                    </div>
                    <SkillSlotList
                        shipSkills={config.shipSkills}
                        hasPassive={hasPassive}
                        ship={selectedShip}
                        onChange={onShipSkillsChange}
                    />

                    <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">
                        Ship Buffs
                    </div>
                    <GameBuffPicker
                        label="Ship Buffs"
                        relevantStats={['defense', 'incomingDamage', 'security']}
                        excludeTypes={['effect']}
                        value={config.buffs}
                        onChange={onBuffsChange}
                        noEffectLabel="No defensive effect"
                    />
                </CollapsibleForm>

                {result && (
                    <div className="mt-4 pt-4 border-t border-dark-border">
                        {/* #358 ADDENDUM 3 (C1): the three headline numbers, in the owner's order —
                            ROUNDS SURVIVED first, DAMAGE ABSORBED second, and the static estimate
                            third (rendered just below this block, labelled "Theoretical EHP").
                            Rounds lead because the absorbed figure moves in whole HITS — never by
                            the amount a reduction shaves off each one — so it needs the round count
                            beside it to be read at all.
                            NOT "two ships that die on the same round report the same number", which
                            this comment used to claim: that holds only where a round IS one hit.
                            Under TWO attackers a tankier ship can survive attacker 1's hit and eat
                            attacker 2's before dying on the same round (the fight ends with the turn
                            that destroys it, #329), absorbing one extra hit. MEASURED, hp 100,000 /
                            defence 5,000 / two 40,000-attack enemies: 280,000 plain vs 320,000 with
                            Defense Up II, both destroyed round 4 — pinned as "SAME ROUND, DIFFERENT
                            FIGURE" in defenseSurvivabilitySim.test.ts. */}
                        <div className="flex justify-between items-baseline">
                            <span className="text-theme-text-secondary">
                                Rounds survived:
                                {/* #358 finding M7: NOT "how long the ship lasted" — a
                                    casualty's `elapsedRounds` IS the round it died in, so a ship
                                    destroyed on round 5 reads "5" here and "Destroyed round 5"
                                    below, having survived four. "Rounds in the fight" is true of
                                    both a casualty and a survivor. */}
                                <span className="block text-xs">
                                    rounds the ship was in the fight
                                </span>
                            </span>
                            <span className="text-right">
                                <span className={isBest ? 'text-primary font-bold' : 'font-bold'}>
                                    {result.elapsedRounds}
                                </span>
                                <span className="block text-xs">
                                    {result.survived ? (
                                        /* #358 finding I5: a survivor's `elapsedRounds` is NOT
                                           always the configured window. Roster-wipe termination
                                           (#329) ends the fight at the end of the round that wipes
                                           a side, so a high-attack defender can finish on round 6
                                           of a 20-round setting — "Survived all 6 rounds" against a
                                           20-round window read as a bug. Two such survivors also
                                           absorb DIFFERENT totals, so the "survivors tie" reading
                                           holds only for the full-window case. */
                                        result.elapsedRounds < rounds ? (
                                            <span className="text-green-400">
                                                Still standing —{' '}
                                                {noEnemiesConfigured
                                                    ? 'this ship destroyed the inert practice target'
                                                    : 'the enemy team was wiped'}{' '}
                                                on round {result.elapsedRounds} of {rounds}, so the
                                                fight ended early
                                            </span>
                                        ) : (
                                            <span className="text-green-400">
                                                Survived all {rounds} rounds — a lower bound, not a
                                                limit
                                            </span>
                                        )
                                    ) : (
                                        <span className="text-red-500">
                                            Destroyed round {result.destroyedRound}
                                        </span>
                                    )}
                                </span>
                            </span>
                        </div>
                        <div className="flex justify-between items-baseline mt-2">
                            <span className="text-theme-text-secondary">
                                Damage absorbed:
                                <span className="block text-xs">
                                    everything thrown at it, before its own reductions
                                </span>
                            </span>
                            <span className="text-right">
                                <span className={isBest ? 'text-primary font-bold' : 'font-bold'}>
                                    {Math.round(result.damageAbsorbed).toLocaleString()}
                                </span>
                                <span className="block text-xs text-theme-text-secondary">
                                    over {result.elapsedRounds}{' '}
                                    {result.elapsedRounds === 1 ? 'round' : 'rounds'}
                                </span>
                            </span>
                        </div>
                        {/* #358 finding I3: the delta is on the RANKING axis. It used to be
                            computed on Theoretical EHP while `isBest` was decided on
                            `damageAbsorbed`, so a not-best card could print a POSITIVE percentage
                            in the same hardcoded red as a negative one. Rendered only when there
                            is a non-zero best to compare against — with the default empty enemy
                            roster every config absorbs 0 and the ratio would be 0/0. */}
                        {isComparing &&
                            !isBest &&
                            bestDamageAbsorbed !== undefined &&
                            bestDamageAbsorbed > 0 && (
                                <div className="flex justify-between mt-2 text-sm">
                                    <span className="text-theme-text-secondary">
                                        Compared to best:
                                    </span>
                                    {(() => {
                                        // `bestDamageAbsorbed` is the MAXIMUM on this axis by
                                        // construction (it is the winning config's own figure, and
                                        // key 1 of the ranking ladder is this same quantity), so
                                        // the delta is never positive on a not-best card. Only two
                                        // tones, therefore — a `> 0` green arm here would be dead
                                        // code that read as a guard.
                                        const deltaPct =
                                            ((result.damageAbsorbed - bestDamageAbsorbed) /
                                                bestDamageAbsorbed) *
                                            100;
                                        return (
                                            <span
                                                className={
                                                    deltaPct < 0
                                                        ? 'text-red-500'
                                                        : 'text-theme-text-secondary'
                                                }
                                            >
                                                {deltaPct.toFixed(2)}%
                                            </span>
                                        );
                                    })()}
                                </div>
                            )}
                        {result.survived && (
                            <div className="text-xs mt-1 text-theme-text-secondary">
                                On a survivor this is a property of the ATTACKERS, not the ship —
                                raise enemy attack or rounds until ships die before comparing.
                            </div>
                        )}
                        {/* DIFFERENT AXIS. The four terms below partition what actually ARRIVED
                            (post defence mitigation); the headline above is what was THROWN. They
                            do not sum, so the sub-total is labelled and shown explicitly rather
                            than left for the reader to infer. */}
                        <div className="mt-3 text-xs text-theme-text-secondary space-y-1">
                            <div className="flex justify-between border-b border-dark-border pb-1">
                                <span className="uppercase tracking-wide">
                                    Reached the ship (after its reductions)
                                </span>
                                <span>{Math.round(result.breakdown.gross).toLocaleString()}</span>
                            </div>
                            {/* #358 ADDENDUM 3 (Part B, finding 6): Math.round, like the headline
                                above and the `gross` sub-total. These are engine floats; raw
                                `.toLocaleString()` printed "To hull 24,999.667" under a clean
                                "30,000" on any fixture where defence bit. */}
                            <div className="flex justify-between">
                                <span>To hull</span>
                                <span>{Math.round(result.breakdown.toHp).toLocaleString()}</span>
                            </div>
                            {result.breakdown.toShield > 0 && (
                                <div className="flex justify-between">
                                    <span>Absorbed by shield</span>
                                    <span>
                                        {Math.round(result.breakdown.toShield).toLocaleString()}
                                    </span>
                                </div>
                            )}
                            {result.breakdown.toBarrier > 0 && (
                                <div className="flex justify-between">
                                    <span>Blocked by Barrier</span>
                                    <span>
                                        {Math.round(result.breakdown.toBarrier).toLocaleString()}
                                    </span>
                                </div>
                            )}
                            {result.breakdown.toConversion > 0 && (
                                <div className="flex justify-between">
                                    <span>Converted to shield</span>
                                    <span>
                                        {Math.round(result.breakdown.toConversion).toLocaleString()}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div className="mt-4 pt-4 border-t border-dark-border">
                    {/* #358 ADDENDUM 3 (C1 §3): the THIRD headline number, and the name says what it
                        is. "Formula EHP" read like a peer of the measured figures; it is not — it is
                        a hangar-stats ESTIMATE that never sees a shield, a Barrier, a conditional
                        gate or an enemy. Sits directly under Rounds survived / Damage absorbed so
                        the three read in the owner's order. */}
                    <div className="flex justify-between">
                        <span className="text-theme-text-secondary">Theoretical EHP:</span>
                        {/* #358 finding I3: NO `isBest` highlight here. `isBest` is decided on
                            `damageAbsorbed`; painting this figure primary implied it was the best
                            Theoretical EHP, which it need not be. The highlight lives on the two
                            measured headline figures above, which are what the badge ranks. */}
                        <span>{Math.round(effectiveHP).toLocaleString()}</span>
                    </div>
                    <div className="text-xs text-theme-text-secondary -mt-1 mb-3">
                        An estimate from hangar stats, not a measurement — HP and Defense only. It
                        ignores shields, Barrier, self-repair and conditional gating, and no enemy
                        ever fires at it. Prefer the measured figures above when one is available.
                    </div>
                    <div className="flex justify-between mb-2">
                        <span className="text-theme-text-secondary">Damage Reduction:</span>
                        <span>{damageReduction.toFixed(2)}%</span>
                    </div>
                    {hasBuffs && (
                        <div className="flex justify-between mb-2 text-sm">
                            <span className="text-theme-text-secondary">Buffed Defense:</span>
                            <span>{Math.round(buffedDefense).toLocaleString()}</span>
                        </div>
                    )}
                    <div className="flex justify-between mt-2">
                        <span className="text-theme-text-secondary">HP Multiplier:</span>
                        <span>{(effectiveHP / config.hp).toFixed(2)}x</span>
                    </div>
                    <div className="flex justify-between mt-2">
                        <span className="text-theme-text-secondary">Security:</span>
                        <span
                            className={
                                hasBuffs && (buffTotals?.securityBuff ?? 0) !== 0
                                    ? 'text-yellow-400'
                                    : ''
                            }
                        >
                            {Math.round(buffedSecurity).toLocaleString()}
                        </span>
                    </div>
                </div>

                {isBest && (
                    <div className="text-primary text-sm mt-2 text-center">
                        Best ship configuration
                    </div>
                )}
            </div>
        </div>
    );
};
