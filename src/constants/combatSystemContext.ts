export const COMBAT_SYSTEM_CONTEXT = `
# STARBORNE FRONTIERS COMBAT SYSTEM GUIDE

STARBORNE FRONTIERS is a gacha game with ships that have different roles and skills. Ships can be leveled up, refitted, and equipped with gear and implants.

## CORE COMBAT MECHANICS

### Turn-Based Combat
- Combat is turn-based and fully automatic (no user input)
- Ships act in Speed stat order (higher speed = earlier turns)
- Positioning and ship placement on the grid determines the outcome
- Each turn, ships can use Active Skills (which add a charge) or Charge Skills (when charged)
- Passive skills can trigger on various events
- Combat continues until one side is eliminated

### Damage Types
- **Direct Damage**: Normal attacks and instant damage skills
- **Damage-over-Time (DoT)**: Corrosion and Inferno debuffs
- **Detonation Damage**: Bomb and Echoing Burst debuffs, plus "detonation" skills

### Detonation Mechanics
- Detonation effects are subject to hacking vs security checks (like inflicted debuffs)
- If successful, detonation removes all damaging debuffs of the specified type
- Deals all remaining DoT damage instantly in a single hit, often at increased multiplier
- Inferno and Bomb damage is based on attack value at time of inflicting, not detonation

### Shield System
- Shields are extra hit points consumed before HP damage
- Maximum shield capacity equals Max HP
- Defense damage reduction applies before shield damage
- Shields don't affect Current HP or Max HP values

### Buff/Debuff Mechanics
- **Applied Debuffs**: Guaranteed effect, no resistance check (except vs affinity advantage)
- **Inflicted Debuffs**: Subject to hacking vs security check (HACK - SEC = success %)
- **Buff Scaling**: Relative to the buffed unit, except Font of Power implant (scales with caster)
- **Buff Stacking**: Buffs with same name overwrite if equal/higher rank (Attack 3 overwrites Attack 1, but not vice versa)

### Grid & Positioning
- **Combat Grid**: 4×4 battlefield with maximum 5 ships per team
- **Positioning**: Ship placement and grid location affects combat outcomes
- **Strategic Placement**: Affects targeting priorities and ability ranges

### Stats
Base stats available for ships (parentheses show typical value ranges for gauging stat bonuses):

- **Attack**: Base damage (1,000-30,000)
- **HP**: Hit points (10,000-150,000)
- **Defense**: Damage reduction (1,000-20,000)
- **Hacking**: Debuff infliction success rate (100-600)
- **Security**: Debuff resistance (100-500)
- **Crit Rate**: Critical hit chance (0-100%)
- **Crit Power**: Critical hit damage multiplier (0-300%)
- **Speed**: Turn order priority (50-200)
- **Heal Modifier**: Healing effectiveness bonus (0-60%, gear only)
- **Shield**: Shield regeneration per turn (0-12%, gear only)
- **Defense Penetration**: Ignores portion of enemy defense (0-66%)

### Damage Calculation
- **Base Damage** = Attack stat × skill multiplier
- **Critical Hits** = Base damage × (1 + Crit Power %)
- **Critical Chance** = Crit Rate % (capped at 100%)

### Defense & Survivability
- **Damage Reduction** = 88.3505 × exp(-((4.5552 - log₁₀(defense)) / 1.3292)²)
- **Effective HP** = HP × (100 / (100 - damage reduction %))
- **Defense Scaling**: Only stat with diminishing returns (see Effective HP formula)
- **Defense Penetration**: Reduces enemy defense before damage reduction calculation
  - Formula: Effective Defense = Enemy Defense × (1 - Defense Penetration %)
  - Common values: 0% = 74.21% damage reduction, 7% = 72.71%, 21% = 69.17%, 41% = 62.37%
  - Higher penetration significantly increases damage against armored targets

### Affinities (Rock-Paper-Scissors System)
- **Electric** < **Thermal** < **Chemical** < **Electric**
- **Antimatter** is neutral (no advantage/disadvantage)
- Affinity advantage provides +25% damage and +25% hacking effectiveness

### Equipment System

#### Gear Slots (6 total)
- **Upper Slots** (Weapon, Hull, Generator): Flat main stats, substats are primary importance
- **Lower Slots** (Sensor, Software, Thrusters): Variable main stat types (flat or percentage)
- Each gear piece has a main stat and up to 4 substats

#### Gear Set System
- **Set Activation**: Based only on piece count, not specific slots
- **Multiple Sets**: Can run up to 3 different 2-piece sets (6 slots total)
- **No Mixing Penalty**: No downsides to combining different sets
- **Stacking Exception**: CLOAKING set effects don't stack with multiple pieces

#### Implant Slots (5 total)
- **Minor Implants**: Basic stat bonuses only
- **Major Implants**: Higher stats plus a passive skill
- **Ultimate Implants**: No stats, but powerful passive skills
  - *Important: Ultimate implant skills are NOT factored into autogear optimization*

#### Key Ultimate Implants
- **Code Guard**: Improves security based on hacking stat
  - Ships with Code Guard should prioritize hacking stat bonuses
  - Can use lower security thresholds due to Code Guard's boost
- **Cipher Link**: Improves hacking based on security stat
  - Ships with Cipher Link should prioritize security stat bonuses
  - Can use lower hacking thresholds due to Cipher Link's boost

## SHIP ROLES & OPTIMIZATION

The following roles are available in the Autogear system, each with specific optimization priorities:

### ATTACKER
- **Goal**: Maximize raw damage output
- **Primary Stats**: Attack, Crit Rate, Crit Power
- **Secondary Stats**: Defense Penetration
- **Key Sets**: ATTACK (+15% ATK), CRITICAL (+5% CR, +10% CD), ABYSSAL_ASSAULT (+15% ATK, +5% CD), AMBUSH (+10% ATK, +5% SPD), PIERCER (+7% DEF PEN), SPEED (+15% SPD)
- **Meta**: High burst damage, fast elimination of threats

### DEFENDER
- **Goal**: Maximize survivability and tanking
- **Primary Stats**: HP, Defense
- **Secondary Stats**: Security (as much as possible, without sacrificing primary stats)
- **Key Sets**: FORTITUDE (+15% HP), DEFENSE (+15% DEF), ABYSSAL_SAFEGUARD (+15% HP, +10 SEC), PROTECTION (+10% DEF, +20 SEC), SHIELD (+4% SHIELD GEN)
- **Meta**: High effective HP, damage mitigation, protection for team

### DEFENDER (Security)
- **Goal**: Counter debuff-heavy teams through high security
- **Primary Stats**: Security, HP, Defense
- **Key Sets**: PROTECTION (+10% DEF, +20 SEC), ABYSSAL_SAFEGUARD (+15% HP, +10 SEC), FORTITUDE (+15% HP), DEFENSE (+15% DEF), SHIELD (+4% SHIELD GEN)
- **Meta**: Anti-debuffer specialist with maximum security limit of 270

### SUPPORTER
- **Goal**: Maximize healing and team sustain
- **Primary Stats**: HP (healing scales with healer's HP), Crit Rate, Crit Power, Heal Modifier
- **Secondary Stats**: Defense (survivability), speed (offensive buff application)(optional)
- **Key Sets**: REPAIR (+20% Heal Modifier), RECOVERY (+10% HP, +10% Heal), CRITICAL (+5% CR, +10% CD), ABYSSAL_SAFEGUARD (+15% HP, +10 SEC), FORTITUDE (+15% HP)
- **Meta**: Keep team alive, defensive buff application, sustain focus

### SUPPORTER (Buffer)
- **Goal**: Fast buff application and team damage output enhancement
- **Primary Stats**: Speed, HP/Defense for survival
- **Key Sets**: BOOST (buffs last +1 turn), SPEED (+15% SPD)
- **Meta**: First turn advantages, extended buff duration, damage output enhancement

### SUPPORTER (Offensive)
- **Goal**: Attack-based healing and buff units (especially with Font of Power implant)
- **Primary Stats**: Speed, Attack
- **Key Sets**: BOOST (buff extension), AMBUSH (+10% ATK, +5% SPD), ATTACK (+15% ATK)
- **Meta**: Fast healing and offensive buffs scaled from attack stat
- **Notable Ships**: Howler, Sentinel

### SUPPORTER (Shield)
- **Goal**: Shield generation and protection
- **Primary Stats**: HP (shield scales with caster HP, this is specified in the ship's skills), Speed
- **Key Sets**: SHIELD (+4% shield per turn), FORTITUDE
- **Meta**: Shield spam, damage mitigation through shields

### DEBUFFER
- **Goal**: Apply debuffs while dealing damage
- **Primary Stats**: Hacking (debuff success), Attack (damage), crit stats
- **Secondary Stats**: Speed (early debuff application)
- **Key Sets**: HACKING (+30 flat hack), EXPLOIT (+20 hack, +10% ATK), ABYSSAL_BREACH (+30 hack, +5% CR)
- **Meta**: damage + utility hybrid

### DEBUFFER (Defensive)
- **Goal**: Debuff application with high survivability
- **Primary Stats**: Hacking, HP, Defense
- **Secondary Stats**: Speed
- **Key Sets**: HACKING, ABYSSAL_SAFEGUARD
- **Meta**: Tanky debuffer, sustain while controlling

### DEBUFFER (Bomber)
- **Goal**: High-damage debuff application. For all ships who inflict bombs.
- **Primary Stats**: Hacking, Attack
- **Secondary Stats**: Crit stats, Speed
- **Key Sets**: EXPLOIT, ABYSSAL_BREACH, ATTACK
- **Meta**: Burst damage + debuff combo

### DEBUFFER (Corrosion)
- **Goal**: Damage-over-time focused debuffing
- **Primary Stats**: Hacking
- **Secondary Stats**: Speed, HP
- **Key Sets**: DECIMATION (+10% DoT damage), HACKING, BURNER (Inferno application)
- **Meta**: DoT stacking, long-term damage, higher hacking than normal debuffers to ensure debuff application

## GEAR SETS & SYNERGIES

### Core Sets (2-piece activation)
- **ATTACK**: +15% Attack - Universal damage boost
- **FORTITUDE**: +15% HP - Universal survivability
- **DEFENSE**: +15% Defense - Damage mitigation
- **SPEED**: +15% Speed - Turn order control
- **CRITICAL**: +5% Crit Rate, +10% Crit Power - Burst damage
- **HACKING**: +30 Hacking - Debuff success
- **REPAIR**: +20% Heal Modifier - Support efficiency

### Advanced Sets
- **PROTECTION**: +10% Defense, +20 Security - Anti-debuffer
- **AMBUSH**: +10% Attack, +5% Speed - Aggressive tempo
- **SWIFTNESS**: +15% Speed, +10 Hacking - Fast debuffer
- **RECOVERY**: +10% HP, +10% Heal Modifier - Balanced support
- **EXPLOIT**: +20 Hacking, +10% Attack - Balanced debuffer
- **PIERCER**: +7% Defense Penetration - Tank-busting

### Abyssal Sets (Premium)
- **ABYSSAL_ASSAULT**: +15% Attack, +5% Crit Power - Elite damage
- **ABYSSAL_SAFEGUARD**: +15% HP, +10 Security - Elite tank
- **ABYSSAL_WARD**: +15% Defense, +5% HP - Balanced defense
- **ABYSSAL_BREACH**: +30 Hacking, +5% Crit Power - Elite debuffer

### Special Sets (4-piece required)
- **BOOST**: Buffs last +1 turn - GAME-CHANGING for supporters
- **OMNICORE**: +10% all stats - Balanced excellence
- **BURNER**: +10% Attack + Inferno application - DoT focus

### Unique Effect Sets
- **DECIMATION**: +10% DoT damage (per piece) - DoT specialists
- **LEECH**: 15% damage healed back - Sustain DPS
- **REFLECT**: 10% damage reflected - Counter-attack
- **SHIELD**: +4% shield generation per turn - Shield spam
- **CLOAKING**: 2 turns stealth at combat start - Positioning

## COMBAT META ANALYSIS

### General Optimization Principles
- **Attackers**: Prioritize 100% crit rate, then maximize attack
- **Defenders**: Maximize effective HP and security
- **Healing Supporters**: Maximize healing output potential
- **Debuffers**: Balance hacking and attack/damage output
- **Bomb/Inferno Debuffers**: Prioritize attack (DoT damage scales with attack at infliction)
- **Corrosion Debuffers**: Use DECIMATION set (percentage-based damage benefits)
- **Defending Debuffers**: Boost hacking via stat bonuses rather than stat priorities

### PvE vs PvP Optimization
- **PvP Focus**: Speed and stealth are highly recommended for all roles
- **PvE Focus**: Standard role priorities without speed/stealth emphasis

### Common Optimization Mistakes
- **Debuffing Tanks**: NEVER prioritize hacking over survivability stats
  - Hacking should be secondary priority only
  - NEVER set minimum hacking limits for tank debuffers
  - Use stat bonuses to boost hacking instead of stat priorities

### Ship-Specific Optimizations
- **Xcellence**: Low hacking builds to trigger resist-based passive skills
- **Corrosion Ships**: Aim for 100% crit rate/power if passives trigger on crits
- **Heliodor**: Supporter role but optimize as defender
- **Voron**: Self-DoT mechanics favor shield generation, HP, defense, security over hacking
- **Mei**: Has passive stealth, doesn't need CLOAKING set
- **Howler**: Supporter classification but gear as crit-capped ATTACKER
- **Vindicator**: Defender with security-scaling defense, use DEFENDER (Security) role

## OPTIMIZATION GUIDELINES

### Stat Thresholds
- **Crit Rate**: Hard cap at 100%
- **Hacking**: 350+ recommended for reliable debuff application

### Gear Set Priority Guidelines
1. **Role-appropriate 4-piece sets** (BOOST, OMNICORE, BURNER)
2. **Core 2-piece sets** matching primary role stats
3. **Synergy sets** that complement ship-specific skills
4. **Multiple 2-piece sets** are beneficial (can run up to 3 different sets)
5. **No penalty for mixing sets** - combine freely for optimal bonuses

### Skill Analysis Guidelines
- Analyze active/passive skills for stat synergies
- Analyze implant skills for stat interactions
- Look for skill-specific gear set combinations
- Factor in skill-based buffs/debuffs when optimizing

## AUTOGEAR CONFIGURATION SYSTEM

The autogear system optimizes gear selection based on role selection and custom parameters:

### Ship Roles
Choose from base roles (ATTACKER, DEFENDER, SUPPORTER, DEBUFFER) and specialized sub-roles:
- **Base Roles**: Cover general optimization priorities
- **Sub-Roles**: Address specific mechanics (e.g., BOMBER for bomb-inflicting ships, SECURITY for security-focused defenders)
- **Hybrid Tanks**: Ships with debuff abilities should use DEFENDER roles with hacking stat bonuses

### Configuration Parameters

#### statPriorities
- Set specific stat targets (e.g., 350 hacking, specific speed thresholds)
- **Do NOT use for role primary/secondary stats** (autogear handles these automatically)
- **Do NOT specify crit cap for ATTACKERS/SUPPORTERS** (handled automatically)
- Use for ships with special skill requirements (e.g., crit-dependent passives)

#### setPriorities
- Prioritize gear sets outside of role defaults
- Use for ship-specific synergies (shield generation, stealth, etc.)
- Excludes sets already included in the selected role

#### statBonuses
- Boost role scoring for specific stats
- Use when skills scale with non-attack stats
- Apply for tertiary stat synergies found in ship skills
- **Do NOT use for role primary/secondary stats**

**Formula**: bonusScore = Σ (statValue × percentage / 100)

**Scaling Considerations**:
- Stat bonuses are **additive** to the base role score, not multiplicative
- Different stats have vastly different value scales, requiring careful percentage tuning
- Example: HP @ 1% contributes 500 points (from 50,000 HP), while Speed @ 100% contributes 200 points (from 200 speed)

**Typical Percentage Ranges**:
- **High-value stats** (HP: 10k-150k, Attack: 1k-30k, Defense: 1k-20k): 1-10%
- **Medium-value stats** (Hacking: 100-600, Security: 100-500): 20-100%
- **Low-value stats** (Speed: 50-200, Crit: 0-100%, Crit Power: 0-300%): 50-200%

**Impact on Optimization**:
- Stat bonuses typically represent a minor adjustment (usually <5% of total score)
- Guides gear choices without overriding core role optimization
- Useful for hybrid roles (e.g., Defender with hacking @ 80% for debuff capability)
- Allows fine-tuning priorities not captured by base role formulas

### Recommended Settings
- **Ignore Equipped Gear**: Unchecked (consider current equipment)
- **Ignore Unleveled Gear**: Checked (focus on usable gear)

*This system rewards strategic thinking, set completion, and role specialization while maintaining tactical depth through affinity and buff/debuff interactions.*
`;
