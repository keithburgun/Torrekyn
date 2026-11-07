# Torrekin: Design Notes and Rules Interpretations

When the card text was ambiguous, Hearthstone: Battlegrounds conventions were used. Everything below can be changed; tell Claude which ones to change.

## Core rules (src/engine/core.ts `CONFIG`)
- 6 players, 45 Health each. Damage = winner's Tavern Tier + tiers of the winner's surviving units, always capped at 15.
- Tavern Tiers 1–5. Upgrade costs: Tier 2 = 5, Tier 3 = 7, Tier 4 = 8, Tier 5 = 9, each dropping by 1 every turn (as in HS).
- Shop size by tier: 3 / 4 / 4 / 5 / 5. Units cost 3, sell for 1, Refresh costs 1, Freeze is free.
- Gold: 3 on turn 1, +1 per turn, max 10 (plus Investor/trinket bonuses).
- Card pool copies per tier: 15 / 13 / 11 / 9 / 7 (scaled down from HS for 6 players).
- 3 of the 7 tribes are banned each game, so 4 are in play, picked at random (Neutral is always in). The game announces them at the start.
- Triples: 3 copies → Golden (double base stats + all buffs from the copies). Playing it lets you Discover a unit from Tavern Tier +1.
- Matchmaking avoids your last opponent where possible. With an odd number alive, one player fights the ghost of the most recently eliminated player.
- Board 7, hand 10.

## Slots (a Torrekin-specific mechanic)
- Your army has 7 fixed slots. Units always fill slots from the left (slot 1 = left-most).
- Slot bonuses (+Attack/+Health, keywords) belong to the slot, not the unit. Whoever stands in that slot gets them, in combat and in the shop display.
- "Left-most slot" = slot 1. "Right-most slot" (Devotion) = the slot of your current right-most unit.
- "This slot" = the slot the unit is in when the effect happens (for combat effects, the slot it started combat in).
- "Plain slot" (Paradox) = a slot with no bonuses at all.
- "Locked permanently" (Commitment) = that unit can no longer be moved, sold, consumed or destroyed by your own effects, and can't be part of a triple.
- Slot stats can go negative (Virus). A unit's effective Attack never drops below 0 or Health below 1.

## Keywords
- **Rally** = "whenever this attacks" (resolves before the hit, like HS Rally).
- **Avenge (N)** = triggers every N friendly deaths.
- **Venomous** works like HS Venomous (one use).
- **Stealth**: can't be attacked until it attacks; if every enemy is stealthed, stealth is removed.
- **Start of Battle** = Start of Combat.
- "Gains X" with no "permanently" = this combat only. "Permanently" changes the unit in your army.
- **Bonus Keywords** (Omni-Gem) = Taunt, Divine Shield, Reborn, Venomous, Stealth, Windfury.
- Battlecries that are triggered during combat (Returner, Spoonful) give temporary stats. Discovers triggered in combat add a random option to your hand instead.

