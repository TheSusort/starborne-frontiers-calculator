// Detects the scope of a skill's *secondary* effects (debuffs/buffs/purges) from its text —
// the part that often reaches more units than the single damage hit. Returns a short,
// human-readable label for a tag like "Also affects: all enemies", or null when no broader
// scope is mentioned. The footprint diagram shows the damage shape; this captures the rest.

const HTML_TAG = /<[^>]*>/g;

export function parseEffectScope(skillText: string): string | null {
    const t = skillText.replace(HTML_TAG, ' ').toLowerCase();

    // Geometric scopes — "adjacent" may come before or after the noun
    // ("all adjacent enemies" / "all enemies adjacent to it").
    if (/adjacent enemies|enemies adjacent/.test(t)) return 'adjacent enemies';
    if (/adjacent allies|allies adjacent/.test(t)) return 'adjacent allies';

    // Conditional subsets — keep the qualifier so we don't overstate the scope.
    const conditional = t.match(/all (cleansed|hit|damaged|debuffed|stealthed) (enemies|allies)/);
    if (conditional) return `all ${conditional[1]} ${conditional[2]}`;

    // Whole-side scopes ("all enemies", "all other allies", …).
    if (/all (other )?enemies/.test(t)) return 'all enemies';
    if (/all (other )?allies/.test(t)) return 'all allies';

    return null;
}
