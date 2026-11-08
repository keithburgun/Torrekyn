"""Import the Torrekin card spreadsheet into src/data/cards.json.

Usage:  python3 tools/import_cards.py path/to/cards.xlsx [--write-golden out.xlsx]

The spreadsheet columns are: Tribe, Tier, Card Name, Attack, Health, Ability, Golden Ability.
Tribe is only written on the first row of each tribe block, so it is carried down.
If a Golden Ability cell is empty, the text from GOLDEN below is used.
"""
import json
import re
import sys

import openpyxl

TRIBES = {
    "neverendingParty": ("neverending", "Neverending Party"),
    "azureOrder": ("azure", "Azure Order"),
    "kindredSociety": ("kindred", "Kindred Society"),
    "brambor": ("brambor", "Brambor"),
    "cloister": ("cloister", "Cloister"),
    "alcovePrefex": ("alcove", "Alcove Prefex"),
    "businessDemons": ("demons", "Business Demons"),
    "neutral": ("neutral", "Neutral"),
}

KEYWORDS = {
    "taunt": "taunt",
    "divine shield": "divineShield",
    "reborn": "reborn",
    "venomous": "venomous",
    "stealth": "stealth",
    "windfury": "windfury",
}

# Golden ability text, extrapolated with Hearthstone: Battlegrounds conventions
# (golden = double stats, and effects doubled / triggered twice).
GOLDEN = {
    "skeleton": "Deathrattle: Spawn 4 1/1 Skels.",
    "ash": "Taunt. Reborn.",
    "memory": "When you sell this, gain 2 random Tier 1 units.",
    "ashlie": "Battlecry: Your Neverending units have +2 Attack this game.",
    "bramble": "Whenever a Neverending unit dies, this gains +2 Attack.",
    "thicket": "At the end of the turn, give the left-most card in your army +2 Health.",
    "sickle": "Rally: Deal 2 damage to adjacent units.",
    "horseman": "If is alive at the end of the battle, deal 2 more damage to the opponent.",
    "funeral": "Every time a unit is Reborn, this gains 4 health permanently.",
    "lich": "At the start of the battle, deal 8 damage to a random enemy unit twice.",
    "necromancer": "Deathrattle: Spawn 2 Golden Skeletons.",
    "romance": "Avenge (3): Your Neverending units have +2 Attack this game.",
    "ancient_name_neverending": "Battlecry: Give your cards in hand and board +6/+6.",
    "returner": "Reborn. Deathrattle: Trigger an adjacent unit's Battlecry twice.",
    "abandon": "At the end of the turn, consume the unit to this unit's left and gain double its stats.",
    "lake": "At the end of the turn, give a unit in your hand +2 Health.",
    "shield_azure": "Divine Shield.",
    "tourmaline": "Battlecry: Give your left-most slot +20 Health.",
    "command": "Battlecry: Discover a random tier 1 unit twice.",
    "royal_guard": "Start of Combat: Give the units adjacent to this Divine Shield.",
    "message": "When you sell this, give all your slots +2/+4.",
    "front_and_center": "Battlecry: Give your two left-most slots Divine Shield.",
    "knight": "Rally: Give your Azure units +8 Attack.",
    "longbow": "Avenge (3): Deal this unit's attack to a random enemy twice.",
    "time_cannot_destroy": "Divine Shield. Avenge (2): Gain Divine Shield and Taunt.",
    "catapult": "Start of Combat: Deal 25 damage to the lowest-health enemy twice.",
    "remember": "Battlecry: Discover a card from your last opponent twice.",
    "gelf_lanz": "Rally: Deal full damage to adjacent units.",
    "ocean_sky": "Whenever another unit loses Divine Shield, it gains +2/+4 permanently.",
    "commitment": "Battlecry: Triple the stats of your left-most unit. It is locked permanently.",
    "doctor": "Rally: Summon 2 Tier 1 units that died this battle.",
    "librarian": "Battlecry: Discover a unit from a tier higher twice.",
    "architect": "Battlecry: Give up to 4 different units in your hand +10/+10.",
    "patchwork": "Whenever you gain a Kindred unit, this slot gains +2/+4 permanently.",
    "hug": "Battlecry: Give a random Kindred unit in your hand +12/+12.",
    "pink_gem": "Deathrattle: Spawn 2 units that died this battle.",
    "therapist": "Battlecry: Give a unit Taunt and +4/+4. If it already has Taunt, remove it.",
    "vulnerability": "Your two left-most units are invulnerable while attacking.",
    "builder": "Avenge(5): Give this slot +20 Health.",
    "1000_miles": "Deathrattle: Gain 2 copies of the unit that killed this.",
    "barton": "Start of Combat: triple this unit's stats.",
    "life": "Start of Combat: When there is room, spawn two Golden Pink Gems.",
    "restore": "End of turn: Gain 2 Hugs.",
    "honeysuckle_kindred": "Deathrattle: Spawn the 2 highest-health Kindred from your hand into battle.",
    "devotion": "Quest: After you buy 4 Kindred, your left and right most slots gain Reborn.",
    "sapling": "Avenge(3): Become a 14/14 Rootling.",
    "farmer": "Avenge(3): Get 2 Saplings.",
    "organizer": "Taunt. Battlecry: Give a friendly unit Taunt and +4/+4.",
    "honeysuckle_brambor": "Avenge(3): Get 2 random Brambor units.",
    "roll_guard": "Divine Shield, Taunt",
    "root": "At the end of combat, if this survived, get 2 random Brambor.",
    "splashmaster": "Rally: Remove Taunt, Reborn and Divine Shield from the target.",
    "elder": "Start of Battle: Give your other units double the stats of this slot.",
    "cursed_vines": "Rally: Give this slot +2/+4.",
    "witch": "Rally: Deal this unit's damage to a random enemy unit twice.",
    "warlock": "Whenever a Rally is triggered, gain 6 health permanently.",
    "distant_land": "Start of Battle: Triple this unit's stats.",
    "ancient_name_brambor": "Battlecry: Give this slot Divine Shield and +10/+10.",
    "chosen_name": "Battlecry: Give this slot +22/+22",
    "andromeda_robin": "Start of Combat: Deal 6 damage to 4 random enemies and improve this twice.",
    "green_gem": "Deathrattle: Give your units in hand +2/+2 and improve this.",
    "storyteller": "When you sell this, gain 2 random Tier 1 units.",
    "disciple": "Deathrattle: Deal 1 damage to a random enemy unit twice.",
    "hunter": "Start of Combat: Give 2 random enemy units Taunt and deal 1 damage to them.",
    "orange_ninja": "Venomous",
    "owl": "Battlecry: Discover a unit from a Rival's army twice.",
    "secret": "Start of Combat: When your last unit dies, spawn a Golden Forest Abomination.",
    "white_ninja": "Divine Shield. Venomous.",
    "songstress": "Avenge(3): Give a random card in your hand +10/+10.",
    "red_sea_snake": "Venomous. Rally: Give 2 other Cloister units Venomous.",
    "larva": "After this is in your hand for 2 turns, gain a Golden tier 5 Cloister unit.",
    "ambush": "Deathrattle: Summon the 2 highest-attack Cloister units from your hand. They attack immediately.",
    "shadow_place": "Whenever you play a Cloister unit, give two other friendly units +6/+6.",
    "omar_evans": "Stealth. Avenge (2): This gains Divine Shield and attacks immediately.",
    "shine_like_a_knife": "Deathrattle: Give this unit's Attack to four friendly units.",
    "left_twinbot": "Rally: Give the unit to the right of this +4/+4 and Reborn.",
    "right_twinbot": "Start of Combat: Give the unit to the left of this Reborn and +4/+4.",
    "tinker": "Alcove units in the shop have +2/+2 for the rest of this game.",
    "sniper": "Start of battle: Deal 12 damage to the opponent's right-most minion twice.",
    "mod": "Battlecry: Give this unit's stats to the unit to the right of it.",
    "chaos": "Start of Turn: Give your left-most unit +6/+6. Repeat for each Battlecry you played this turn.",
    "aerial_drone": "Whenever you trigger a Battlecry, gain +4/+8.",
    "computer": "Taunt. Deathrattle: It costs 2 less gold to upgrade the shop.",
    "virus": "Battlecry: Each Rival's left-most slot gains -5/-5, and each Rival gains a Virus to their hand.",
    "robot_boy": "End of Turn: Gain 2 random Neutral cards of any tier.",
    "scientist": "Battlecry: For the rest of this game, Alcove units have +6 Attack.",
    "paradox": "Battlecry: Copy the powers of your left-most slot to 2 random plain slots.",
    "warmech": "Divine Shield. Reborn. This unit has +8/+4 for each Battlecry you've triggered this game.",
    "may_danaris": "Deathrattle: Summon a 200/200 Phoenix.",
    "golden_light": "Deathrattle. You take 1 damage.",
    "drill_sgt": "Start of Combat: If you are tier 3 or lower, gain +10 Attack.",
    "shopkeep": "After you buy 4 units, gain 2 random Tier 1 cards.",
    "intern": "Whenever you sell a tier 3 unit, gain 2 random tier 2 units.",
    "pyro": "When this kills a unit when attacking, it deals excess damage to both adjacent units.",
    "jeweler": "Battlecry: Improve your Red Gems twice.",
    "treasure": "This sells for 12 gold.",
    "biker": "Whenever this takes damage, it gains +4/+6.",
    "investor": "End of turn: Increase your maximum Gold by 2.",
    "red_gem": "Battlecry: Give your 3 left-most units +8 of a random stat.",
    "purveyor": "End of Turn: Gain 2 Red Gems.",
    "gargoil": "Deathrattle: Deal 20 damage to 3 friendly and 3 enemy units.",
    "miner": "Rally: Gain 2 Red Gems.",
    "bill_milton": "Battlecry: Gain quest: Buy 8 Business Demons to gain 24 Gold.",
    "gem_wizard": "Your Red Gems trigger their Battlecries three times.",
    "exploit": "Battlecry: Destroy a friendly unit. Gain 10 gold.",
    "sword": "Battlecry: Destroy this and give your left-most unit +8 Attack.",
    "shield_neutral": "Battlecry: Destroy this and give your right-most unit +2/+4 and Taunt.",
    "pickaxe": "Gain 2 gold next turn.",
    "scout": "When you sell this, discover a Tier 1 unit twice (improves each turn).",
    "silver_banner": "Battlecry: Give adjacent units +6 Attack. Improve your future Banners twice.",
    "gold_banner": "Battlecry: Give adjacent units +6 Health. Improve your future Banners twice.",
    "poison": "Deathrattle: Kill the unit that killed this and a random enemy.",
    "vampire": "Whenever another friendly Deathrattle unit dies, this gains +2 Health permanently.",
    "locas": "Stealth. Whenever a unit with Taunt dies, this gains +4/+2 permanently.",
    "spoonful": "Deathrattle: Trigger a friendly Battlecry twice.",
    "grief": "Battlecry: reduce the cost of upgrading the shop level by 6.",
    "sarinee": "Your end of turn effects trigger three times.",
    "broken_land": "Battlecry: Sell your left-most unit and give double its stats to your right-most unit.",
    "tom_judith": "Your deathrattles trigger three times.",
    "omni_gem": "Battlecry: Give the unit to the left of this four random Bonus Keywords.",
}

