import { ChangelogEntry } from '../types/changelog';

export const CURRENT_VERSION = '1.65.0';

// RELEASE CHECKLIST: move these strings into a new ChangelogEntry at the top of
// CHANGELOG (with the new version + today's date), clear this array back to [],
// and bump CURRENT_VERSION. All three steps must happen together.
export const UNRELEASED_CHANGES: string[] = [
    'Defense calculator: the headline is now ROUNDS SURVIVED and DAMAGE ABSORBED, and a defensive ability on the ship itself finally raises both instead of lowering one of them. Damage absorbed means everything thrown at the ship over the fight — direct hits, damage over time, bombs, detonations and reflected damage — counted BEFORE the ship reduced any of it. Everything the DEFENDER does to shrink an incoming hit is deliberately left out of it: Defense mitigation, its own Inc. Damage Down, squad-leader incoming protections, gear damage reduction, and block procs. What the ATTACKER brings stays in, including Out. Damage Up and Exposed, because those make the attack bigger rather than making the defence better. Shields and Barrier still count too — they eat damage that arrived, they do not stop it being thrown. One thing on the ALLY side is deliberately NOT counted here: damage an ally soaks for the ship through Protection is booked against that ally, so adding a protector still lowers the figure for this ship (a 30% redirect over four rounds takes 40,000 down to 28,000). The slice is not lost, it just shows up on the ally card instead of this one. Concretely, in a fight: give a 100,000 HP ship 5,000 Defense and put it under 60,000 damage a round. It dies on round 5 and reports 300,000 absorbed. Now hand that same ship Inc. Damage Down II (-30% incoming direct damage). It survives a SIXTH round — and used to report 252,000, LESS than the unprotected ship managed, because the buff was still being subtracted from every single hit on the way into the total. Six rounds of 60,000 with 30% shaved off each one comes to 252,000, so the discount more than cancelled out the extra round the buff had bought: protecting the ship LOWERED its score. It now reports 360,000, which is six rounds of the same 60,000. Reflect was doing the same thing on its own channel: a ship swinging into a 50%-reflect enemy took 200,000 of thorns over four rounds, but giving it a 30% incoming-damage-reduction passive dropped the reported figure to 140,000, and a 60% one to 80,000 — same four rounds, same thorns, a quarter of the score for being tougher. All three now read 200,000. A ship carrying Voron\u2019s damage-to-DoT transform was hit hardest of all: at 5,000 Defense it read 24,993 where a ship with no such passive read 100,000, so the most defensive kit on the page scored a quarter of the plainest one. Both now read 100,000, because the same amount really was thrown at both. Two things worth knowing when reading it. The figure moves in whole rounds, since it only grows when the ship lives another one — two ships that die on the same round report the same total even if one is a little tankier, which is why rounds survived now sits above it. And on a ship that SURVIVES the whole window, the figure describes the ATTACKERS rather than the ship: nothing killed it, so it is simply everything the enemy managed to throw, and two survivors under the same enemies tie no matter how differently tanky they are. If you are comparing survivors, raise enemy attack or add rounds until the ships actually die. The old static estimate is still shown beside them, renamed Theoretical EHP and captioned as what it is: a hangar-stats calculation from HP and Defense alone, with no enemy firing at it. The breakdown underneath (to hull, absorbed by shield, blocked by Barrier, converted to shield) still describes what actually reached the ship after Defense — a different axis from the headline, not a sum of it — and its rows are now rounded like every other figure on the card instead of printing values like 24,999.667.',
    "The Defense calculator now runs the real combat engine using each ship's own skills, so shields, Barrier, self-repair and conditionally-gated buffs all fire for real alongside the old formula estimate. You can configure enemy attackers, supporting allies and the length of the fight — the enemy roster, the ally roster and the shared settings each sit in their own collapsible card.",
    'Combat simulator and calculators: a ship\u2019s own Defense buff now actually reduces the damage it takes \u2014 and a Defense penalty it gives itself now actually costs it. Defense Up I/II/III (+15/+30/+45% Defense) landed on the ship and showed in its buff list, but did nothing on the large majority of hits a ship takes \u2014 the direct hits landing on it each round. (It already worked on a counter-attack, a reactive proc and the Protection cascade\u2019s fallback read; those were never affected.) The main damage step read each defender\u2019s Defense straight off the ship sheet and then applied only the Defense changes an ENEMY had inflicted, so Defense Shred worked there and your own Defense Up did not. In a fight: put a ship with 5,000 Defense in front, let an enemy hit it for 8,331 a round, then have AEGIS grant it Defense Up II \u2014 that same hit now lands for 7,064 instead of the unchanged 8,331 it used to. The same fix works in the other direction, which is the bigger change in practice. Overload (+10% Outgoing Direct Damage, -10% Defense, stacking to ten times) is carried by Butcher, Mangler, Ravager, Asphyxiator and Ruiner, and the app was granting its damage bonus while quietly ignoring the Defense cost printed on the same card \u2014 which made those five ships strictly better than they read. A Butcher gaining a stack every turn now gets steadily easier to kill as it winds up: 4,500 Defense after one turn, 2,500 after five, and from the tenth turn on it defends as though it had none at all. Defense cannot usefully go past that point \u2014 zero is the floor a ship\u2019s own Defense can push itself down to, so a fully-stacked Butcher takes the plain, undefended hit, never more than that. Refine\u2019s Supercharged (-20% Defense on the active, -60% on the charged) costs it the same way for as long as it stands. Enemy ships follow every one of these rules against you: an enemy holding Defense Up is genuinely harder to chew through, and an enemy Butcher at full Overload folds faster. Damage over Time ticks are unaffected, as always \u2014 they ignore Defense entirely. The defense calculator and the survivability figures on it were reading the same engine, so they change with it.',
    'Combat Simulator: the “Healing done” figure now counts leech and reactive repairs, not just cast repair skills. A ship that repairs itself off the damage it deals (Magnolia, Valerian, the Leech gear set) or that repairs when it is hit (Isha) used to show the repair under “Healing received” with “Healing done” sitting at 0 beside it — the HP visibly came back and nobody was credited for it. Those self-repairs now read the same in both columns, on your ships and the enemy\u2019s alike. Repair Over Time ticks stay out of “Healing done” on purpose — a tick is not a repair the holder performed — so a ship topped up by a HoT still shows that under “Healing received” only.',
    'JSON diff calculator: an equipment change whose piece has no name no longer shows as “undefined ★ undefined”. When a gear piece moved between ships the label was meant to fall back to the other file’s copy of that piece, and then to “Unknown Equipment” if neither file named it — but the fallback could never fire, because the text it was falling back FROM always counted as present (it contains a star, so it was never empty even when the rank and name inside it were both missing). Compare two exports where a piece is named in only one of them and the change now reads with the name from the file that has it, instead of “undefined ★ undefined equipped from Kestrel → Magnolia”.',
    'Combat simulator: the health bars now read each ship\u2019s real health instead of working it out. The bar was calculated as maximum health, minus damage taken, plus repairs received \u2014 and the only repairs it counted were repairs a ship CAST (plus Repair Over Time ticks, added recently). Every other way a ship regains health was invisible to it. The biggest one is a passive that repairs a ship for a share of damage: Magnolia repairs itself for 20% of the damage it deals (40% on its second passive), Valerian for 15%, and the Leech gear set gives any ship the same at 15%. In a fight: put Magnolia at the front, let an enemy hit her for 2,500 a round while she hits back for 4,000 and repairs 800 of it \u2014 her bar used to show her sliding toward red at exactly the same rate as a Magnolia with no passive at all, while the ship itself was hundreds of points healthier every round. Reactive repairs \u2014 the \u201cwhen this happens, repair\u201d passives \u2014 were missing the same way. So was surviving on Cheat Death: a ship saved at 1 health drew an empty bar, as though it were already destroyed. The low-health colour, the cell\u2019s percentage label and the health card on each ship all read from that same figure, so all three were wrong together. A second, quieter error goes with it: the old sum counted the WASTED part of a repair, so a ship repaired past full sat pinned at 100% when it was really up to 5 points short \u2014 you will see a few bars in heavily-repaired teams read just below full where they used to read exactly full. That is the bar telling the truth, not a nerf; no damage, repair or shield number changed anywhere. The \u201cHealing received\u201d figure beside it was wrong in the same way and is fixed too \u2014 see the next entry.',
    'Combat simulator: \u201cHealing received\u201d now counts every way a ship regains health, not just repairs it was the target of a cast. The figure was added up from repair events, and only two kinds of repair produce one: a repair a ship CASTS, and a Repair Over Time tick. A passive that repairs a ship for a share of damage produces neither, and neither does a reactive repair \u2014 so both were counted as nothing. In a fight: put Magnolia at the front and let her hit for 4,000 a round while she repairs 800 of it back; her ship card read \u201cHealing received 0\u201d every single round of the battle. It now reads 800. The board shows it too, because the marker on each cell reads the same figure: a ship whose only health gain that round came from a leech now shows a repair marker instead of none. The figure is read straight off the engine\u2019s own per-ship repair total, the same way the health bars started reading real health. That total had two blind spots of its own on the ENEMY side, both fixed here: an enemy repairing an enemy ally with a cast, and an enemy holding a Repair Over Time. Without those, switching over would have taken every enemy ship\u2019s figure from correct to 0. Two things worth knowing about what the number means. It is the repair that ARRIVED, before any of it is wasted \u2014 a ship repaired for 10,000 while only 2,000 short reports 10,000 received, which is how this figure has always worked for cast repairs. Repair Over Time was the one exception, counted after waste, so a tick that overshoots a nearly-full ship now reports the full tick rather than the part that fit. And a repair reversed by Zosimos\u2019s Reversed Repairs still counts as nothing received, on both sides, since that ship lost health rather than gaining it. Your healing calculator is untouched: it reports your own side only and filters enemy ships out of this total before it reads it.',
    'Combat simulator and calculators: Repair Over Time now actually restores health to the ship carrying it. Two separate gaps were keeping it from doing so. First, no ENEMY ship ever received a tick — not a reduced one, none at all. Flamel grants itself Repair Over Time I (active) and II (charged), Oleander grants itself II on its charged skill and hands II to an ally that inflicts a debuff, and Graphite hands allies III whenever an attacker or debuffer of theirs is hit; all three of those ships appear on the enemy side, so every fight against one was simulated with the enemy healing less than it really does, which made your damage and clear-time estimates look better than they are. In a fight: an enemy Flamel fires its charged skill and takes Repair Over Time II, and from that same turn onwards it regains 15% of its own maximum health every turn on top of the one-off repair — health you now have to chew through. Second, on YOUR side only the ship you had picked as heal target gained the health: every other ally holding a Repair Over Time was credited for the repair in the report but never actually gained a point of health. So a Flamel who was not your heal target got nothing from its own buff, and every ally Graphite or Oleander topped up got nothing either. All of them are repaired now. The amount is unchanged — it is still a share of the maximum health of the ship that GRANTED the buff, not of the ship holding it, and it is still credited to the granter — and a Repair Over Time tick still does not count as a repair performed, so it sets off no “when this ship repairs” passives on either side. It does, however, count as the ship having been repaired that round, which is what Nayra’s charged skill looks for before it purges and inflicts — so a Nayra now answers an enemy topped up by its own Repair Over Time, and an enemy Nayra answers an ally of yours the same way. That was already true of whichever ship you had picked as heal target; it is now true of every holder. The simulator’s health bars show it too: they are worked out from damage taken and repairs received rather than read straight off the ship, and a Repair Over Time tick was not one of the repairs they counted — so a topped-up ship’s bar used to sit at its damaged value while the ship itself was healthier than it looked. The board marks it as well: a ship that ticked and took no damage that round now shows a repair marker on its cell. A ship that also took damage still shows the damage marker, as before. Expect healing totals on the healing page to rise where allies other than your heal target were holding one, and enemies in the simulator to last a little longer.',
    'Combat simulator and calculators: Inc. Repair Down now actually reduces the repairs landing on the ship carrying it. Nine ships inflict one of these and every one of them was doing nothing at all \u2014 Amartya, Larkspur, LeSabre, Ripper, Ruiner, Sansi, Shashou and Sha Xing inflict Inc. Repair Down I/II/III (-25/-50/-75% incoming repair), and Nayra and Ruiner inflict Out. Repair Down II (-50% outgoing repair). The debuff landed and stood on the ship for its full duration, but no repair ever read it: only a matching effect a ship had put on ITSELF was ever counted. In a fight: Ripper hits your Cultivator with Inc. Repair Down II, then Pallas repairs Cultivator for 8,000 \u2014 that repair now lands for 4,000 until the debuff runs out. Out. Repair Down works the other way round, on the healer: with Nayra\u2019s copy standing on your Pallas, everything Pallas repairs is halved no matter who receives it. A repair a ship performs on itself is covered too, and so is a repair that lands in the opening round before the debuffed ship has taken its first turn \u2014 which is the common case, since most of these are inflicted by a damage clause. It also holds when the ship inflicting it is SLOWER than its victim, which matters because Larkspur, Ripper, Sha Xing and Sansi apply theirs for a single turn: a slow Ripper hitting your already-acted Cultivator with Inc. Repair Down II still halves the repair Pallas sends afterwards, instead of the debuff expiring having done nothing. Tiers do not stack: an Inc. Repair Down II already standing shrugs off a Down I. An Inc. Repair Up II on the same ship cancels a Down II exactly, back to a full repair. Enemy ships suffer your Inc. Repair Down the same way. One repair channel was still exempt when this first landed \u2014 a passive that repairs a ship for a share of damage \u2014 and the entry below closes it.',
    'Combat simulator and calculators: a passive that repairs a ship for a share of damage now obeys Inc. Repair Down and Inc. Repair Up, like every other repair. Magnolia repairs itself for 20% (40% on its second passive) of the damage it deals, Valerian for 15%, and the Leech gear set gives any ship the same thing at 15% \u2014 and all of them ignored the incoming-repair debuffs and buffs standing on the ship being repaired, so a -50% debuff changed such a repair by nothing at all. In a fight: your Magnolia, wearing nothing special, hits for 10,000 and repairs itself for 2,000 \u2014 but enemy Larkspur has already tagged it with Inc. Repair Down II (-50% incoming repair), so that self-repair now lands for 1,000 until the debuff runs out. It works in the other direction too: with Inc. Repair Up II standing on Magnolia instead, the same 2,000 becomes 3,000 — and that now holds from the very first round of the fight. It used to take until round 2: the buff you had set on the ship was read off the previous turn it took, and in round 1 there was no previous turn, so the first hit of a fight leeched the unmodified amount for your own ships. Enemy ships obey your Inc. Repair Down the same way, so an enemy Magnolia you have debuffed claws back less health from your team. Two things are deliberately unchanged. A SHIELD from a passive of the same shape is unaffected \u2014 Malvex and Quixilver both shield for a share of the damage they take, and a shield is not a repair. And Out. Repair Down, which belongs to the ship performing a repair, still does not touch these: a ship repairing itself off its own damage is the recipient, not a healer sending a repair elsewhere. Finally, if the leeching ship is carrying Zosimos\u2019s Reversed Repairs, it is the REDUCED amount that burns it \u2014 a halved 2,000 leech costs it 1,000 health, not 2,000.',
    'Combat simulator and calculators: a passive that reacts to something happening to \u201can ally within the active pattern\u201d now checks that the ally really is inside the pattern. Three ships say that, not just one: Fuying inflicts Stasis when a Stealthed ally is hit, Cultivator repairs an ally that is hit, and AEGIS grants Defense Up II and cleanses all debuffs when an ally\u2019s shield is destroyed. The pattern limit was being read off the ship receiving the effect rather than off the ally that set the passive off, which is what the skills actually say. The visible change is Fuying\u2019s: she was answering a hit on any Stealthed ally anywhere on her side, so on a test board where one ally stood outside her pattern and was hit twice a fight she inflicted 6 Stasis instead of 4. Cultivator and AEGIS behave exactly as before \u2014 their effects land on the very ally that triggered them, so they were already stopping at the pattern edge \u2014 and are now held to the rule in both places. In a fight: put Cultivator mid-board and an ally two rows away, let an enemy area attack catch that ally, and Cultivator does not reach it \u2014 no 8% repair \u2014 while an ally standing inside her circle is repaired every time it is hit. Move the ally in and the repair starts arriving. AEGIS\u2019s own shield being destroyed still sets off its own passive, since its pattern covers the slot it is standing in. Enemy ships are held to the same rule against you.',
    'Combat simulator and calculators: Fuying no longer inflicts Stasis on a hit that was never supposed to trigger it — her reactive counter now waits for an ally who is actually in Stealth, as her skill says. “When an ally in Stealth within the active pattern is directly damaged, this Unit inflicts Stasis for 1 turn onto the enemy” was ignoring the Stealth half entirely and firing on any ally being hit. On a test board where nobody on the team was Stealthed at all it kept inflicting Stasis anyway, hit after hit; it now hands out none. Where it does belong, nothing has been taken away: Stealth a Tianchao ally, let an enemy area attack catch that ally, and the enemy is put in Stasis — on every qualifying hit, since the skill sets no limit. Being hit does not strip Stealth, so an ally can keep answering hit after hit. Enemy Fuyings punish your attacks on their Stealthed allies the same way.',
    'Combat simulator and calculators: Stealthed Tianchao allies now actually take less damage from Fuying’s passive, as her skill says. “All Tianchao allies with Stealth take 30% less direct damage” had already been stopped from firing as an attack on the enemy by the ship data refresh below — but as a defensive reduction it was doing nothing at all: every other damage-reduction passive in the game protects the ship carrying it, so a reduction meant for OTHER ships had nowhere to go and was silently dropped. Put a refit-4-or-higher Fuying on the board, Stealth a Tianchao ally standing inside her targeting pattern, and a 10,000-damage hit on that ally now lands for 7,000. Being Stealthed does not stop a ship being hit — it only stops the enemy choosing it — so this comes up constantly: an area attack aimed at someone else still catches the Stealthed ally, and now it hurts less. Three things it deliberately does not cover: an ally standing OUTSIDE her pattern takes the full hit, a XAOC ally inside it takes the full hit, and Damage over Time ticks are unreduced because the skill says “direct damage”. Fuying herself gains nothing from it, since her own Stealth grant never includes her. Below refit 4 the reduction is 15% instead of 30% — that covers an unrefit Fuying too, not just refits 2 and 3. Enemy Fuyings protect their own side the same way.',
    'Combat simulator and calculators: a damage-reduction aura that protects allies now stops when the ship carrying it is destroyed. Fuying’s “all Tianchao allies with Stealth take 30% less direct damage” kept protecting her allies for the rest of the battle after she went down, because the reduction was handed to each ally once at the start of the fight and never asked who it came from again. In a fight: round 2, Fuying alive, a Stealthed Tianchao ally is hit for 10,000 and takes 7,000. Round 3, with Fuying destroyed and that ally still Stealthed and still standing in the same slot, the same hit now lands for the full 10,000 instead of 7,000. Nothing changes while she is alive, and every other damage-reduction passive in the game is untouched — those protect the ship carrying them, and a destroyed ship takes no hits. Enemy Fuyings lose their aura on death the same way.',
    'Combat simulator and calculators: only Tianchao allies receive Fuying’s Stealth now, as her skill says. “Grants Tianchao allies Stealth for 1 turn” was reaching every ally the skill covered, and Stealth is what makes a ship untargetable — so this was not a number being a little high, it was allies the enemy could not shoot at all. Only 14 of the 149 ships are Tianchao, so on a typical five-ship team most of the allies protected were ships that should never have been. Cast it now with a Tianchao ally and a XAOC ally both inside her pattern and only the Tianchao one goes into Stealth; the other stays a valid target. Her companion Security Up III grant is untouched — it still reaches everyone the pattern covers. Enemy Fuyings get the same treatment against you. In the skill editor, an ally-targeted grant of any type except a charge grant can now be given a recipient faction of your own, alongside the ship’s targeting pattern.',
    'Combat simulator and calculators: Fuying’s charged-skill cleanse now scales with her crit power, which also means it needs crit power to work at all. The skill text says she cleanses a debuff “for every 50% crit power this Unit has,” matching Amartya’s identically-worded purge, but the scaling was being discarded and she always cleansed exactly 1 regardless. Read literally, that is one cleanse per full 50: her base crit power is 20, so an ungeared Fuying now cleanses nothing, 50 crit power gets you 1, 100 gets 2, and 150 gets 3. If you were relying on that cleanse, gear her for crit power — below 50 it no longer fires.',
    'Combat simulator and calculators: the second half of Fuying’s charged skill — extending Stealth by 1 turn — now actually does something; that clause was producing no effect at all. It reaches every ally in her targeting pattern — unlike her Stealth grant, it names no faction, so a non-Tianchao ally standing inside the pattern is extended too, while an ally standing outside it, Tianchao or not, gets nothing. Only Stealth’s own remaining duration grows; any other timed buff the same ally is holding is left alone. In a fight: Fuying Stealths an ally for 1 turn on her active, and the following turn her charged skill lands and makes it 2 — the ally stays untargetable, and keeps the damage-reduction aura, for an extra round.',
    'Ship data refresh: Fuying and Prophet join the roster, and Zosimos\u2019s skills have been reworked in game. The new text exposed four faults, all fixed. Prophet did nothing at all: both its skills deal damage equal to a multiple of its Security (50x, and 120x when charged), a form no other ship uses and one the game-text reader could not read, so the ship was built with no attack whatsoever and sat there for the whole fight. It now attacks for what its Security says it should. Its passive was also handing it a free extra action every single round \u2014 roughly doubling its output \u2014 when the skill only grants one in reaction to resisting a debuff. Fuying\u2019s passive, which makes Tianchao allies in Stealth take less damage, was being read as a 30% attack on the enemy: a defensive aura had become an extra offensive hit. Fixing that stopped the attack, but left the reduction itself unmodelled \u2014 it did nothing at all until the follow-up below taught the engine to apply it to allies. And Zosimos\u2019s charged skill was inventing a repair worth 300% of its own maximum health, because the status it inflicts is called \u201cReversed Repairs\u201d and the word \u201cRepairs\u201d in that name was mistaken for an instruction to repair, then paired with the 300% belonging to the damage clause \u2014 nine status names in the game contain the word \u201cRepair\u201d, so this could have struck any of them. Zosimos\u2019s charge stripping now also happens when the enemy repairs, as the skill says, rather than when Zosimos casts. Still not modelled and tracked separately: Prophet\u2019s Shield Penetration growing as allies resist debuffs. (See the entry above.)',
    'Combat simulator and calculators: Voron and Orel no longer turn bomb damage into a Damage over Time effect. Their passive converts the damage they receive into a DoT, but that applies to direct damage — a bomb going off on them, and the splash from a bomb on a neighbour that was destroyed, are detonation damage, so both now land as damage right away instead of being deferred. Previously an explosion on Voron did nothing to it that turn and trickled in over the following three rounds, which also meant a bomb could never finish it off. Expect these two ships to take noticeably more immediate damage in fights involving bombs.',
    'Combat simulator and DPS calculator: a bomb or Echoing Burst that goes off on a ship being protected by an ally no longer counts the damage twice. Protection sends part of every direct hit to the protecting ally, and a detonation is a direct hit — but the exploding ship’s “Damage taken” card was still charged the full burst while the protector’s card was charged its share as well, so one explosion showed up on two ships’ cards and inflated the attacker’s “Damage dealt” to match. Each card now shows what that ship really took. The same fix covers two rarer cases: a ship whose passive blocks incoming damage now shows nothing taken from a burst it fully blocked (it was showing the full amount against zero health lost), and a ship whose passive turns hits into Damage over Time now has the deferred part counted as it ticks rather than up front. Any “restore health from damage dealt” effect on the exploding bomb is paid on that corrected figure. On the DPS page this also stops the redirected part of a burst from being misfiled as direct damage in the per-round breakdown.',
    'Combat simulator: confirmed and pinned — a bomb that explodes and destroys the ship carrying it also splashes that ship’s neighbours, exactly as it does when the ship is destroyed by an ordinary attack. So a lethal detonation pays out twice from one bomb: the explosion on its carrier, then the splash on the ships beside it. No change in behaviour; this was verified in game and is now locked down so it cannot be “tidied away” later.',
    'Autogear: the Genetic algorithm now honours “Use upgraded stats” when it ranks gear. It was scoring sub-level-16 pieces from their stored stats while every other algorithm scored them from their simulated level-16 stats, so the same inventory and the same settings could recommend different gear depending only on the algorithm you picked. With “Assume all gear is calibrated” switched on as well the gap widened further, because the calibration bonus was being applied to the un-upgraded stat — half or less of the value the other algorithms saw for flat attack. Reported stats were always correct; it was the ranking that drifted.',
    'Healing calculator: a repair whose skill names the worst-hurt ally now goes to that ally instead of the ship you picked as heal target. Pallas repairs \u201cthe other ally with the lowest current health percentage\u201d, Volk \u201cthe ally with the most missing health\u201d and Valkyrie \u201cthe ally with the lowest current health percentage\u201d \u2014 all three were being routed to your chosen heal target regardless, so the reported repair described a ship the skill would never have picked. The recipient is now read off the skill text: the living ally with the lowest share of its HP remaining, wherever it stands, and the caster is never the recipient \u2014 with no other ally alive, these repairs land on nobody rather than topping the caster up. The combat simulator already routed Pallas and Volk this way. Valkyrie changes there too: her twin repair after an explosion was landing on herself twice over, and the half meant for an ally now reaches the ally in the worst shape.',
    'Combat simulator and healing calculator: a repair that fires in reaction to something now actually restores health to the ally it picked. These repairs — a ship repairing the ally that was just hit, the ally it just cleansed, or itself — were counted in full in the healer’s totals but only ever topped up the ship you had chosen as heal target, so whenever the repair picked any other ally that ally gained nothing. Now each one lands where it was aimed: a team-wide reactive repair such as Salvation restores every living ally rather than one, a ship that repairs itself in reaction gains the health even when it is not your heal target, and the per-ally healing table shows where each repair really went. Enemy ships get the same treatment.',
    'Combat simulator and calculators: a skill that clears a debuff from an ally now clears it from every ally the skill reaches, instead of picking out a single ship. AEGIS, Cultivator, Harvester, Makoli, Nyxen, Paracelsus and Purifier all have one, and on most of them the very same sentence also grants a buff to everyone the skill covers — “grants Defense Up III and cleanses 1 debuff” — so the two halves of one sentence were landing on different ships. Two follow-on effects widen with it: Cultivator’s passive repair, which follows whoever it just cleansed, now repairs each of those allies rather than one, and Pestilence’s Corrosion, which punishes an enemy for cleansing, now lands on every enemy that was cleansed. Enemy ships using these skills against you get the same wider reach.',
    "Combat simulator and calculators: a ship whose skill targets its own allies now faces no enemy at all on that turn, instead of being handed an invisible stand-in opponent. Its repair, shield or buff is unchanged, but the questions that actually shaped the turn — is the enemy shielded, what is its Defense, what damage-over-time effects is it carrying — are now answered with \u201cthere is no enemy\u201d instead of with a healthy stand-in's stats. A few remaining readings still fall back to neutral defaults on such a turn; no ship in the game currently reads them, and they are tracked separately. One visible consequence: repairs and shields from these ships are now labelled in the combat log with the skill that produced them (AEGIS's charged Barrier, Hermes's and Mender's repairs), because the stand-in was previously opening an empty attack line that claimed the label and was then discarded. Support skills also no longer set off allies' \u201cwhen an ally critically hits an enemy\u201d passives, since a repair is not a hit \u2014 the matching \u201ccritically repairs\u201d passives are unaffected.",
    "Combat simulator and calculators: the same rule now applies to ENEMY ships whose skill targets their own allies. An enemy supporter's cast was being pointed at one of your ships \u2014 whichever ship you had picked as heal target, or your first team ship in a battle \u2014 even though the skill never aimed at you: it read that ship's Defense, its Damage over Time stacks and its health, and anything enemy-facing on the cast would have landed there. It now faces no enemy at all on such a turn, exactly as your own support ships do, and its buff, shield or repair on its own side is unchanged. No enemy in the current roster mixes ally-targeted support with an enemy-facing clause, so no reported number changes today; the simulator is now correct for one that does, and for a custom skill that mixes the two.",
    "Combat simulator and calculators: a ship that hits back with a debuff or a Damage over Time effect now rolls to land it against the ship it is actually hitting. Passives like Flamel's Speed Down and Stasis, Warden's and Shepherd's Corrosion, Iridium's and Opal's Speed/Attack Down and Sansi's Inc. Repair Down all fire in reaction to being attacked, but the chance of the effect landing was taken from whichever enemy that ship last aimed its own skill at — so retaliating against a well-defended ship was as easy as against a soft one, and vice versa. It is now your ship's Hacking against that specific enemy's Security, as it should be. Expect these passives to land more often against low-Security enemies and less often against high-Security ones.",
    'Combat simulator and calculators: a fight now ends the moment one side has no ships left, instead of playing out the full round count. The match stops at the end of the turn that destroys the last ship, so rounds after that no longer appear as empty rows, and every per-round average is measured over the rounds the fight actually lasted. This matches the game, where the battle ends mid-round as soon as the last opposing ship goes down. The healing calculator shows this most plainly: if your heal target is the only ship on your side and it dies, the report now stops there rather than continuing with rows in which nothing happens.',
    'DPS calculator: the buffed stats shown for each config now come from the simulation rather than a separate estimate. The crit multiplier and a new average buffed attack/crit line are read from your ship’s live stats on every turn it takes and averaged across the run, so a buff that only lands partway through counts for the part of the fight it was actually up, and conditional buffs count only in the rounds their condition held. Hovering a round in the chart now also lists the buffs and debuffs still standing at the end of that round — including debuffs the enemy has put on you, now that it fights back.',
    'DPS calculator: the target is now a real enemy ship rather than a passive dummy. You can pick an actual ship for it — filling in its stats and skills — or set them by hand, and it takes its own turns. Its attack defaults to 0, so by default your ship still takes no damage and comparisons stay a clean measure of output. Give it an attack value and it starts hitting back, which is what lets ships built around being hit — counterattacks, reflects and on-hit triggers — finally contribute their real damage; your ship can also be destroyed then, ending the run. Each config and team ship additionally picks the board slot it fights from, which affects targeting patterns and adjacency.',
    "DPS calculator: passives that deal damage in reaction to something now actually hit the enemy and count toward the total. Judge, Incinerator, Rhodium, Chakara, Grif, FrontLine, Paracelsus and Vindicator all deal damage from a passive rather than from their attack, and here that damage was worked out and then discarded — the enemy lost no health from it and it never reached the damage total. Several of them fire on the ship's own turn, so they were understated even against an enemy that never attacks back. The combat simulator was already correct.",
    'Combat simulator: multi-hit, enemy passive/charge, barrier lifecycle, dead statuses, reactive DoTs/bombs, clause order, pattern scope, damage accounting.',
    'Combat simulator: Centurion retaliates once per incoming attack instead of twice. Its passive answers both a hit on itself and a hit on an adjacent ally, and an area attack that caught Centurion and a neighbour in the same blow set off both halves — so it hit back twice for one attack. A multi-hit attacker still draws one retaliation per hit, as before.',
    "Combat simulator: an attack that hit nobody no longer pays out its riders. When a ship's target died before it acted, the attack still reported its damage as if it had landed, so effects that trigger on dealing damage (Burner's Inferno, Warpstrike's debuff-duration reduction, Zeolite's purge) fired off a swing at thin air.",
    "Combat simulator: a repair that restored nothing no longer opens a line in the combat log, and no longer counts as a repair for the passives that punish repairing (Ruiner's Bomb, Overload, Zosimos's charge removal, Amartya's Defense Shred). Reactive repairs already worked this way; cast repairs now match them. A repair that lands in full on an already-full ship still counts — it happened, the ship was simply topped up.",
    'Combat simulator: skills that repair or shield for a share of the damage they deal now count the whole attack. FrontLine, Iridium, Opal, Pallas, Quixilver and Tithonus all have area attacks, but only the damage on the main target was counted — so they repaired for roughly half to a third of what they should (Tithonus about 2x low, FrontLine about 2.3x low). They now count every enemy the attack landed on. The same fix stops them paying out when the attack delivered nothing at all — a hit turned entirely into a Damage over Time effect (Voron, Orel), or a swing at a target that died first, now repairs nothing instead of repairing in full. Damage redirected to an ally by Protection still counts. In the combat log these repairs now appear after the attack line rather than before it, since they are scaled off that attack. The DPS calculator is unchanged. In the healing calculator these repairs are now worked out from the damage your healer really does to the enemy team it is fighting — every enemy an area attack catches, and each enemy’s own Defense — instead of from a stand-in target, so a healer that sustains off its own damage reports a different (and more honest) amount than before.',
    'Healing calculator: effective repairs and over-repair now describe the ship you picked as the heal target, not everything the healer put out. Now that repairs land on every ally the healer’s support pattern reaches, those two numbers were quietly counting repairs that went to other allies as well. Total healing, direct and over-time repairs are unchanged — they still measure the healer’s own output. Two things that were previously reported as zero now show up: repairs an ally puts on your heal target (an ally-granted repair-over-time, for instance) count toward what landed on it, and a per-ally breakdown is now available for anyone reached by the same repair.',
    'Healing calculator: the calculator now fights a real, positioned enemy team. Your healer, the ship it is keeping alive, your team ships and every enemy each pick the slot they fight from, and repairs follow your healer’s real support pattern — so one cast can reach several allies at once, while an ally standing outside that pattern receives nothing at all. The page now warns you by name whenever an ally is out of reach, since a zero like that is otherwise indistinguishable from a broken calculator. Enemies have their own HP, Defense and Security and can be destroyed, which cuts the damage coming at you for the rest of the fight, and their Defense is what your healer’s attack is measured against. Unplaced ships start on sensible cells — the heal target is placed inside your healer’s support pattern where there is one — but it stands mid-board rather than up front, so move it forward if you want it taking the enemy’s fire.',
    'Healing calculator: a new Healing by ally table under the charts shows effective healing and over-repair for every ship a repair actually landed on, with the ship you chose as heal target marked as the primary row. It counts what each ally received, while the healer’s own summary counts what the healer produced wherever it went, so the rows are not meant to add up to that total — and an ally missing from the table received nothing at all.',
    'Healing calculator: the Healing by ally table and the Team Healing figure now only ever list your own ships. An enemy that repairs itself off its own damage (Magnolia and Valerian both do, and you can pick either as an enemy) was being credited as a healed ally — in one measured case the table’s only row was the enemy, with your real heal target missing entirely — and its self-repair was also being added to Team Healing. What the enemy heals is still applied to the enemy in the fight; it simply no longer shows up as healing for your team.',
    'Healing calculator: enemies you pick now use their own real targeting, so an enemy with an area attack hits everything its pattern covers instead of only one of your ships, and spreading your team out matters against them too.',
    'Healing calculator: you can now remove every enemy. With an empty enemy team nothing shoots back, so the run shows your healer’s pure output — every point of it counted as over-repair against a full-health target. Your healer’s own numbers are unchanged: the calculator stands in a practice target carrying the same stats a default enemy card has, minus its attack, so emptying the team changes only the damage coming at you.',
    'Healing calculator: support healers whose skill targets allies now deal their skill’s damage properly. Their attack was aimed at nothing, so any damage in the skill — and any repair or shield scaled off that damage — came out as zero. No current ship’s skill mixes ally-targeted support with a damage clause, so no reported number changes today, but the calculator is now correct for one that does. Hovering a round in the healing chart also spells out that Direct/HoT/Shield measure what your healer produced while Effective/Overheal measure what landed on the heal target, and a round where only an ally’s repair landed is no longer labelled as having no output.',
    'Healing calculator: an enemy you placed yourself no longer gets pushed off its slot by one you left on auto. When the first enemy in the list had no slot chosen, the cell picked for it automatically claimed the front-middle position ahead of an enemy you had explicitly put there, bumping your enemy back to a rear corner — so your healer attacked the wrong one and the enemy team fought from a board you had not asked for. Explicit placements now always win the cell, and an automatic one moves aside instead.',
    'Skill editor: a passive that inflicts a Damage over Time effect or a debuff is now flagged when its trigger names no enemy — at the start of a round, for instance. Nothing lands in that case, so the combat log would report the effect every round while your damage never moved. The warning points you at a trigger that does name an enemy, and it also shows up on abilities you saved earlier.',
    'Combat log: turn ordering, buff granter, bomb attribution, duration reductions, no-op lines removed.',
    'Autogear: defence/crit priority weighting.',
    'Recruitment calculator: Centurion beacons.',
    'DPS calculator: per-round and total damage numbers no longer show a long decimal tail.',
    'DPS calculator: the per-round tooltip and the damage-type breakdown show real Direct damage again instead of 0.',
    'DPS calculator: the secondary and conditional damage rows in the config summary are populated again.',
    'DPS calculator: affinity advantage and disadvantage affect damage again — the matchup was being ignored once the calculator started fighting a real enemy.',
    "Combat simulator and DPS calculator: a debuff a ship applies when it critically hits now lands on the enemy it actually hit. Enforcer's is the one in the current roster, and it was being applied to nothing — so the damage boost it is supposed to give never arrived. An area attack that crits several enemies now debuffs every enemy it crit, and the same fix applies to enemy ships using it against you.",
    'DPS calculator: an enemy debuff that your Hacking failed to land no longer boosts your damage anyway. The round-by-round breakdown already reported it as resisted, but the damage number was computed as though it had landed every time — so a ship with low Hacking read the same total as one that landed the debuff on every round. Debuffs that are guaranteed rather than Hacking-based are unaffected.',
    'DPS calculator: the Corrosion, Inferno and Bomb counts in the round-by-round breakdown show what is actually on the enemy again. They were reading a stand-in target that no longer takes part in the fight, so every round reported zero standing stacks and an empty damage-over-time list even while those effects were ticking and their damage was counted correctly — only the display was wrong. With more than one enemy on the board the counts now add up across all of them, and the list names every effect standing on any of them.',
    'DPS calculator: a timed debuff you set up for the enemy now runs out when it should. Its duration was being counted down by the stand-in target that no longer acts, so once it landed it stayed up for the rest of the run — a 2-turn debuff behaved as if it were permanent, inflating damage for every round after it should have dropped. The countdown now happens once per round regardless of how many enemies are on the board.',
    'DPS calculator and combat simulator: Echoing Burst deals damage again. The set gathers the damage your team deals over a couple of turns and then detonates for a share of it, but it was reading a damage channel that stopped being filled once fights moved to a real positioned enemy — so it gathered nothing, went off on schedule, and dealt exactly zero every time. It now gathers what your side really dealt that round, including your team ships, and an enemy running the same set now gathers your enemies’ damage in the same way.',
    'DPS calculator and combat simulator: a passive that adds its own damage hit whenever the ship attacks now actually lands. Snakeroot (which hits harder the more damage-over-time stacks are on the enemy) and Provider (whose extra hit follows an ally landing a debuff) are the two ships in the current roster with one, and their extra hit was worked out and then thrown away — the enemy lost no health from it and it never reached the damage total, so both read lower than they should. The hit now lands on the enemy the passive itself names rather than on whatever your attack happened to have caught, and enemy ships with such a passive do the same to you. Passives that fire on a trigger of their own — Judge, Incinerator, Rhodium and the rest — go through a different path and were never affected.',
    'Healing calculator and combat simulator: a passive that repairs or shields for a share of the damage the ship deals now also pays out on damage-over-time ticks. Magnolia and Valerian both have one, and the Leech gear set gives every ship the same thing — but it only ever paid out on the damage from the attack itself, so all the Corrosion and Inferno damage ticking away on the enemy healed nothing. It now pays out on those ticks too, and an enemy ship with the same passive repairs itself the same way when its damage-over-time ticks on one of your other ships — including when it ticks on the ship you picked as the heal target.',
    'Healing calculator and combat simulator: that same repair-from-damage effect now also pays out on bomb explosions and on damage dealt from a passive, and the damage-over-time gap on the ship you picked as heal target is now closed too — previously it only paid out on a direct hit. Magnolia, Valerian and the Leech gear set are the ones with this effect, and each of those other damage sources was quietly healing nothing. All of them now count properly, on both sides of the fight.',
    'Combat simulator: a custom ability condition gated on an enemy\'s health now checks the enemy it actually targets, not a stand-in. A condition like "enemy below 50% health" was being checked against the wrong ship and so could never be satisfied — it now reads the real target\'s health and fires correctly.',
    'DPS calculator: an enemy with no HP no longer reports zero damage. Clearing the Enemy HP field, or setting it to 0, produced an enemy that could not be hit at all — every attack passed straight through it, so the damage total came back as zero and the whole run looked broken. The field still accepts an empty value or a 0; what changed is what happens next. An enemy left without any HP is now treated as a real ship with substantial health, so the fight runs its full length and reports real numbers instead of nothing. The same applies to the combat simulator and the healing calculator, where an enemy left without HP is now a genuine target rather than an invisible one.',
    'Autogear: a new "Assume all gear is calibrated" option scores every calibration-eligible piece (5-6 star, level 16) as if it were calibrated to the ship you are gearing. Calibration boosts a piece\'s main stat substantially, so previously an already-calibrated piece would beat a better uncalibrated one on a bonus the challenger could equally have had — the optimizer kept recommending whatever you had already calibrated and never showed you the piece worth moving the calibration to. Turn it on to see the real ceiling. Combine it with "Include calibrated gear" to also re-use gear currently calibrated to another ship, and with "Use upgraded stats" to include gear you have not levelled to 16 yet. The current-gear side of the comparison gets the same treatment, so the difference you see is the gain from swapping gear rather than from calibrating what you already wear. Suggested pieces that would need calibrating are marked "Requires calibration" — the mode can recommend more calibrations than you can actually afford.',
    'Combat simulator, DPS and healing calculators: Valkyrie’s repair now fires when her own Echoing Burst goes off, and only then. Her passive reads “when an Echoing Burst explodes on an enemy, this Unit and the ally with the lowest current health percentage repair 5% of damage dealt” — but it was wired to Bomb explosions instead, which is a different effect entirely. So it paid out on a teammate’s Bombs (Demolisher’s, for instance) and never once on her own Echoing Burst: run her as your only bomb-family ship and the passive was silent, pair her with a Bomb ship and it fired on the wrong explosions. It now follows the Echoing Burst her charged skill plants, and an enemy Valkyrie repairs its own side the same way. Demolisher’s and Lingshe’s Bomb passives are unchanged.',
    'DPS calculator: the Enemy HP figure in the round chart now reports the enemy\u2019s real health on every round. It was read off whichever enemy your ship hit that round, so on a round where your ship hit nothing \u2014 it was destroyed before its turn, or it cast on an ally \u2014 there was nothing to read and the tooltip fell back to \u201c100%\u201d, even with the enemy nearly dead. It now reads the enemy team\u2019s own health, so those rounds tell you the truth. Two smaller consequences: on a round where a faster team ship attacked before your ship, the figure no longer quietly includes that ship\u2019s damage (it is the health the enemy had ENTERING the round, which is what your ship\u2019s below-X%-health skills were checked against), and with more than one enemy it is their combined health rather than one of them.',
    'DPS calculator: the round chart\u2019s team figure is now your whole team\u2019s output for that round \u2014 the ship you are testing plus every team ship \u2014 with the allies\u2019 own share shown beside it. It used to count only the team ships, which made it useless for the comparison the page is for: a different attacker buffs its allies differently and feeds their reactions differently, so it changes what the rest of the team puts out, and neither figure on its own shows that. Swapping the attacker now moves one number you can compare. Your attacker\u2019s own DPS totals are unchanged \u2014 team damage is still kept out of them \u2014 and the dashed \u201cwith team\u201d line and its kill mark read the same as before.',
    'Autogear: re-running the optimizer after changing what gear is worth no longer reuses the previous run\'s scores. Toggling "Use upgraded stats", or editing a gear piece and running again, could leave the Two-Pass, Set First and Beam Search algorithms scoring against the stale values from the run before. The Genetic algorithm was unaffected.',
    'Combat log: damage soaked up by an ally holding Protection now shows one line per stack, the way the game shows it. A 3-stack protector took the hit as three separate procs but the log folded them into a single line carrying the combined total, so the log and the game disagreed on how many times the ship had been hit. Health, shields and every reported number are unchanged — only the log now reads "4643" three times instead of "13929" once. A chunk that was fully absorbed or turned into a Damage over Time effect still shows nothing at all.',
    'Combat simulator, DPS and healing calculators: the share of a hit that Protection moves onto an ally is now worked out from the same numbers the hit itself used, for damage from a skill and from an always-on passive alike. To move part of a hit onto a protector the simulator has to undo the target’s Defense and re-apply the protector’s, and it was re-reading the target’s Defense from scratch at that moment instead of using the value the hit was calculated with — so it missed the attacker’s Defense Penetration and read a buffed Defense figure the hit itself had never used. Both made the protector take more than its share: about 7% too much against an attacker with 50% penetration, about 13% too much when the target was carrying a Defense buff. Meatshield and Lionheart are the two ships with Protection. The target’s own share was always correct; it is what the protector absorbed that was overstated.',
    "Combat simulator: Zosimos's charged skill now applies Reversed Repairs. While a ship carries it, every repair that lands on it damages it instead — for the repair's full value, ignoring shields, Protection and defence, and even at full health. A reversed repair can destroy the ship. The damage and any kill are credited to the ship that applied the debuff, not to the one whose repair triggered it, and the repair itself is not counted as healing or overhealing for its caster — the battle report shows the caster no healing done, the burned ship no healing received, and the lost health on its health bar and damage-taken total like any other damage. The combat log shows a row for each reversal. Cheat Death still saves the target. Previously the status did nothing at all.",
];

