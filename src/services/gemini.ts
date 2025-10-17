import { GoogleGenerativeAI } from '@google/generative-ai';
import { IMPLANTS } from '../constants/implants';
import { AutogearSuggestion } from '../types/autogearSuggestion';
import { findBuffsInText, getBuffDescription } from '../utils/buffUtils';

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

export class GeminiService {
    private genAI: GoogleGenerativeAI;

    constructor(apiKey: string) {
        this.genAI = new GoogleGenerativeAI(apiKey);
    }

    async getAutogearSuggestion(
        shipName: string,
        shipData: ShipData,
        combatSystemContext: string
    ): Promise<AutogearSuggestion | null> {
        try {
            const prompt = this.buildPrompt(shipName, shipData, combatSystemContext);

            // Use gemini-2.0-flash-exp model
            const model = this.genAI.getGenerativeModel({
                model: 'gemini-2.0-flash-exp',
                generationConfig: {
                    temperature: 0.1,
                    responseMimeType: 'application/json',
                },
            });

            const result = await model.generateContent(prompt);
            const response = await result.response;
            const content = response.text();

            if (!content) {
                throw new Error('No content received from Gemini');
            }

            return this.parseResponse(content);
        } catch (error) {
            console.error('Gemini service error:', error);
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

CRITICAL INSTRUCTIONS:
1. check section ### Ship-Specific Optimizations for any special considerations for the ship.
2. statPriorities should ONLY include stats mentioned in the ship's skills that require specific thresholds
3. DO NOT add primary/secondary stats for the role (e.g., attack for ATTACKER, HP for DEFENDER)
4. DO NOT add crit cap for ATTACKERS/SUPPORTERS - this is handled automatically
5. statBonuses should boost tertiary stats that scale with skills but aren't the role's main focus
6. setPriorities should only suggest sets with special synergies beyond the role defaults

Provide autogear configuration in JSON format. Return ONLY valid JSON with no markdown formatting:

{
  "shipRole": "ATTACKER|DEFENDER|SUPPORTER|DEBUFFER|DEBUFFER (Bomber)|DEBUFFER (Corrosion)|SUPPORTER (Buffer)|SUPPORTER (Shield)|etc",
  "statPriorities": [
    // ONLY if skills mention specific stat requirements. Most ships should have an EMPTY array here.
    // Example: Ship has "when hacking exceeds 400" → include {"stat": "hacking", "minLimit": 400}
    // DO NOT include role primary stats like attack for ATTACKER
  ],
  "statBonuses": [
    // ONLY for stats mentioned in skills that aren't the role's primary focus
    // Example: ATTACKER with "damage scales with speed" → {"stat": "speed", "weight": 100}
    // Use weight percentages: HP/Attack/Defense (1-10%), Hacking/Security (20-100%), Speed/Crit (50-200%)
  ],
  "setPriorities": [
    // ONLY for sets with special skill synergies
    // Example: Ship that shields allies → {"setName": "SHIELD"}
    // DO NOT include role default sets like ATTACK for ATTACKER
  ],
  "reasoning": "Brief explanation focusing on skill-based synergies (under 100 words)"
}

Example correct outputs:
- Generic ATTACKER with standard damage skills → statPriorities: [], statBonuses: [], setPriorities: []
- SUPPORTER with HP-scaling shield skill → statPriorities: [], statBonuses: [{"stat": "hp", "weight": 5}], setPriorities: [{"setName": "SHIELD"}]
- DEBUFFER with "requires 380+ hacking" passive → statPriorities: [{"stat": "hacking", "minLimit": 380}], statBonuses: [], setPriorities: []`;
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
            console.error('Failed to parse Gemini response:', error);
            return null;
        }
    }
}

// Environment variable check for API key
export const getGeminiService = (): GeminiService | null => {
    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
    if (!apiKey) {
        // eslint-disable-next-line no-console
        console.warn('Google API key not found in environment variables');
        return null;
    }
    return new GeminiService(apiKey);
};