# Clarified base text where the spreadsheet left a number implicit (shown in-game only).
TEXT_OVERRIDES = {
    "grief": "Battlecry: reduce the cost of upgrading the shop level by 3.",
}

TOKENS = [
    {"id": "skel", "name": "Skel", "tribe": "neverending", "tier": 1, "atk": 1, "hp": 1,
     "text": "", "goldenText": ""},
    {"id": "rootling", "name": "Rootling", "tribe": "brambor", "tier": 1, "atk": 7, "hp": 7,
     "text": "", "goldenText": ""},
    {"id": "phoenix", "name": "Phoenix", "tribe": "alcove", "tier": 5, "atk": 100, "hp": 100,
     "text": "", "goldenText": ""},
]


# cards renamed after launch keep their original ID (their ability code and art are keyed by it)
RENAMED = {"forest_abomination": "white_ninja", "green_ninja": "orange_ninja"}


def slug(s):
    s = s.lower().replace("&", "and")
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return RENAMED.get(s, s)


def parse_keywords(text):
    kws = []
    for part in re.split(r"[.,]", text or ""):
        p = part.strip().lower()
        if p in KEYWORDS:
            kws.append(KEYWORDS[p])
        elif p:
            break
    return kws


def main():
    src = sys.argv[1]
    out_golden = None
    if "--write-golden" in sys.argv:
        out_golden = sys.argv[sys.argv.index("--write-golden") + 1]
    wb = openpyxl.load_workbook(src)
    ws = wb.worksheets[0]
    rows = []
    tribe = None
    for r in range(2, ws.max_row + 1):
        name = ws.cell(r, 3).value
        if not name:
            continue
        t = ws.cell(r, 1).value
        if t:
            tribe = t
        rows.append((r, tribe, name))

    # the art workbook (tools/export_sheets.py) adds Card ID, Art source and Crop columns
    head = {str(ws.cell(1, c).value or "").strip(): c for c in range(1, ws.max_column + 1)}
    id_col = head.get("Card ID")
    src_col = head.get("Art source")
    crop_col = head.get("Crop (x, y, size)")
    names = [slug(n) for _, _, n in rows]
    cards = []
    art_changes = {}
    for (r, tribe_key, name), base_slug in zip(rows, names):
        tid, _ = TRIBES[tribe_key]
        cid = base_slug if names.count(base_slug) == 1 else f"{base_slug}_{tid}"
        if id_col and ws.cell(r, id_col).value:
            cid = str(ws.cell(r, id_col).value).strip()  # keeps art and ability code attached through renames
        if src_col and crop_col and ws.cell(r, src_col).value:
            art_changes[cid] = (str(ws.cell(r, src_col).value).strip(), str(ws.cell(r, crop_col).value or "").strip())
        text = (ws.cell(r, 6).value or "").strip()
        text = TEXT_OVERRIDES.get(cid, text)
        golden_cell = ws.cell(r, 7).value
        golden = (str(golden_cell).strip() if golden_cell else None) or GOLDEN.get(cid)
        if golden is None:
            raise SystemExit(f"missing golden text for {cid}")
        cards.append({
            "id": cid,
            "name": str(name).strip(),
            "tribe": tid,
            "tier": int(ws.cell(r, 2).value),
            "atk": int(ws.cell(r, 4).value),
            "hp": int(ws.cell(r, 5).value),
            "text": text,
            "goldenText": golden,
            "keywords": parse_keywords(text),
        })
        if out_golden:
            ws.cell(r, 7).value = golden
    for t in TOKENS:
        cards.append({**t, "keywords": [], "token": True})

    tribes = {v[0]: v[1] for v in TRIBES.values()}
    with open("src/data/cards.json", "w") as f:
        json.dump({"tribes": tribes, "cards": cards}, f, indent=1)
    print(f"wrote {len(cards)} cards")
    if art_changes:
        update_art(art_changes)
    if out_golden:
        wb.save(out_golden)
        print("wrote", out_golden)


