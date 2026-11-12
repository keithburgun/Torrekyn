# Torrekin changelog

Newest first. The version shows on the title screen.

## 0.8.0 — 2026-11-12
- Hero Health halved; battle damage is now 1 + 1 per surviving unit. New Commitment: Battlecry: give your left-most slot +20 Health per Azure unit. Chaos counts Battlecry units played (not extra triggers). Tinker flashes, then the shop unit it upgraded flashes as its keyword lands. Hero powers going off get a burst of light, a bigger label and their own chime (e.g. Derby Pocket's extra Battlecry). Repeated Battlecries play twice as fast. Taunt shields stick out more. A slot's bonus shows under the unit's Attack and Health so keyword coins don't cover it. Extra keywords on the big card show as coloured italics. Banners no longer show a number over the Tier. Bots: even the weakest persona now plays with real skill (weakest bots averaged 12/11 units by turn 14; now 34/40); new players start mid-ladder (1400) and existing ratings below that move up; persona ratings re-measured; card values re-measured.

## 0.7.0 — 2026-11-12
- Smarter bots (+99 Elo vs the old Expert): play the best card in hand when the army is full, value units that grow, better Gem/Banner/Mod/Abandon placement, hold Larva/Green Ninja/Scout, sell Treasure and Message well, faster leveling, pickier rerolls; card values re-measured with Tier 6. May's Root Access costs 2. Fixes: Left Twinbot's Rally gave Health too (Attack only now); Scout Discovered a Tier too low (now shows its current Tier). New ability test checks every card does something.

## 0.6.0 — 2026-11-12
- Damage dealt is now 2 + 2 for each surviving unit (the base 2 shows as stars on the winner's hero).
- Shield (Neutral) no longer destroys itself.
- Pickaxe is now Gambler: Battlecry: Gain 1 free Refresh (Golden 2), with new art. The Refresh button shows free Refreshes.
- Summit Key: In two turns, Discover a Tier 6 unit.
- Fix: Gems played by an effect (Invisible Hand, Bulldozer) skipped your left-most unit. In battle, each Gem now shows as its own step with a red gem flying to every unit it buffs.
- Banners show their current (improved) amount on the card.
- Buff floats: a card's stats now change as each float lands, instead of jumping to the total first.
- The last-battles popup on the leaderboard now shows above your army.
- Keyword badges (Reborn purple, Venomous green, Poisonous lime, Windfury blue) are chunky coloured coins in a row under the tribe banner.

## 0.5.5 — 2026-11-10
- Fix: extra Battlecry triggers multiplied instead of adding up. Derby Pocket + Crown of Echoes now gives 3 triggers (was 4); Gem Wizard + Crown on a Red Gem gives 3 (was 4).

## 0.5.4 — 2026-11-10
- Fix: Left Twinbot (0 Attack) never attacked, so its Rally never happened. Units with a Rally now attack even at 0 Attack.

## 0.5.3 — 2026-11-10
- The results screen no longer shows a zoomed card left open behind it.

## 0.5.2 — 2026-11-10
- Desktop: the short tap-safety delay on Buy / Play / Sell now applies only to touch taps, so quick mouse clicks are never ignored.

## 0.5.1 — 2026-11-10
- Phones: tapping a unit can't instantly sell it any more. When the big card has to cover the card you tapped, its Sell / Play / Buy buttons sit above it instead of right under your finger, and those buttons ignore taps for the first moment after a card opens (they fade in as they arm).

## 0.5.0 — 2026-11-10
- Gelf Lanz's Inspire is now an active power: 3 Gold, gain an Azure unit; it costs 1 less each time you buy an Azure unit.
- Interface back to the smooth, rounded look by default (Pixel stays in Options → Interface). The Tavern buttons are rounded pink buttons like Begin Battle with Keith's black pixel icons; the fonts and the red Health orbs stay.
- Leaderboard Health shows a small red orb instead of a heart.

## 0.4.8 — 2026-11-09
- Pixel sprites back to crisp pixel art with only the edges lightly anti-aliased (sharp-bilinear), replacing the over-smoothed Scale2x look.
- Trinkets use Keith's pixel present art instead of a plain orb; greater trinkets glow pink.

## 0.4.7 — 2026-11-09
- Bill Milton's Golden Parachute triggers when you buy a Business Demon (was: play one).

## 0.4.6 — 2026-11-09
- Pixel-art unit sprites are now upscaled with Scale2x smoothing plus a soft resize instead of hard nearest-neighbour blocks (rounded edges, slightly soft), and fill the card more evenly.

## 0.4.5 — 2026-11-09
- Tavern buttons now look like Begin Battle (pink pixel blocks) with Keith's pixel icons in solid black; Freeze turns ice blue while frozen.
- Cost coins use Keith's pixel coin art.

## 0.4.4 — 2026-11-09
- Cost coins are drawn as pixel coins with a clean outline (the old clipped shape lost its edge on the diagonals).
- Chunkier Tavern button icons: 2-pixel strokes, a clearer Refresh arrow and a bolder snowflake.

## 0.4.3 — 2026-11-09
- New Upgrade / Refresh / Freeze buttons: flat pixel plaques (gold, green, ice blue) with pixel-drawn icons, the label inside the button, and a coin tag for the cost; Freeze glows frosty while the Tavern is frozen.
- The end-of-battle screen shows your Health as the red orb instead of a heart.

## 0.4.2 — 2026-11-09
- Hero Health is a red circle (like a unit's Health) beside the portrait instead of a heart over the face; same in the battle intro and battle.
- Hero select shows Stealing A Boat's real starting cost (7).

## 0.4.1 — 2026-11-09
- Pixel interface: hero portraits (and your hero's power button) are round again, with the round cost coin.

## 0.4.0 — 2026-11-09
- Pixel-art interface (new default): square buttons, panels, chips, tooltips, Tavern keys, hero frames and coins with notched pixel borders, hard bevels and hard drop shadows. Options → Interface switches back to Smooth.

## 0.3.2 — 2026-11-09
- May Danaris: Root Access costs 3 (was 2).
- Omar Evans: Leaf Cloak now Discovers a Cloister unit after every 4 units sold (was a random one after 5).
- Locas Clare: Stealing A Boat starts and resets at 7 (was 10).

## 0.3.1 — 2026-11-09
- Workbook 4 balance: Horseman is a 5/5 Reborn; Sickle 7/7 deals 4 to adjacent units; Longbow 8/1 (Golden: one hit for double Attack); Time Cannot Destroy Avenge (5); Cursed Vines 2/2, slot +2/+2; Elder 8/18; Warlock 17/9; White Ninja 1/1; Songstress Avenge (2) +6/+6; Mod 5/5; Grief is Tier 2, 1/1; Potato Gem +8 Health.
- WARMECH now grows with Deathrattles triggered this game (and during the battle) instead of Battlecries.
- Locas (the card) is now Warrior, with new art; Sickle has new art.

## 0.3.0 — 2026-11-09
- Fonts: Grenze for headings, names and big numbers; Amaranth for small and body text.
- Quick fades between screens: the shop fades out before the battle intro, the battle fades out before the Recruit sweep, and menu screens fade in.
- Architect reworked: a 1/1 with End of Turn: Give this slot +2/+2 (Golden +4/+4).

## 0.2.0 — 2026-11-09
- Tier 6 units: 8 of them (one per tribe plus a Neutral). The Tavern still stops at Tier 5; Tier 6 units only come from special effects (Summit Key, Summit Vault, Golden Light, Robot Boy, copies).
- New trinkets: Summit Key (Discover a Tier 6 unit) and Summit Vault (Discover two).
- Poisonous (a Venomous that's never used up) replaces Stealth, which is gone.
- Reworked: Green Ninja, Owl, Omar Evans, Mod, Chaos, Scientist, Golden Light, Jeweler, Exploit, Grief, Omni-Gem, Thicket.
- Locas Clare's power is now Stealing A Boat. Old Map no longer gives 2 Gold.
- Improved Gems show their current numbers; Red Gem no longer counts itself among the 3 left-most units.
- Grenze font throughout; zoomed-in cards are twice as large; the Tavern Tier badge shows TIER and the number.
- Card wording made consistent (Start of Combat, End of Turn, Avenge (N), Summon, Gain, Tavern, capitalised Gold/Health/Attack).
- Earlier since 0.1.0: Gems system, slots, overflow hand, stalemate damage, battle speeds, pause and hover zoom in battle, hero and art updates.
