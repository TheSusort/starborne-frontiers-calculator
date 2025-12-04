import React, { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { CloseIcon, PageLayout } from '../../components/ui';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';

interface BuffDebuff {
    value: number;
    description: string;
}

interface DamageDeconstructionForm {
    actualDamage: number;
    shipAttack: number;
    attackBuffs: BuffDebuff[];
    skillAttackPercent: number;
    isCrit: boolean;
    critDamagePercent: number;
    defensePenetration: number;
    outgoingDamageBuffs: BuffDebuff[];
    enemyDefenseBuffs: BuffDebuff[];
    enemyIncomingDamageBuffs: BuffDebuff[];
}

const DamageDeconstructionPage: React.FC = () => {
    const [form, setForm] = useState<DamageDeconstructionForm>({
        actualDamage: 0,
        shipAttack: 0,
        attackBuffs: [],
        skillAttackPercent: 0,
        isCrit: false,
        critDamagePercent: 0,
        defensePenetration: 0,
        outgoingDamageBuffs: [],
        enemyDefenseBuffs: [],
        enemyIncomingDamageBuffs: [],
    });

    const [results, setResults] = useState<{
        damageReduction: number;
        enemyDefense: number;
    } | null>(null);

    const addBuffDebuff = (
        type: keyof DamageDeconstructionForm,
        value: number,
        description: string
    ) => {
        setForm((prev) => ({
            ...prev,
            [type]: [...(prev[type] as BuffDebuff[]), { value, description }],
        }));
    };

    const removeBuffDebuff = (type: keyof DamageDeconstructionForm, index: number) => {
        setForm((prev) => ({
            ...prev,
            [type]: (prev[type] as BuffDebuff[]).filter((_: BuffDebuff, i: number) => i !== index),
        }));
    };

    const calculateDamage = () => {
        // Calculate base attack with buffs
        let totalAttack = form.shipAttack;
        // Sum all attack buffs first, then apply to base attack
        const attackBuffSum = form.attackBuffs.reduce((sum, buff) => sum + buff.value, 0);
        totalAttack *= 1 + attackBuffSum / 100;
        // Apply skill attack
        totalAttack *= form.skillAttackPercent / 100;
        // Apply crit if applicable
        if (form.isCrit) {
            totalAttack *= 1 + form.critDamagePercent / 100;
        }

        // Apply outgoing damage buffs
        const outgoingDamageBuffSum = form.outgoingDamageBuffs.reduce(
            (sum, buff) => sum + buff.value,
            0
        );
        totalAttack *= 1 + outgoingDamageBuffSum / 100;

        // Apply incoming damage buffs
        const incomingDamageBuffSum = form.enemyIncomingDamageBuffs.reduce(
            (sum, buff) => sum + buff.value,
            0
        );
        const incomingDamageMultiplier = 1 + incomingDamageBuffSum / 100;

        // Calculate the effective damage that would have been dealt without defense
        const effectiveDamage = totalAttack * incomingDamageMultiplier;

        // Calculate the damage reduction that would result in the actual damage
        const damageReduction = (1 - form.actualDamage / effectiveDamage) * 100;

        // Calculate the effective defense that would result in this damage reduction
        // Using the formula from scoring.ts: damageReduction = 88.3505 * exp(-((4.5552 - log10(defense)) / 1.3292)^2)
        // Solving for defense:
        // damageReduction/88.3505 = exp(-((4.5552 - log10(defense)) / 1.3292)^2)
        // ln(damageReduction/88.3505) = -((4.5552 - log10(defense)) / 1.3292)^2
        // -ln(damageReduction/88.3505) = ((4.5552 - log10(defense)) / 1.3292)^2
        // sqrt(-ln(damageReduction/88.3505)) = (4.5552 - log10(defense)) / 1.3292
        // 1.3292 * sqrt(-ln(damageReduction/88.3505)) = 4.5552 - log10(defense)
        // log10(defense) = 4.5552 - 1.3292 * sqrt(-ln(damageReduction/88.3505))
        // defense = 10^(4.5552 - 1.3292 * sqrt(-ln(damageReduction/88.3505)))
        const lnPart = -Math.log(damageReduction / 88.3505);
        const sqrtPart = Math.sqrt(lnPart);
        const log10Defense = 4.5552 - 1.3292 * sqrtPart;
        const effectiveDefense = Math.pow(10, log10Defense);

        // Now we need to work backwards to find the base defense
        // If we have defense debuffs and penetration, we need to find the base defense that would result in this effective defense
        // effectiveDefense = (baseDefense * (1 + defenseDebuffSum/100)) * (1 - defensePenetration/100)
        // Therefore: baseDefense = effectiveDefense / ((1 + defenseDebuffSum/100) * (1 - defensePenetration/100))
        const defenseDebuffSum = form.enemyDefenseBuffs.reduce((sum, buff) => sum + buff.value, 0);
        const baseDefense =
            effectiveDefense / ((1 + defenseDebuffSum / 100) * (1 - form.defensePenetration / 100));

        // Add debug logging
        /* eslint-disable no-console */
        console.log('Calculation steps:');
        console.log('1. Base attack:', form.shipAttack);
        console.log('2. After skill attack:', form.shipAttack * (form.skillAttackPercent / 100));
        console.log(
            '3. After crit:',
            form.shipAttack * (form.skillAttackPercent / 100) * (1 + form.critDamagePercent / 100)
        );
        console.log(
            '4. After outgoing damage buffs:',
            form.shipAttack *
                (form.skillAttackPercent / 100) *
                (1 + form.critDamagePercent / 100) *
                (1 + outgoingDamageBuffSum / 100)
        );
        console.log(
            '5. After incoming damage buffs:',
            form.shipAttack *
                (form.skillAttackPercent / 100) *
                (1 + form.critDamagePercent / 100) *
                (1 + outgoingDamageBuffSum / 100) *
                incomingDamageMultiplier
        );
        console.log('6. Effective damage:', effectiveDamage);
        console.log('7. Damage reduction:', damageReduction);
        console.log('8. Effective defense:', effectiveDefense);
        console.log('9. Defense debuff sum:', defenseDebuffSum);
        console.log('10. Defense penetration:', form.defensePenetration);
        console.log('11. Final base defense:', baseDefense);
        /* eslint-enable no-console */

        setResults({
            damageReduction,
            enemyDefense: baseDefense,
        });
    };

    const renderBuffDebuffSection = (title: string, type: keyof DamageDeconstructionForm) => (
        <div>
            <label className="block text-sm font-medium mb-1">{title}</label>
            {(form[type] as BuffDebuff[]).map((buff, index) => (
                <div key={index} className="flex gap-2 mb-2">
                    <Input
                        type="number"
                        value={buff.value}
                        onChange={(e) => {
                            const newBuffs = [...(form[type] as BuffDebuff[])];
                            newBuffs[index] = { ...buff, value: Number(e.target.value) };
                            setForm((prev) => ({ ...prev, [type]: newBuffs }));
                        }}
                        className="w-32"
                        placeholder="Value %"
                    />
                    <Input
                        type="text"
                        value={buff.description}
                        onChange={(e) => {
                            const newBuffs = [...(form[type] as BuffDebuff[])];
                            newBuffs[index] = { ...buff, description: e.target.value };
                            setForm((prev) => ({ ...prev, [type]: newBuffs }));
                        }}
                        className="flex-1"
                        placeholder="Description"
                    />
                    <Button variant="danger" onClick={() => removeBuffDebuff(type, index)}>
                        <CloseIcon />
                    </Button>
                </div>
            ))}
            <Button variant="secondary" onClick={() => addBuffDebuff(type, 0, '')} className="mt-2">
                Add {title}
            </Button>
        </div>
    );

    return (
        <>
            <Seo {...SEO_CONFIG.damageDeconstruction} />
            <PageLayout
                title="(BETA) Damage Deconstruction Calculator"
                description="
                Estimate the enemy defense based on the damage reduction.
                Enter all buffs and debuffs on both attacker and defender.
                Remember affinity disadvantage/advantage on the attacker.
            "
            >
                <div className="mb-6 bg-dark p-4">
                    <div className="space-y-4">
                        <h4 className="text-lg font-bold">Attacker</h4>
                        <Input
                            label="Actual Damage Dealt"
                            type="number"
                            value={form.actualDamage}
                            onChange={(e) =>
                                setForm((prev) => ({
                                    ...prev,
                                    actualDamage: Number(e.target.value),
                                }))
                            }
                        />

                        <Input
                            label="Ship Base Attack"
                            type="number"
                            value={form.shipAttack}
                            onChange={(e) =>
                                setForm((prev) => ({ ...prev, shipAttack: Number(e.target.value) }))
                            }
                        />

                        <Input
                            label="Skill Attack %"
                            type="number"
                            value={form.skillAttackPercent}
                            onChange={(e) =>
                                setForm((prev) => ({
                                    ...prev,
                                    skillAttackPercent: Number(e.target.value),
                                }))
                            }
                        />

                        <Input
                            label="Defense Penetration %"
                            type="number"
                            value={form.defensePenetration}
                            onChange={(e) =>
                                setForm((prev) => ({
                                    ...prev,
                                    defensePenetration: Number(e.target.value),
                                }))
                            }
                        />

                        <div className="flex items-center gap-4">
                            <label className="flex items-center gap-2 mt-5">
                                <input
                                    type="checkbox"
                                    checked={form.isCrit}
                                    onChange={(e) =>
                                        setForm((prev) => ({ ...prev, isCrit: e.target.checked }))
                                    }
                                    className="w-4 h-4 text-primary border-dark-border focus:ring-primary"
                                />
                                Critical Hit
                            </label>
                            {form.isCrit && (
                                <Input
                                    label="Critical Damage %"
                                    type="number"
                                    value={form.critDamagePercent}
                                    onChange={(e) =>
                                        setForm((prev) => ({
                                            ...prev,
                                            critDamagePercent: Number(e.target.value),
                                        }))
                                    }
                                />
                            )}
                        </div>

                        {renderBuffDebuffSection('Attack Buffs/Debuffs %', 'attackBuffs')}

                        {renderBuffDebuffSection(
                            'Outgoing Damage Buffs/Debuffs %',
                            'outgoingDamageBuffs'
                        )}
                    </div>
                </div>
                <div className="mb-6 bg-dark p-4">
                    <div className="space-y-4">
                        <h4 className="text-lg font-bold">Defender</h4>
                        {renderBuffDebuffSection(
                            'Enemy Defense Buffs/Debuffs %',
                            'enemyDefenseBuffs'
                        )}
                        {renderBuffDebuffSection(
                            'Enemy Incoming Damage Buffs/Debuffs %',
                            'enemyIncomingDamageBuffs'
                        )}

                        <Button onClick={calculateDamage} variant="primary" fullWidth>
                            Calculate
                        </Button>
                    </div>
                </div>

                {results && (
                    <div className="mb-6 bg-dark p-4">
                        <h2 className="text-xl font-bold mb-4">Results</h2>
                        <div className="space-y-2">
                            <p>Damage Reduction: {results.damageReduction.toFixed(2)}%</p>
                            <p>Enemy Defense Estimation: {Math.round(results.enemyDefense)}</p>

                            <p className="text-sm text-gray-500">
                                <span className="font-bold">Note:</span> This is an estimation based
                                on an approximation of the damage reduction, and most likely not
                                100% accurate. The worst result I&apos;ve seen has been so far is
                                1.5% off.
                            </p>
                        </div>
                    </div>
                )}
            </PageLayout>
        </>
    );
};

export default DamageDeconstructionPage;
