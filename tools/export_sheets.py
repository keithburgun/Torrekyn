"""
Writes Torrekin.xlsx: every card, hero and trinket with its art, for editing and sending back.

  python3 tools/export_sheets.py out.xlsx

Sheets:
  Cards     same first 7 columns as the card spreadsheet (tools/import_cards.py reads it as-is),
            then the art, the card's ID, and where the art comes from (tools/art_sources.json).
  Tokens    units that are only ever summoned (Skel, Rootling, Phoenix).
  Heroes    the heroes with their portraits.
  Trinkets  the trinkets (no art yet).
"""
import io, json, os, re, sys
import openpyxl
from openpyxl.drawing.image import Image as XLImage
from openpyxl.styles import Alignment, Font, PatternFill, Border, Side
from openpyxl.utils import get_column_letter
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRIBE_KEY = {'neverending': 'neverendingParty', 'azure': 'azureOrder', 'kindred': 'kindredSociety', 'brambor': 'brambor',
             'cloister': 'cloister', 'alcove': 'alcovePrefex', 'demons': 'businessDemons', 'neutral': 'neutral'}
TRIBE_FILL = {'neverending': 'EDE4FB', 'azure': 'E1EAFB', 'kindred': 'FBE4EF', 'brambor': 'F3E8DA', 'cloister': 'E2F2DF',
              'alcove': 'FBF4D2', 'demons': 'FBE0DC', 'neutral': 'EEEEF2'}
THUMB = 110  # px
ROW_PT = 86
FONT = 'Arial'

def thumb(path, round_=False):
    im = Image.open(path).convert('RGB').resize((THUMB, THUMB), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'PNG')
    buf.seek(0)
    x = XLImage(buf)
    x.width = x.height = THUMB
    return x

def src_text(spec):
    return spec['src'].split('/', 1)[1] if spec else ''

FOLDER = {'R': 'RGB PNG', 'I': 'Illustrations', 'C': 'Illustrations/Characters', 'M': 'Images', 'P': 'Images/UI/characterportraits',
          'U': 'Images/UI/characterportraits/UnitUIIcons', 'G': 'Images/GemImages', 'N': 'Images/NMB Intro', 'S': 'Images/Units',
          'T': 'Images/Tiles', 'UI': 'Images/UI', 'K': 'Circle and square icons'}

def where(spec):
    k, _, f = spec['src'].partition('/')
    return f'{FOLDER[k]}/{f}'

def crop_text(spec):
    flip = ', flipped' if spec.get('flip') else ''
    if spec.get('px'):
        return 'pixel' + (f" box {','.join(map(str, spec['box']))}" if spec.get('box') else '') + flip
    return ', '.join(f'{v:g}' for v in spec['crop']) + flip

def style_sheet(ws, headers, widths, title=None):
    hdr_row = 1
    for i, (h, w) in enumerate(zip(headers, widths), 1):
        c = ws.cell(hdr_row, i, h)
        c.font = Font(name=FONT, bold=True, color='FFFFFF')
        c.fill = PatternFill('solid', fgColor='4A3D70')
        c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[hdr_row].height = 30
    ws.freeze_panes = 'A2'
    ws.page_setup.orientation = 'landscape'
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.print_title_rows = '1:1'

def body(c, fill=None, wrap=True, center=False):
    c.font = Font(name=FONT)
    c.alignment = Alignment(vertical='center', wrap_text=wrap, horizontal='center' if center else None)
    if fill:
        c.fill = PatternFill('solid', fgColor=fill)

