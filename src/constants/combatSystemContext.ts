export const COMBAT_SYSTEM_CONTEXT = `
# STARBORNE FRONTIERS COMBAT SYSTEM GUIDE

## CORE COMBAT MECHANICS

### Turn-Based Combat
- Combat is turn-based with speed determining turn order, and fully automatic, meaning no user input. Positioning and which ships on the grid determines the outcome.
- Ships act in order of their Speed stat (higher speed = earlier turns)
- Each turn, ships can use Active Skills, which adds a charge, or Charge Skills (when charged). There are also plenty of passive skills, that can triggered on various events. Skills can be straight forward damage based on attack stat, or based on attack and have another damage bonus based on another stat.
- All damage is classified as either direct damage (e.g. normal attacks), damage-over-time ("DoT damage" debuffs corrosion and inferno), or detonation damage (bomb and echoing burst debuffs, and "detonation" skills).
- Detonation skills/effects are affected by the hacking check (like inflicted debuffs), and if successful (not resisted) then detonation removes all the damaging debuffs/effects of the specified type and deals all the damage which those effects would have dealt over their remaining durations all at once in a single hit, frequently at a boosted/increased multiple.
- Both Inferno and Bomb deal their damage based on the attack value at the time of inflicting, not at the time of detonation.
- Shield(s) is/are extra hit points which are used up first and do not affect "Current HP" or "Max HP". The maximum amount of shield which a unit can have is equal to its Max HP. The damage reduction/mitigation effect of Defense is applied before incoming damage is applied to/hits shields.
- Combat continues until one side is eliminated
- Debuffs can either be "Apply" or "Inflict". Debuffs which are inflicted are subject to the hacking stat vs. security stat check (HACK - SEC = %chance). Debuffs which are applied are guaranteed to take effect without a hacking check, except that they are also guaranteed to not affect enemies with affinity advantage.
- Buffs are always relative to the unit that is getting buffed, except Font of Power implant, which is relative to the unit that is casting the skill. So for example a hacking buff gives as much hacking if the buffer has 0 hacking or 1000 hacking.

### Stat types
- **base stats**: these are the different stats that are available for the ship. in parenthesis are the normal value range, can be used to gauge stat bonuses.
- **attack**: base damage (in the thousands up to 30k)
- **hp**: base hit points (in the tens of thousands up to 150k)
- **defense**: damage reduction (in the thousands up to 20k)
- **hacking**: debuff inflictionsuccess rate (in the hundreds up to 600)
- **security**: debuff resistance (in the hundreds up to 500)
- **crit rate**: critical hit chance (0-100%)
- **crit power**: critical hit damage (0-300%)
- **speed**: turn order (50-200)
- **heal modifier**: healing bonus (0-60% (exclusively from gear))
- **shield**: shield regeneration (0-12% (exclusively from gear))
- **defensePenetration**: attacks ignore a portion of the defense (0-66%)

### Damage Calculation
- **Base Damage** = Attack stat × skill multiplier
- **Critical Hits** = Base damage × (1 + Crit Power %)
- **Critical Chance** = Crit Rate % (capped at 100%)

### Defense Reduction
- **Damage Reduction** = 88.3505 * Math.exp(-Math.pow((4.5552 - Math.log10(defense)) / 1.3292, 2))
- **Effective HP** = hp * (100 / (100 - damageReduction));

### Affinities (Rock-Paper-Scissors System)
- **Electric** < **Thermal** < **Chemical** < **Electric**
- **Antimatter** is neutral (no advantage/disadvantage)
- Affinity advantage provides +25% damage and 25% higher hacking (debuff success rates)

### Gear and Implants
- Ships have 6 gear slots, and 5 implant slots, where specific gear and implants types can be equipped.
- Gear slots can be grouped into upper(weapon, hull, generator) and lower slots (sensor, software, thrusters).
- Gear has a gear set bonus, which is a set of bonus stats that are applied to the ship when the set is completed.
- Gear has a main stat and up to 4 substats.
- Upper slots have a flat main stat, so substats are the main importance.
- Lower slots can have different types of main stat, both flat and percentage.
- Implants are grouped into minor, major and ultimate.
- Minor implants are simple stat sticks.
- Major implants have bigger stats, and a passive skill.
- Ultimate implants have no stats, but a impactful passive skill. These skills are not factored in by the autogear system, so it's very helpful to inform users about this.

### Implant skill conciderations
- ultimates Code Guard improves security, based on hacking, so tank with this implant should add a stat bonus to hacking, and have a reduced security threshold, relative to the amount Code Guard adds.
- ultimates Cipher Link improves hacking, based on security, so ships with this implant should add a stat bonus to security, and have a reduced hacking threshold, relative to the amount Cipher Link adds.

## SHIP ROLES & OPTIMIZATION

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
- **Goal**: Counter debuff-heavy teams through Security
- **Primary Stats**: Security, HP, Defense
- **Key Sets**: PROTECTION (+10% DEF, +20 SEC), ABYSSAL_SAFEGUARD (+15% HP, +10 SEC), FORTITUDE (+15% HP), DEFENSE (+15% DEF), SHIELD (+4% SHIELD GEN)
- **Meta**: Anti-debuffer specialist, high security threshold

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
- **Goal**: Attack based healing units. Specifically for units with Font of Power implant, that grants buffs to allies, based on own attack stat.
- **Primary Stats**: Speed, Attack
- **Key Sets**: BOOST (buff extension), AMBUSH (+10% ATK, +5% SPD), ATTACK (+15% ATK)
- **Meta**: Fast healing and offensive buffs, main focus is to trigger Font of Power implant.

### SUPPORTER (Shield)
- **Goal**: Shield generation and protection
- **Primary Stats**: HP (shield scales with caster HP), Speed
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

## BUFF/DEBUFF SYSTEM

- Debuffs can either be "Apply" or "Inflict". Debuffs which are inflicted are subject to the hacking stat vs. security stat check (HACK - SEC = %chance). Debuffs which are applied are guaranteed to take effect without a hacking check, except that they are also guaranteed to not affect enemies with affinity advantage.
- Buffs and Debuffs duration can last in Turns or Rounds. A buff which lasts for 1 turn will take effect on the turn of the targeted unit. A buff which lasts for 1 round disappears at the end of the current round.

## COMBAT META ANALYSIS

### Common META
1. Regular Attackers aim for 100% crit rate, then push as much attack as possible.
2. Regular Defenders aim for as much Effective HP, and security as possible.
3. Regular healing Supporters aim for as much healing output as possible.
4. Debuffers aim for as much hacking as possible, and as much attack/damage as possible.
5. Debuffers that apply bombs and inferno, want higher attack, as bombs are based on attack.
6. Debuffers that apply corrosion, want decimation set bonus, as corrosion is based on a % of the enemy health, so the gain is worth it.

### PvP Meta (Player vs Player)
1. **Speed Control**: Generally higher speeds for everyone. Damage Buffers wants to be faster than attackers, Fast tanks and supporters are also beneficial, but not crucial.
2. **Stealth** is very beneficial for all roles, except for defenders.


### Special Ship Metas
- Xcellence can be geared with low hacking, to force inflict resist, and trigger it's second passive skill more often.
- Corrosion ships often have passive skills that trigger on critical hits, so they should aim for crit cap (100%), and/or crit power (100%) if they're passive specifies it.
- Heliodor is a supporter, but due to his skills, is better as a crit capped defender.
- Voron turns all damage into DoTs on himself, so he values shield generation, hp, defense, and security, over hacking.
- Mei have passive stealth, so she doesn't need cloak set bonus.
- Howler is a supporter, but due to her skills, is better geared as a crit capped ATTACKER.
- Vindicator is a defender, that gets extra defense from the security stat, so she should aim for the DEFENDER(SECURITY) role.

## OPTIMIZATION GUIDELINES

### Stat Thresholds
- **Crit Rate**: capped at 100%
- **Hacking**: 350+ for reliable debuff application, debuffing tanks usually can't reach this threshold with sacrificing other more important stats, so be wary about suggesting min limits for them. Stat bonuses can be used to boost the score relatively instead.

### Set Priority Guidelines
1. **Role-appropriate 4-piece sets** (BOOST, OMNICORE, BURNER)
2. **Core 2-piece sets** matching primary stats
3. **Synergy sets** that complement ship skills
4. **Avoid mixed sets** unless specifically beneficial

### Ship Skill Integration
- Analyze active/passive skills for stat synergies
- Analyse Implant skills for stat synergies
- Consider skill cooldowns and charge requirements
- Look for skill-specific gear set combinations
- Factor in skill-based buffs/debuffs when optimizing

### Autogear configuration
- Autogear is a system to find the optimal gear for a ship. It works by selecting a role that the user wants the ship to play, and then it will select the optimal gear for that role.
- **shipRoles**: the different roles have different priorities, which are listed in the SHIP ROLES & OPTIMIZATION section. There are only 4 roles in the game (ATTACKER, DEFENDER, SUPPORTER, DEBUFFER). The autogear system have added the others, because there are meta sub roles for each of them. For example some attackers are inflicting bombs, and should aim for the BOMBER role. Some attackers are corrosion inflicting, and should aim for the CORROSION role. Some defenders are security focused, and should aim for the SECURITY role. Some supporters are shield focused, and should aim for the SHIELD role. Some debuffers are defensive focused, and should aim for the DEFENSIVE role. Some debuffers are bomber focused, and should aim for the BOMBER role. Some debuffers are corrosion focused, and should aim for the CORROSION role. Some tanks inflicts debuffs, but should always aim for one of the DEFENDER roles, and rather add stat bonuses to hacking. This is up to you to analyse and pick one that suits the ship.
- **statPriorities**: stat limits are used to reach specific stat targets, such as speed, hacking, security, etc. For example 350 hacking for debuffers, or a specific spped, or security for defenders. Role primary/secondary stats from the SHIP ROLES & OPTIMIZATION section should NEVER be suggested here, as the autogear system will handle that. Not every ship needs a stat priority. ATTACKERS, SUPPORTERS don't need crit cap specified, as the autogear system will handle that. For Example: Some ships have skills that trigger on critical hits and have effects based on crit power, so they should aim for crit cap (100%), and/or crit power (100%).
- **setPriorities**: gear set can be prioritized, and users can set desired gear set count. This should be considered if there's a specific synergy found in skills, that the regular role wouldn't encompass, such as shield generation, stealth, etc. Gear Set Priorities are an extra config for gear sets outside of the role, so you can exclude the ones that are already included in the role.
- **statBonuses**: stat bonuses can be applied to the config, to boost the role score by a relative amount to a specific stat. useful when ships have skills that scale based on other stats than attack. Tweaks to the general role due to synergies found in skills, should be added here. This is specifically a field to use when there's mentions of tertiary stats in the skills, the primary/secondary stats from the SHIP ROLES & OPTIMIZATION section should NEVER be suggested here. Not every ship needs a stat bonus.
- The user can also select to ignore equipped gear, and ignore unleveled gear. Recommended to uncheck ignore equipped gear, and check ignore unleveled gear.

This system rewards strategic thinking, set completion, and role specialization while maintaining tactical depth through the affinity system and buff/debuff interactions.
`;