FOLDERS = [("Images/UI/characterportraits/UnitUIIcons/", "U"), ("Images/UI/characterportraits/", "P"), ("Illustrations/Characters/", "C"),
           ("Images/GemImages/", "G"), ("Images/NMB Intro/", "N"), ("Images/Units/", "S"), ("Images/Tiles/", "T"), ("Images/UI/", "UI"),
           ("Images/", "M"), ("Illustrations/", "I"), ("RGB PNG/", "R"), ("Circle and square icons/", "K")]


def update_art(changes):
    """Write changed Art source / Crop cells back to tools/art_sources.json (then run tools/build_art.py)."""
    path = "tools/art_sources.json"
    data = json.load(open(path))
    changed = []
    for cid, (where, crop) in changes.items():
        key = next((k + "/" + where[len(f):] for f, k in FOLDERS if where.startswith(f)), None)
        if not key:
            print(f"  {cid}: unknown art folder in {where!r}, skipped")
            continue
        spec = {"src": key}
        if crop.startswith("pixel"):
            spec["px"] = True
            box = re.findall(r"\d+", crop.replace("flipped", ""))
            if len(box) == 4:
                spec["box"] = [int(b) for b in box]
        else:
            spec["crop"] = [float(v) for v in re.findall(r"[\d.]+", crop)[:3]]
        if "flip" in crop:
            spec["flip"] = True
        if data["cards"].get(cid) != spec:
            data["cards"][cid] = spec
            changed.append(cid)
    if changed:
        json.dump(data, open(path, "w"), indent=1)
        print(f"art changed for {len(changed)} cards: {', '.join(changed)} (run tools/build_art.py <assets>)")


if __name__ == "__main__":
    main()
