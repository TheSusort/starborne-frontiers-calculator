import { IMPLANTS } from '../constants/implants';
import { AutogearSuggestion } from '../types/autogearSuggestion';
import { findBuffsInText, getBuffDescription } from '../utils/buffUtils';

interface OpenRouterResponse {
    choices: Array<{
        message: {
            content: string;
        };
    }>;
}

interface ImplantInfo {
    name: string;
    type: string;
    description: string;
    slot: string;
}

interface ShipData {
    refits?: unknown[];
    secondPassiveSkillText?: string;
    firstPassiveSkillText?: string;
    affinity?: string;
    type?: string;
    activeSkillText?: string;
    chargeSkillText?: string;
    implants?: Partial<Record<string, string>>;
    getGearPiece?: (id: string) => unknown;
}

export class OpenRouterService {
    private apiKey: string;
    private baseUrl = 'https://openrouter.ai/api/v1';

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    async getAutogearSuggestion(
        shipName: string,
        shipData: ShipData,
        combatSystemContext: string
    ): Promise<AutogearSuggestion | null> {
        try {
            const prompt = this.buildPrompt(shipName, shipData, combatSystemContext);

            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'x-ai/grok-4-fast:free',
                    messages: [
                        {
                            role: 'user',
                            content: prompt,
                        },
                    ],
                    max_tokens: 1500,
                    temperature: 0.3,
                }),
            });

            if (!response.ok) {
                throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
            }

            const data: OpenRouterResponse = await response.json();
            const content = data.choices[0]?.message?.content;

            if (!content) {
                throw new Error('No content received from OpenRouter');
            }

            return this.parseResponse(content);
        } catch (error) {
            console.error('OpenRouter service error:', error);
            return null;
        }
    }

    private enhanceSkillWithBuffs(skillText: string): string {
        if (!skillText || skillText === 'None') return skillText;

        const buffs = findBuffsInText(skillText);
        if (buffs.length === 0) return skillText;

        const buffDescriptions = buffs
            .map((buffName) => {
                const description = getBuffDescription(buffName);
                return description ? `${buffName}: ${description}` : null;
            })
            .filter(Boolean)
            .join(', ');

        return buffDescriptions ? `${skillText} [Buffs: ${buffDescriptions}]` : skillText;
    }

    private buildPrompt(shipName: string, shipData: ShipData, combatSystemContext: string): string {
        // Determine which passive skill to use based on refit level
        const refitLevel = shipData.refits ? shipData.refits.length : 0;
        const useR2Passive = refitLevel >= 2;
        const passiveSkillRaw = useR2Passive
            ? shipData.secondPassiveSkillText || 'None'
            : shipData.firstPassiveSkillText || 'None';
        const passiveSkill = this.enhanceSkillWithBuffs(passiveSkillRaw);
        const passiveSkillLabel = useR2Passive ? 'Passive Skill (R2)' : 'Passive Skill';

        // Process implant information
        const implantInfo = this.getImplantInfo(shipData);
        const implantText =
            implantInfo.length > 0
                ? implantInfo
                      .map(
                          (implant) =>
                              `${implant.slot}: ${implant.name} (${implant.type}) - ${implant.description}`
                      )
                      .join('\n')
                : 'None';

        // Enhance active and charge skills with buff information
        const activeSkill = this.enhanceSkillWithBuffs(shipData.activeSkillText || 'None');
        const chargeSkill = this.enhanceSkillWithBuffs(shipData.chargeSkillText || 'None');

        return `${combatSystemContext}

SHIP ANALYSIS REQUEST:
Ship Name: ${shipName}
Ship Details:
- Affinity: ${shipData.affinity}
- Role: ${shipData.type}
- Refit Level: ${refitLevel}

Active Skill: ${activeSkill}
Charge Skill: ${chargeSkill}
${passiveSkillLabel}: ${passiveSkill}

Implants:
${implantText}

Please analyze this ship and provide autogear configuration suggestions in the following JSON format:

{
  "shipRole": "ATTACKER|DEFENDER|SUPPORTER|DEBUFFER|etc",
  "statPriorities": [
    {
      "stat": "attack|hp|defense|hacking|security|crit rate|crit power|speed|etc",
      "minLimit": number (optional),
      "maxLimit": number (optional),
    }
  ],
  "statBonuses": [
    {
      "stat": "attack|hp|defense|hacking|security|crit rate|crit power|speed|etc",
      "weight": number (this boosts role score, by % of the stat, so 10% HP stat bonus, boosts role score on gear suggestions by 10% of the total unit HP)
    }
  ],
  "setPriorities": [
    {
      "setName": "BOOST|DECIMATION|ATTACK|etc"
    }
  ],
  "reasoning": "Brief explanation of why these priorities work for this ship"
}

Focus on the ship's natural strengths, skills, and optimal combat role. Keep reasoning under 100 words.`;
    }

    private getImplantInfo(shipData: ShipData): ImplantInfo[] {
        const implantInfo: ImplantInfo[] = [];

        if (!shipData.implants || !shipData.getGearPiece) {
            return implantInfo;
        }

        Object.entries(shipData.implants).forEach(([slot, implantId]) => {
            if (!implantId || typeof implantId !== 'string') {
                return;
            }

            // Get the gear piece that represents this implant
            const gearPiece = shipData.getGearPiece?.(implantId) as
                | { setBonus?: string | null; rarity?: string }
                | undefined;
            if (!gearPiece || !gearPiece.setBonus) {
                return;
            }

            // Look up the implant data using the setBonus field
            const implant = IMPLANTS[gearPiece.setBonus];
            if (!implant) {
                return;
            }

            // Get the variant that matches the gear piece rarity, or the highest rarity variant
            const matchingVariant = implant.variants.find(
                (variant) => variant.rarity === gearPiece.rarity
            );
            const bestVariant =
                matchingVariant ||
                implant.variants.reduce((best, current) => {
                    const rarityOrder = { common: 1, rare: 2, epic: 3, legendary: 4 };
                    return (rarityOrder[current.rarity as keyof typeof rarityOrder] || 0) >
                        (rarityOrder[best.rarity as keyof typeof rarityOrder] || 0)
                        ? current
                        : best;
                }, implant.variants[0]);

            implantInfo.push({
                name: implant.name,
                type: implant.type,
                description: bestVariant.description || 'No description available',
                slot: slot.charAt(0).toUpperCase() + slot.slice(1), // Capitalize slot name
            });
        });

        return implantInfo;
    }

    private parseResponse(content: string): AutogearSuggestion | null {
        try {
            // Try to extract JSON from the response
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in response');
            }

            const parsed = JSON.parse(jsonMatch[0]);

            // Validate the response structure
            if (!parsed.shipRole || !parsed.statBonuses || !parsed.reasoning) {
                throw new Error('Invalid response structure');
            }

            return parsed as AutogearSuggestion;
        } catch (error) {
            console.error('Failed to parse OpenRouter response:', error);
            return null;
        }
    }
}

// Environment variable check for API key
export const getOpenRouterService = (): OpenRouterService | null => {
    const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
    if (!apiKey) {
        // eslint-disable-next-line no-console
        console.warn('OpenRouter API key not found in environment variables');
        return null;
    }
    return new OpenRouterService(apiKey);
};