def main():
    out = sys.argv[1]
    cards = json.load(open(os.path.join(ROOT, 'src/data/cards.json')))['cards']
    src = json.load(open(os.path.join(ROOT, 'tools/art_sources.json')))
    heroes = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else []
    trinkets = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else []
    wb = openpyxl.Workbook()

    # ---- Cards ----
    ws = wb.active
    ws.title = 'Cards'
    headers = ['Tribe', 'Tier', 'Card Name', 'Attack', 'Health', 'Ability', 'Golden Ability', 'Art', 'Card ID', 'Art source', 'Crop (x, y, size)']
    style_sheet(ws, headers, [17, 6, 20, 8, 8, 44, 44, 17, 22, 46, 16])
    r = 2
    for c in cards:
        if c.get('token'):
            continue
        spec = src['cards'].get(c['id'])
        vals = [TRIBE_KEY[c['tribe']], c['tier'], c['name'], c['atk'], c['hp'], c['text'], c.get('goldenText', ''), None, c['id'],
                where(spec) if spec else '', crop_text(spec) if spec else '']
        for i, v in enumerate(vals, 1):
            cell = ws.cell(r, i, v)
            body(cell, TRIBE_FILL[c['tribe']] if i <= 7 else None, center=i in (2, 4, 5))
        ws.row_dimensions[r].height = ROW_PT
        art = os.path.join(ROOT, 'public/art/v2/cards', f"{c['id']}.webp")
        if os.path.exists(art):
            ws.add_image(thumb(art), f'H{r}')
        r += 1
    ws.auto_filter.ref = f'A1:K{r - 1}'

    # ---- Tokens ----
    wt = wb.create_sheet('Tokens')
    style_sheet(wt, ['Tribe', 'Tier', 'Card Name', 'Attack', 'Health', 'Art', 'Card ID', 'Art source', 'Crop (x, y, size)'], [17, 6, 20, 8, 8, 17, 16, 46, 16])
    r = 2
    for c in cards:
        if not c.get('token'):
            continue
        spec = src['cards'].get(c['id'])
        for i, v in enumerate([TRIBE_KEY[c['tribe']], c['tier'], c['name'], c['atk'], c['hp'], None, c['id'], where(spec), crop_text(spec)], 1):
            body(wt.cell(r, i, v), TRIBE_FILL[c['tribe']] if i <= 5 else None, center=i in (2, 4, 5))
        wt.row_dimensions[r].height = ROW_PT
        wt.add_image(thumb(os.path.join(ROOT, 'public/art/v2/cards', f"{c['id']}.webp")), f'F{r}')
        r += 1

    # ---- Heroes ----
    wh = wb.create_sheet('Heroes')
    style_sheet(wh, ['Hero', 'Identity', 'Hero Power', 'Type', 'Cost (gold)', 'Effect', 'Portrait', 'Hero ID', 'Art source', 'Crop (x, y, size)', 'Starting Health'],
                [18, 26, 20, 9, 9, 50, 17, 18, 46, 16, 10])
    r = 2
    for h in heroes:
        spec = src['heroes'].get(h['id'])
        vals = [h['name'], h['title'], h['power'], 'Passive' if h.get('passive') else 'Active', '—' if h.get('passive') else h.get('cost', 0),
                h['text'], None, h['id'], where(spec) if spec else '', crop_text(spec) if spec else '', h.get('health', 40)]
        for i, v in enumerate(vals, 1):
            body(wh.cell(r, i, v), center=i in (4, 5, 11))
        wh.row_dimensions[r].height = ROW_PT
        art = os.path.join(ROOT, 'public/art/v2/heroes', f"{h['id']}.webp")
        if os.path.exists(art):
            wh.add_image(thumb(art), f'G{r}')
        r += 1

    # ---- Trinkets ----
    wk = wb.create_sheet('Trinkets')
    style_sheet(wk, ['Trinket', 'Type', 'Offered on turn', 'Cost (gold)', 'Effect', 'Trinket ID'], [24, 9, 10, 9, 60, 22])
    r = 2
    for t in trinkets:
        vals = [t['name'], 'Greater' if t.get('greater') else 'Lesser', 9 if t.get('greater') else 6, t['cost'], t['text'], t['id']]
        for i, v in enumerate(vals, 1):
            body(wk.cell(r, i, v), center=i in (2, 3, 4))
        wk.row_dimensions[r].height = 32
        r += 1

    # ---- How to edit ----
    wi = wb.create_sheet('How to edit')
    notes = [
        'Torrekin — cards, heroes and trinkets with their art',
        '',
        'Edit anything and send the file back. Names, stats and text on the Cards sheet import directly (same columns as the card spreadsheet).',
        'Card ID / Hero ID: keep these as they are, even if you rename a card. They tie each row to its art and its ability code.',
        'To change a picture: either paste a new image into the Art cell, or change "Art source" to another file from the art folders.',
        'Crop (x, y, size): where to cut the square from the source image, as fractions. x and y are the centre (0.5, 0.5 = middle);',
        '   size is the square\'s side as a fraction of the image\'s shorter edge (1 = as big as possible, 0.4 = a close-up).',
        '   "pixel" means a small pixel-art sprite, scaled up sharp on a backdrop in the tribe\'s colour.',
        'Art source folders: "RGB PNG" (Spellstorm), "Illustrations", "Images" (Gem Wizards Tactics), "Circle and square icons".',
        'Trinkets have no art yet.',
    ]
    for i, n in enumerate(notes, 1):
        c = wi.cell(i, 1, n)
        c.font = Font(name=FONT, bold=i == 1, size=14 if i == 1 else 11)
    wi.column_dimensions['A'].width = 130
    wb.save(out)
    print('wrote', out)

main()