export const CHANGELOG: ChangelogEntry[] = [
    {
        version: '1.65.0',
        date: '2026-07-30',
        changes: [
            'Autogear: each selected ship now has up and down arrows to change the order gear is assigned in (the first ship gets first pick). If the selection came from a saved team, the new order is saved back to that team automatically — adding, removing or swapping a ship ends that link, so only the order is ever saved this way.',
            'Autogear: you can now save a multi-ship selection as a named team and load it back later — each ship returns with the role and stat priorities you already saved for it. The Add Team dialog can also build a selection from one of your saved encounters, ordered by the turn order you set in the formation.',
            'Combat simulator: added further skill support, engine tweaks, and more.',
        ],
    },
    {
        version: '1.64.0',
        date: '2026-06-19',
        changes: [
            'Simulator page (EXPERIMENTAL): new in progress combat simulator, with positioning, per round damage etc. More to come.',
            'Added squad leader page.',
            'Added targeting and pattern rules to ships.',
        ],
    },
    {
        version: '1.63.0',
        date: '2026-05-27',
        changes: [
            'DPS Calculator upgrades: team support ships (up to 4) contribute skill buffs and debuffs; buffs track active rounds with hover details; hacking/security stats model debuff landing probability; affinity scales hacking; corrosion DoT capped at 5000/1%/stack/round.',
            'Calculator pages auto-fill buff and debuff pickers from the selected ship\'s skill text, with a "skill" badge on pre-populated entries.',
            'Lore page audio reader — play ship bios and world lore via text-to-speech with a Play All option. Best in Edge.',
            'Autogear: implant type tweaks consolidated into a single Require / Exclude picker.',
            'Added proper 404 page',
        ],
    },
    {
        version: '1.62.0',
        date: '2026-05-19',
        changes: [
            'Calculator upgrades: buff pickers across DPS, Defense, Healing, and Speed; affinity modifiers and per-ship buffs (DPS); Security stat and Effective HP chart (Defense); charged heals and HoT simulation (Healing); Chrono Reaver ship selector with skill auto-fill.',
            'Ship Lore direct links; gear set dropdowns sorted alphabetically.',
        ],
    },
    {
        version: '1.61.0',
        date: '2026-05-13',
        changes: [
            'Added Engineering Optimizer — optimize your engineering spend to maximize the stats of your starred ships.',
            'Added Autogear All and Select All buttons — queue multiple ships for autogear at once from the starred ship alerts panel and the Suggested Next Autogear panel.',
            'Ship skills are now shown on the Ship Details page. The DPS Calculator auto-fills skill damage multipliers and detects "Start Charged" from your selected ship\'s skill data.',
            'DPS Calculator buff system upgraded — Attacker Buffs and Enemy Buffs / Debuffs are now picked from the full game buff list with automatic parsing, stack support, and defense penetration / DoT modifier calculations.',
        ],
    },
    {
        version: '1.60.0',
        date: '2026-05-07',
        changes: [
            "Gear Wishlist — track gear you're farming with flexible filters: slot, stars, rarity, set bonus, main stat, and substats.",
            'Import summary highlights wishlist hits in place of notable gear when matches are found',
            'Fixed several cloud sync and IndexedDB reliability issues',
        ],
    },
    {
        version: '1.59.0',
        date: '2026-05-04',
        changes: [
            'Updated profile page with a bunch of data management features. Disable cloud sync, clear cloud data. Moved backup/restore into profile.',
            'Added ship selection to calculator pages to quickly set own ships. ',
        ],
    },
    {
        version: '1.58.0',
        date: '2026-05-02',
        changes: [
            'Added Exclude implant types to autogear settings — users can now prevent specific implant types (e.g. Bulwark) from being used in autogear runs',
            'Added Buffs to autogear settings — users can now specify external stat buffs per ship in the autogear optimisation',
            'Added import summary to game import modal — shows the number of ships, gear, and implants imported',
        ],
    },
    {
        version: '1.57.0',
        date: '2026-04-27',
        changes: [
            'Added "Find Gear Upgrades" button to autogear results — navigates to Upgrade Analysis with ship, role, and stat priorities pre-filled and analysis auto-started',
            'Updated gear edit form to streamline upgrading gear.',
        ],
    },
    {
        version: '1.56.0',
        date: '2026-04-25',
        changes: [
            'Autogear settings redesigned — pick a role, then add stat priorities, set requirements, or stat bonuses via the new "Your tweaks" picker',
            'Reorder tweaks with up/down chevrons — order matters, higher tweaks weigh more',
            'Six rarely-changed filters tucked into an "Advanced options" accordion; "Ignore equipped" now defaults off',
            'Game data import validates with a schema and caps file size at 30 MB',
            'Sign-in modal redesigned — split-pane layout with a branded left panel and a tighter form on the right',
        ],
    },
    {
        version: '1.55.0',
        date: '2026-04-24',
        changes: [
            'Alt accounts — manage up to 5 additional game-account profiles under your login, each with its own ships, gear, engineering, loadouts, and optional public profile',
            'Switch profiles from the sidebar: click your profile picture to open the switcher dropdown',
            'Create, rename, and delete alts from the Profile page',
            'Drag and drop a game export JSON onto the Import button to import it — no file picker needed',
        ],
    },
    {
        version: '1.54.0',
        date: '2026-04-23',
        changes: [
            '"Use upgraded stats" auto-runs the upgrade simulation and considers unleveled gear at its simulated level-16 stats',
            'Autogear search space widened on large inventories for better results',
            'Many more implants in the autogear pool — especially majors, which were nearly excluded before',
            'Complete Sets option no longer zeroes out good layouts — now penalizes orphan pieces instead of incomplete sets',
            'Tutorial covers starring ships and Hard Requirements',
            'Fixed anonymous-user autogear console error',
        ],
    },
    {
        version: '1.53.1',
        date: '2026-04-20',
        changes: [
            'Fixed new email signups failing with "Database error saving new user"',
            'Fixed "Delete Local Storage" not actually clearing gear and implants',
            "Fixed signing out leaving the previous account's ships, gear, and stats visible",
        ],
    },
    {
        version: '1.53.0',
        date: '2026-04-18',
        changes: [
            'Stat priorities can now be flagged as Hard Requirements — the autogear optimizer retries up to 5 times to meet them, and shows the closest-miss with needed-vs-got if no feasible combo exists',
        ],
    },
    {
        version: '1.52.0',
        date: '2026-04-14',
        changes: [
            'Star your important ships to mark them as "always geared" — a persistent alert panel appears when starred ships have empty gear or implant slots',
            'After equipping autogear suggestions, a "Suggested Next Autogear" list shows donor ships that lost gear and starred ships needing attention — click to select them as the next autogear target',
            'Star toggle available on ship cards and autogear gear suggestions',
            'Alert panel is minimizable and stacks above the joke corner',
        ],
    },
    {
        version: '1.51.0',
        date: '2026-04-11',
        changes: [
            'Expanded DPS calculator with multi-round simulation — compare burst vs ramping ships over configurable combat rounds',
            'Added active/charged skill cycle with charge count support',
            'Added DoT support: corrosion, inferno, and bombs with configurable tiers, stacks, and duration',
            'New round-by-round cumulative damage chart with per-source tooltip breakdown',
        ],
    },
    {
        version: '1.50.0',
        date: '2026-03-31',
        changes: [
            'Loadout cards now have an Expand button that opens a modal showing full gear details and calculated stats',
            'Added Edit button to individual and team loadouts — opens the form pre-filled with the current name and ship for quick updates',
            'Added per-ship Equip button on team loadout cards to equip individual ships without equipping the whole team',
            'Fixed loadout equipping — gear assignments are now atomic (previously, rapid individual equip calls could race and overwrite each other)',
            'Gear conflict warning when equipping a loadout — a confirmation dialog lists which gear will be unequipped from other ships before proceeding',
            'New "Save as loadout" action in the ship card dropdown menu — quickly snapshot a ship\'s current gear as a named loadout',
            'Expanded loadout modal now shows full stat totals (base + gear + engineering + refits + implants)',
            'Stale gear detection — loadout cards show a warning when gear pieces no longer exist in inventory',
        ],
    },
    {
        version: '1.49.0',
        date: '2026-03-29',
        changes: [
            'Statistics charts now show rarity color-coded stacked bars — see the breakdown by rarity across gear sets, main stats, star levels, level distribution, gear slots, implant types, and implant set bonuses',
            'Refits by Rarity chart on the Ships tab is now color-coded by rarity',
            'Fixed labels across all statistics tabs — ship roles, factions, gear sets, gear slots, main stats, and implant set bonuses now display proper names instead of internal keys',
        ],
    },
    {
        version: '1.48.0',
        date: '2026-03-26',
        changes: [
            'Added monthly statistics snapshots — your stats are automatically saved each month so you can track your progression over time',
            'Compare with previous months via the dropdown on the Statistics page. Metric cards show delta indicators and charts display side-by-side grouped bars',
            'Added "Total Tokens Spent" card to the Engineering statistics tab',
            'Implant set bonus charts (minor, major, ultimate) now support snapshot comparison',
        ],
    },
    {
        version: '1.47.0',
        date: '2026-03-24',
        changes: [
            'Added Synthwave theme — toggle it from the sidebar (sparkles icon). Features neon glowing buttons, chrome metallic headers, CRT scanlines, synthwave background, gradient cards/modals, chromatic aberration on ship images, and more.',
            'Synthwave theme includes Orbitron and Exo 2 fonts for a retro-futuristic feel',
            'VHS static glitch transition when switching themes',
            'Added synthwave soundtrack with play/pause control in the sidebar',
            'Theme preference saved locally and persists across sessions',
        ],
    },
    {
        version: '1.46.0',
        date: '2026-03-19',
        changes: [
            'Added Lore page with two tabs: Ship Bios (149 ships with searchable bios, quotes, and authors) and World Lore (30 articles from starborne.com)',
            'Ship database cards now have a dropdown menu with compare, leaderboard, add to fleet, and read bio actions',
            'Ship bios replaced with official data from the developers, including character quotes and authors',
            'Cross-tab search on the lore page — search results from the other tab appear below with a section header',
            'Added help text to hit deconstruction calculator explaining defender buff sign conventions',
            'Reorganized sidebar: Ships, Lore, Implants, and Effects grouped under Database',
        ],
    },
    {
        version: '1.45.0',
        date: '2026-03-16',
        changes: [
            'Added arena season modifiers. Admins can create seasons with stackable stat modifier rules (filtered by faction, rarity, or role). Users can enable "Apply arena modifiers" in autogear settings to have the algorithm account for active arena season buffs when scoring gear.',
            'Autogear results show a 3rd column for stats and simulation with arena modifiers applied when enabled.',
        ],
    },
    {
        version: '1.44.0',
        date: '2026-03-15',
        changes: [
            'Added multiplier mode to autogear stat bonuses. Multiplier mode scales the role score by the stat value, useful for builds that want a stat to scale proportionally with the role (e.g., hacking on an attacker).',
            'Added click-to-copy on ship database skill buttons',
        ],
    },
    {
        version: '1.43.0',
        date: '2026-03-01',
        changes: [
            'Added video/image showcase to ship details page',
            'Added visual improvements to encounter pages',
            'Separated engineering and scoring roles in preview upgrade',
            'Fixed autogear lock button showing on gear already belonging to the ship being optimized',
            'Fixed overwriting existing stat priority instead of adding duplicates',
        ],
    },
    {
        version: '1.42.0',
        date: '2026-02-25',
        changes: [
            'Added Chrono Reaver calculator page',
            'Added charge skill charge to skill tooltip',
            'Added gear sorting by stat type to gear inventory',
            'Added ship sorting based on ship power to ship inventory',
        ],
    },
    {
        version: '1.41.0',
        date: '2026-02-21',
        changes: [
            "Added lock icon to already equipped gear pieces in autogear results. Clicking it will lock the gear to the ship it's equipped on and re-run autogear.",
        ],
    },
    {
        version: '1.40.0',
        date: '2026-02-17',
        changes: ['Added tutorials. Will be populated over time.'],
    },
    {
        version: '1.39.0',
        date: '2026-02-11',
        changes: [
            'Added video to ship cards. Will populate these gradually over time.',
            'Changed ship index page to use bigger images and collapsed stats.',
        ],
    },
    {
        version: '1.38.1',
        date: '2026-02-03',
        changes: [
            'Fixed a bug with asphodel/tormenter r2 crit rate',
            'Added some more useful numbers in the engineering preview',
        ],
    },
    {
        version: '1.38.0',
        date: '2026-01-27',
        changes: [
            'Added ship comparison panel to ship inventory and ship index page',
            'Added engineering preview tab to engineering stats page',
        ],
    },
    {
        version: '1.37.0',
        date: '2026-01-25',
        changes: [
            'Removed AI recommendations',
            'Added community recommendations',
            'Added share recommendation form',
        ],
    },
    {
        version: '1.36.0',
        date: '2026-01-21',
        changes: [
            'Added gear expand button in ship details page',
            'Added ship copy image to clipboard button in ship card',
            'Added buffs, skill multiplier to DPS calculator',
        ],
    },
    {
        version: '1.35.0',
        date: '2026-01-10',
        changes: [
            'Added critcal damage reduction to autogear',
            'Added hardened gear set',
            'Added gear main/sub stat filters to gear inventory',
        ],
    },
    {
        version: '1.34.0',
        date: '2026-01-07',
        changes: [
            'Added ship specific gear upgrade suggestions. PROTIP: Select a role to accompany a ship, as it takes quite a bit longer to compute with a ship.',
            'Added shortcut to ship details from autogear for quick swapping of implants.',
            'Fixed an issue with tooltips in offcanvases and modals.',
        ],
    },
    {
        version: '1.33.1',
        date: '2026-01-02',
        changes: ['MASSIVE AUTOGEAR PERFORMANCE OPTIMIZATION, insert wine glass emoji here'],
    },
    {
        version: '1.33.0',
        date: '2025-12-24',
        changes: ['Added defensive security debuffer role'],
    },
    {
        version: '1.32.0',
        date: '2025-12-21',
        changes: ['Added Speed calculator page'],
    },
    {
        version: '1.31.0',
        date: '2025-12-19',
        changes: [
            'Added Arcane Siege calculations to autogear',
            'Added gear set filter to upgrade analysis',
        ],
    },
    {
        version: '1.30.0',
        date: '2025-12-18',
        changes: ['Added CODE GUARD / CIPHER LINK calculations to the system'],
    },
    {
        version: '1.29.0',
        date: '2025-12-17',
        changes: ['Added role and stat filters to gear upgrade analysis'],
    },
    {
        version: '1.28.0',
        date: '2025-12-13',
        changes: ['Added calibration calculator'],
    },
    {
        version: '1.27.0',
        date: '2025-12-09',
        changes: ['Added profile page for logged in users'],
    },
    {
        version: '1.26.0',
        date: '2025-12-06',
        changes: [
            'Added bomb damage to debuffer stats',
            'Added implant testing/quick swap in the simulation page',
        ],
    },
    {
        version: '1.25.1',
        date: '2025-12-02',
        changes: [
            'Added AND mode to recruitment calculator',
            'Added affinity adjustments to recruitment calculator',
        ],
    },
    {
        version: '1.25.0',
        date: '2025-12-01',
        changes: ['Added recruitment calculator'],
    },
    {
        version: '1.24.1',
        date: '2025-11-21',
        changes: ['Added engineering points ranking to the engineering stats page'],
    },
    {
        version: '1.24.0',
        date: '2025-11-20',
        changes: [
            'Added statistics page',
            'Added edit button to gear in the gear upgrade analysis for easy update after upgrade in game.',
        ],
    },
    {
        version: '1.23.0',
        date: '2025-11-07',
        changes: ['Added effect index page'],
    },
    {
        version: '1.22.0',
        date: '2025-11-03',
        changes: ['Added optimize implants option to autogear'],
    },
    {
        version: '1.21.2',
        date: '2025-10-17',
        changes: [
            'Increased simulation count for gear upgrade analysis',
            'Separated upgrade analysis into analysis and simulation',
            'Added manual gear upgrade analysis button',
        ],
    },
    {
        version: '1.21.1',
        date: '2025-10-16',
        changes: ['Added max level filter to gear upgrade analysis'],
    },
    {
        version: '1.21.0',
        date: '2025-10-03',
        changes: ['Added AI autogear suggestions', 'Added admin tools'],
    },
    {
        version: '1.20.1',
        date: '2025-09-10',
        changes: ['Added supporter(shield) role'],
    },
    {
        version: '1.20.0',
        date: '2025-08-14',
        changes: ['Added leaderboard pages for ships, in the ship index page.'],
    },
    {
        version: '1.19.3',
        date: '2025-08-07',
        changes: [
            'Added print button to autogear page',
            'Added corrosion debuffer role',
            'Changed def pen chart to show damage increase.',
        ],
    },
    {
        version: '1.19.2',
        date: '2025-08-05',
        changes: ['Added rarity filter to upgrade analysis'],
    },
    {
        version: '1.19.1',
        date: '2025-08-05',
        changes: [
            'Fixed a bug with upgrade analysis, where percentage only set bonus stats where not taken into consideration.',
        ],
    },
    {
        version: '1.19.0',
        date: '2025-08-04',
        changes: ['Added defense penetration to DPS calculator'],
    },
    {
        version: '1.18.2',
        date: '2025-07-11',
        changes: ['Added level range and stat type filters to gear inventory.'],
    },
    {
        version: '1.18.1',
        date: '2025-07-11',
        changes: [
            'Autogear with simulated upgrades, now only takes into consideration the main stat upgrade, not the substats.',
        ],
    },
    {
        version: '1.18.0',
        date: '2025-07-10',
        changes: ['Added JSON diff calculator', 'Added optional import to cubedweb'],
    },
    {
        version: '1.17.2',
        date: '2025-07-07',
        changes: [
            'Fixed a bug with syncing to the backend when uploading a new export file.',
            'Added better notifications when importing data',
        ],
    },
    {
        version: '1.17.1',
        date: '2025-07-07',
        changes: [
            'Fixed a bug with gear upgrade analysis',
            'Fixed a bug with import, readded window refresh',
        ],
    },
    {
        version: '1.17.0',
        date: '2025-06-29',
        changes: ['Added support for autogearing multiple ships at once.'],
    },
    {
        version: '1.16.0',
        date: '2025-06-26',
        changes: [
            'Added implant slot to the ship card on the ship details page, to be able to swap implants.',
        ],
    },
    {
        version: '1.15.1',
        date: '2025-06-26',
        changes: ['Made autogear page more compact, and moved settings to a modal.'],
    },
    {
        version: '1.15.0',
        date: '2025-06-24',
        changes: [
            'Added tryToCompleteSets option to autogear. This option penalizes incomplete sets.',
            'Adjusted defender scoring to be more accurate, by reducing the number of enemies to 2, and increasing the enemy attack to 40k.',
        ],
    },
    {
        version: '1.14.1',
        date: '2025-06-23',
        changes: ['Fixed a bug with set bonus calculation of 4 piece sets'],
    },
    {
        version: '1.14.0',
        date: '2025-06-22',
        changes: [
            'Added crit 100% to Asphodel and Tormenter import',
            'Added hard check to autogear stat priorities',
            'Fixed a bug with offcanvas z-index',
        ],
    },
    {
        version: '1.13.1',
        date: '2025-06-21',
        changes: ['Improved autogear performance'],
    },
    {
        version: '1.13.0',
        date: '2025-06-17',
        changes: ['Added persistent autogear config per ship'],
    },
    {
        version: '1.12.1',
        date: '2025-06-17',
        changes: ['Added total upgrade cost to upgraded gear cards and gear suggestions'],
    },
    {
        version: '1.12.0',
        date: '2025-06-16',
        changes: [
            'Added gear slot tabs to gear analysis, so you can see the upgrades with the best probability of improving the role score for each slot, for each role.',
        ],
    },
    {
        version: '1.11.0',
        date: '2025-06-16',
        changes: [
            'Added gear upgrade simulation',
            'Added possibility in autogear to use upgraded stats',
        ],
    },
    {
        version: '1.10.0',
        date: '2025-06-14',
        changes: ['Added ship image view mode'],
    },
    {
        version: '1.9.0',
        date: '2025-06-13',
        changes: ['Added Help page'],
    },
    {
        version: '1.8.1',
        date: '2025-06-11',
        changes: ['Fixed ship details page after implants rework.'],
    },
    {
        version: '1.8.0',
        date: '2025-06-11',
        changes: [
            'Added implants as gear, as a first step to autoimplants, so you can browse implants in the gear inventory. NOTE: This require a re-import of your data.',
        ],
    },
    {
        version: '1.7.2',
        date: '2025-06-08',
        changes: ['Added high security defender role', 'Roles are now persisted between imports'],
    },
    {
        version: '1.7.1',
        date: '2025-06-07',
        changes: [
            'Fixed a bug with offensive debuffer score calculation',
            'Moved ship data to indexedDB',
            'Fixed a bug with equipping gear already equipped, not always unequipping from other ships',
        ],
    },
    {
        version: '1.7.0',
        date: '2025-06-07',
        changes: ['Added stat bonuses to autogear settings'],
    },
    {
        version: '1.6.0',
        date: '2025-06-07',
        changes: [
            'Added IndexedDB for gear inventory, to support HUGE inventories',
            'Add sorting ships by specific stats',
        ],
    },
    {
        version: '1.5.0',
        date: '2025-06-06',
        changes: [
            'Added defense penetration to attacker autogear calculation',
            'Added search by equipped ship to gear inventory',
        ],
    },
    {
        version: '1.4.1',
        date: '2025-06-06',
        changes: [
            'Fixed a bug with implant import',
            'Fixed a bug with ship import',
            'Fixed a bug with inventory import',
        ],
    },
    {
        version: '1.4.0',
        date: '2025-06-03',
        changes: ['Added bomber debuffer role'],
    },
    {
        version: '1.3.1',
        date: '2025-06-02',
        changes: [
            'Smoothed out inventory loading',
            'Fixed an issue where import was stalling',
            'Lock state is now saved between imports',
        ],
    },
    {
        version: '1.3.0',
        date: '2025-05-31',
        changes: [
            'Added lock ship equipment in Autogear page',
            'Adjusted debuffer score to be more accurate',
            'Added defensive debuffer role',
        ],
    },
    {
        version: '1.2.0',
        date: '2025-05-31',
        changes: [
            'Added set bonus stats to gear piece display',
            'Added set bonus stats to gear upgrade analysis',
            'Added autofocus to searchbars in gear and ship filters.',
            'Added better sorting to ship selector, and autofocus on searchbar',
            'Revamped gear upgrade analysis, shows better recommendations, and shows more pieces.',
            'Added ignore unleveled gear option to autogear',
        ],
    },
    {
        version: '1.1.0',
        date: '2025-05-31',
        changes: [
            'Adjusted autogear algorithm to be scalable to inventory size',
            'Simplified autogear filtering',
            'Removed numerous loads from db, relying on optimistic updates instead. Page refresh fetches all data again.',
        ],
    },
    {
        version: '1.0.3',
        date: '2025-05-30',
        changes: ['Fixed an issue with ship lock states'],
    },
    {
        version: '1.0.2',
        date: '2025-05-30',
        changes: [
            'Added search to gear and ship inventories',
            'Added pagination to gear and ship inventories',
        ],
    },
    {
        version: '1.0.1',
        date: '2025-05-30',
        changes: ['Added gear batchloading', 'Added Piercer gear bonus'],
    },
    {
        version: '1.0.0',
        date: '2025-05-29',
        changes: ['Supabase backend', 'Import GAME DATA!'],
    },
    {
        version: '0.26.0',
        date: '2025-04-09',
        changes: ['Added implant database page'],
    },
    {
        version: '0.25.0',
        date: '2025-04-07',
        changes: ['Added shared encounters page'],
    },
    {
        version: '0.24.2',
        date: '2025-03-28',
        changes: ['Added buffs data', 'Added buff/debuff tooltip'],
    },
    {
        version: '0.24.1',
        date: '2025-03-28',
        changes: ['Better handling of corrupted ship data'],
    },
    {
        version: '0.24.0',
        date: '2025-03-26',
        changes: ['Added healing calculator', 'Added hit deconstruction calculator'],
    },
    {
        version: '0.23.0',
        date: '2025-03-18',
        changes: [
            'Added navigation levels',
            'Added DPS calculator',
            'Added Effective HP calculator',
        ],
    },
    {
        version: '0.22.0',
        date: '2025-03-03',
        changes: [
            'Added shield and hp regen(heal on hit) stats',
            'Redid defender calculations to be more accurate, by increasing the number and strength of enemies in the simulation. Defender score is now based on how many rounds survived, rather than effective hp. This is done to be able to calculate the effect of shield set, and healing on hit on some ships.',
            "Units such as Heliodor and Cultivator can be reimported or for Isha added as a refit value to reflect the healing on hit into calculations. I've called this new stat HP Regen.",
        ],
    },
    {
        version: '0.21.0',
        date: '2025-02-27',
        changes: ['Added gear set priority form to the autogear settings page'],
    },
    {
        version: '0.20.1',
        date: '2025-02-26',
        changes: ['Added quick add to ship index page'],
    },
    {
        version: '0.20.0',
        date: '2025-02-25',
        changes: ['Added ship index page', 'Added some spice to the styling'],
    },
    {
        version: '0.19.0',
        date: '2025-01-28',
        changes: [
            'Added gear/implant swapping in simulation page',
            'Added collapsible implant/refit forms, with better mobile support',
        ],
    },
    {
        version: '0.18.2',
        date: '2025-01-28',
        changes: ['Ship dropdown menu with some nice shortcuts'],
    },
    {
        version: '0.18.1',
        date: '2025-01-26',
        changes: ['Added possibility to delete account from home page'],
    },
    {
        version: '0.18.0',
        date: '2025-01-26',
        changes: ['Added login', 'Added firebase storage', 'Styling & performance tweaks'],
    },
    {
        version: '0.17.0',
        date: '2025-01-21',
        changes: ['Added gear upgrade analysis', 'Fixed a bug with gear/ship link'],
    },
    {
        version: '0.16.4',
        date: '2025-01-15',
        changes: [
            'Added persistent filters/sorting on gear and ship inventories',
            'Upgrade suggestion tweaks',
        ],
    },
    {
        version: '0.16.3',
        date: '2025-01-13',
        changes: [
            'Added upgrade suggestions',
            'Added max limit to predefined modes secondary requirements',
        ],
    },
    {
        version: '0.16.2',
        date: '2025-01-10',
        changes: ['Added secondary requirements to autogear'],
    },
    {
        version: '0.16.1',
        date: '2025-01-09',
        changes: [
            'Adjusted effective hp calculation to be much more accurate, thanks to Engwaraato for the new formula',
        ],
    },
    {
        version: '0.16.0',
        date: '2025-01-09',
        changes: [
            'Added backup and restore feature',
            'Added ship details page with stat breakdown, refits and implants and gear slot analysis',
            'Updated ship data with more accurate stats, and more ships',
        ],
    },
    {
        version: '0.15.1',
        date: '2025-01-07',
        changes: [
            'Adjust stat forms',
            'Added Valkyrie ship, and adjust Liberator stats',
            'Add stat breakdown for ships',
        ],
    },
    {
        version: '0.15.0',
        date: '2025-01-06',
        changes: [
            'Added encounter export as image',
            'Added encounter description',
            'further adjustments to autogear algorithm',
        ],
    },
    {
        version: '0.14.3',
        date: '2025-01-06',
        changes: [
            'Autogear algorithm now always include the gear of the selected ship in the calculations',
        ],
    },
    {
        version: '0.14.2',
        date: '2025-01-05',
        changes: ['Fixed a bug with main stat value calculation on types hacking and security'],
    },
    {
        version: '0.14.1',
        date: '2025-01-05',
        changes: [
            'Added buffer role to autogearing predefined modes, focusing on speed, boost set and lastly effective hp',
            'Added manual stat priority weights',
            'Several adjustments to autogear algorithm and simulation, focusing on debuffers and defenders',
        ],
    },
    {
        version: '0.14.0',
        date: '2025-01-03',
        changes: ['Added home page', 'Added joke corner'],
    },
    {
        version: '0.13.0',
        date: '2025-01-03',
        changes: ['Added main stat value suggestions in gear form, based on stars and level'],
    },
    {
        version: '0.12.1',
        date: '2024-12-31',
        changes: ['Adjusted gear piece display to show the ship it is equipped on'],
    },
    {
        version: '0.12.0',
        date: '2024-12-31',
        changes: ['Added ship lock state, that will lock the equipment on the ship'],
    },
    {
        version: '0.11.0',
        date: '2024-12-28',
        changes: ['Added encounter list'],
    },
    {
        version: '0.10.0',
        date: '2024-12-22',
        changes: [
            'Added shipId to gear to stop duplicated gear on ships, both for ship page and autogearing',
            'Added team loadouts',
        ],
    },
    {
        version: '0.9.1',
        date: '2024-12-21',
        changes: [
            'Reworked autogear strategies to get better results',
            'Added autogear progress indicator',
            'Adjusted autogear view',
        ],
    },
    {
        version: '0.9.0',
        date: '2024-12-20',
        changes: ['Added autogear brute force mode', 'Improved predefined modes'],
    },
    {
        version: '0.8.0',
        date: '2024-12-19',
        changes: [
            'Added autogear predefined modes',
            '- Added Attacker (max damage)',
            '- Added Defender (max HP/def combo)',
            '- Added Debuffer (270 hacking / max damage)',
            '- Added Supporter (max heal output)',
        ],
    },
    {
        version: '0.7.2',
        date: '2024-12-16',
        changes: [
            'Fixed a bug with stat exclusion',
            'Added static ship data for all ships, instead of fetching from rocky',
        ],
    },
    {
        version: '0.7.1',
        date: '2024-12-15',
        changes: ['Added stat normalization', 'Optimized gear and ship forms'],
    },
    {
        version: '0.7',
        date: '2024-12-14',
        changes: ['Added notifications'],
    },
    {
        version: '0.6',
        date: '2024-12-14',
        changes: ['Added loadouts / ship profiles'],
    },
    {
        version: '0.5',
        date: '2024-12-12',
        changes: ['Added sorting', 'Formatting improvements'],
    },
    {
        version: '0.4',
        date: '2024-12-12',
        changes: [
            'Added the rest of the gear sets',
            'Added stat labels',
            'Added autogear attack simulation section',
            'Formatting improvements',
        ],
    },
    {
        version: '0.3',
        date: '2024-12-12',
        changes: [
            'Added more filters',
            'Fixed a bug with the changelog modal',
            'Added active filter display in the gear and ship inventories',
        ],
    },
    {
        version: '0.2.1',
        date: '2024-12-11',
        changes: ['Bugfix ship form', 'Modal closes on click outside'],
    },
    {
        version: '0.2.0',
        date: '2024-03-20',
        changes: [
            'Added changelog system',
            'Improved mobile responsiveness',
            'Fixed various UI bugs',
            'Added filters',
        ],
    },
    {
        version: '0.1.0',
        date: '2024-03-15',
        changes: [
            'Initial release',
            'Ship management system',
            'Gear inventory system',
            'Auto-gear calculator',
            'Engineering stats page',
        ],
    },
];