## Card-specific calls
| Card | Interpretation |
|---|---|
| Skeleton | Golden spawns 4 Skels, as written in the spreadsheet. Skel and Rootling are tokens; Phoenix is a token. |
| Bramble / Locas / Funeral | Count units on **both** sides (the text doesn't say "friendly"). |
| Horseman | Extra damage only applies if you win. Still subject to the 15 cap. |
| Sickle / Gelf Lanz | "Adjacent units" = the units next to the attack target (cleave). |
| Necromancer | Spawns the Skeleton card (which has its own Deathrattle). |
| Ashlie / Romance | Like HS Undead: all your Neverending units, including ones you get later. |
| Tourmaline / Front and Center | Change slot 1 permanently. |
| Ocean Sky | Only your own units benefit. |
| Commitment | Targets your left-most unit other than itself. |
| Pink Gem / Doctor | Summon a fresh copy (start-of-combat stats) of a friendly unit that died this combat. Pink Gem can't summon another Pink Gem. |
| Therapist / Organizer / Exploit | Targeted Battlecries (you pick the unit). |
| Honeysuckle (Kindred) / Ambush | The card summoned from hand is a temporary combat copy; it stays in your hand. |
| Devotion | The quest starts when you play it (counts Kindred bought afterwards). |
| Sapling | Becomes a Rootling for the rest of that combat. |
| Honeysuckle (Brambor) / Root | "Random Brambor" = up to your current Tavern Tier. |
| Andromeda Robin | Damage starts at 3 and goes up by 1 each time it fires (permanently). |
| Green Gem | +3/+3 (the "+3" was read as +3/+3), permanent, to your army and hand; then Green Gem is removed from your army. |
| Larva | Counts turns at the start of each of your turns while in hand; then it turns into a random Golden Tier 5 Cloister unit. |
| Tinker / Scientist | Last until you upgrade your Tavern. Tinker's bonus sticks to Alcove units you buy. |
| Chaos | "Each Battlecry you played this turn" = last turn's count, since it fires at the start of the turn. |
| Computer | Tech up = free Tavern upgrade after combat. |
| Virus | Bots discard Viruses they receive. |
| Golden Light | "Deathrattle. You take 1 damage." = when it dies, you lose 1 Health. |
| Pickaxe | A passive end-of-turn effect: +1 gold next turn, every turn. |
| Scout | Discover tier = 1 + turns it has been in your army (max 5). |
| Banners | Both Banners share one "improve" counter (+1 to future Banner amounts per play). |
| Grief | The amount wasn't given; it reduces the upgrade cost by 3. |
| Broken Land | Sells (gold + sell effects) your left-most other unit. |
| Red Gem | Each of the 3 units gets the bonus on a random stat (rolled per unit). |
| Gem Wizard | Red Gems trigger 2× (Golden: 3×). |
| Bill Milton | The 12 gold arrives immediately when the quest completes. |
| Duplicate names | Two cards each are named **Shield**, **Ancient Name** and **Honeysuckle**, in different tribes. They're separate cards (ids `shield_azure` / `shield_neutral`, etc.). |
| Memory / Storyteller | Identical text in different tribes; kept as-is. |

## Golden versions
Golden text was written for every card (see the updated spreadsheet's Golden Ability column and `tools/import_cards.py`). The convention: double stats and double the effect's numbers. "Trigger twice" is used where doubling a number doesn't make sense, and "Avenge (N)" is halved for some keyword-granting effects. Tribe-wide auras like Sarinee, Tom Judith and Gem Wizard go from 2× to 3×.

## Heroes
Fourteen Torrekin champions; you choose 1 of 4 at the start. Heroes tied to a tribe (Gelf: Azure, Bunny: Kindred, Omar: Cloister, Bill: Business Demons) are not offered when that tribe is banned, as in Battlegrounds. Active powers cost gold and work once per turn.

| Hero | Power | Type | How it plays |
|---|---|---|---|
| Andromeda Robin | Elemental Weave | Passive | Start with a 1/1 **Pumpkin** in hand. It counts as every tribe. Whenever any other unit with a Deathrattle dies in combat (either side), the Pumpkin permanently gains that Deathrattle (each once; Golden gives the Golden version). |
| Gelf Lanz | Inspire | Passive | Once you've bought an Azure unit, your next Azure unit costs 1 less, and that re-arms with every Azure buy (so Azure units cost 2 from then on). |
| Derby Pocket | Coffee Run | Passive | After you play 5 Battlecry units, your Battlecries trigger an extra time for the rest of the game. |
| Bunny Wizard | Cuddle Spell | 1 gold | Discover a Kindred unit (your Tier or lower). Unlocks at Tavern Tier 4. |
| Croh Vosh | Abyssal Sweep | Passive | Units summoned for you during combat get +1/+2 (Reborn isn't a summon). |
| May Danaris | Root Access | 2 gold | Discover a unit (base stats) from the army of the last player you fought. |
| Locas Clare | Five-Finger Discount | 10 gold, −1 per turn | Move every unit in the Tavern to your hand (as many as fit). The cost then goes back to 10 next turn. The sheet lists it as Passive; it is played as an active power because it has a cost. |
| Venice Gorn | Sow Seeds | 2 gold | Plant a seed; in 2 turns it sprouts into a random unit from 1 Tier above your Tavern. |
| Omar Evans | Leaf Cloak | Passive | Every 5 **Cloister** units you sell, get a random Cloister unit. "Zuzuni" in the sheet is read as Cloister (the ninja tribe) until told otherwise. |
| Eve Williams | Wild Card | 1 gold, target | Transform a friendly unit into a random unit of the same Tier, then +3/+3. |
| Abragail | Well-Studied | Passive | At the start of turn 4, Discover a Hero Power, then a second one; they replace Well-Studied and you keep both. |
| Bill Milton | Golden Parachute | Passive | Whenever you play a Business Demon, gain 1 gold. |
| Clover | Broodmother | Passive | Avenge (4): summon a 1/1 **Dragon** and improve this: each later Dragon is +1/+1 bigger, for the rest of the game. |
| Trevor L | Party All Night | Passive | Avenge (5): give a random friendly unit (without it) Reborn. |

Hero Avenge counts friendly deaths in each combat and starts over every combat.

In 800 bot-only games (45 Health, 3 tribes banned), average placements ranged from 3.15 (Clover) to 4.15 (Locas Clare); 3.5 is even. Locas is the outlier: bots don't time the steal well, and stealing earlier made them worse. Run `BALANCE=1 npx vitest run tests/balance.test.ts` to re-check.

## Trinkets
The trinkets are still **placeholders**. A lesser trinket offer (4 options) arrives on turn 6 and a greater one on turn 9. You buy one with gold or skip.

## Opponents
Bots use the same shop rules as you. They level on a curve, prefer their main tribe, chase triples, use hero powers and buy trinkets. Personas and Elo are planned for later.
