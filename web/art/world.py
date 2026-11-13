"""Overworld for Long Con: a 1440x288 road through three towns, 3/4 top-down.
Outputs world.png (ground and buildings), canopy.png (tree tops drawn over the player),
world.json (towns, merchant spots, solid rects), and sprite sheets for the player, merchants and the news courier."""
import json
import math
import sys
from kit import *
from town import house, windmill, gatehouse, ROOF_RED, ROOF_SLATE, ROOF_TEAL

W, H = 1440, 288
TOWNS = [240, 720, 1200]
NAMES = ['mill', 'gate', 'port']
ROAD_Y = lambda x: 196 + math.sin(x * 0.006) * 10 + math.sin(x * 0.017) * 3
RIVER_X = lambda y: 960 + math.sin(y * 0.05) * 7
solids = []


def solid(x, y, w, h):
    solids.append([int(x), int(y), int(w), int(h)])


def grass(c):
    def g(x, y):
        n = (math.sin(x * 0.11 + y * 0.07) + math.sin(x * 0.031 - y * 0.13) * 0.8) * 0.12
        t = 0.48 + n + (0.18 if (x * 7 + y * 13) % 53 == 0 else 0) - (0.12 if (x * 5 + y * 11) % 41 == 0 else 0)
        return ramp(GRASS, t)
    c.fill(0, 0, W, H, g)
    rng = c.rng
    for _ in range(900):  # tufts and flowers
        x, y = rng.randint(0, W - 1), rng.randint(0, H - 1)
        if rng.random() < 0.82:
            c.set(x, y, GRASS[4]); c.set(x, y - 1, GRASS[3])
        else:
            col = rng.choice([(236, 214, 120), (226, 120, 110), (240, 236, 220), (150, 170, 230)])
            c.set(x, y, col); c.set(x + 1, y, GRASS[1])


def road(c):
    for x in range(W):
        y0 = ROAD_Y(x)
        for y in range(int(y0 - 11), int(y0 + 12)):
            d = abs(y - y0)
            if d > 10:
                c.set(x, y, GRASS[0])
            elif d > 8.5:
                c.set(x, y, DIRT[1])
            else:
                rut = d < 6 and abs(d - 4) < 0.8
                n = (0.12 if (x * 3 + y * 7) % 17 == 0 else 0) - (0.1 if (x + y * 5) % 23 == 0 else 0)
                c.set(x, y, ramp(DIRT, (0.42 if rut else 0.62) + n))


def river(c):
    for y in range(H):
        rx = RIVER_X(y)
        for x in range(int(rx - 14), int(rx + 15)):
            d = abs(x - rx)
            if d > 12:
                c.set(x, y, DIRT[2])
            else:
                sh = 0.35 + (0.35 if (x * 2 + y * 3) % 19 == 0 else 0) + (0.15 if d < 3 else 0)
                c.set(x, y, ramp(WATER, sh))
        if not (ROAD_Y(rx) - 14 < y < ROAD_Y(rx) + 14):
            solid(rx - 13, y, 26, 1)
    # bridge over the road crossing
    by = ROAD_Y(960)
    c.fill(938, by - 13, 44, 26, lambda x, y: WOOD[3] if (x - 938) % 5 else WOOD[1])
    c.rect(938, by - 14, 44, 2, WOOD[0]); c.rect(938, by + 12, 44, 2, WOOD[0])
    for px in range(938, 984, 11):
        c.rect(px, by - 18, 2, 5, WOOD[0]); c.rect(px, by + 12, 2, 5, WOOD[0])
    solid(936, by - 18, 46, 4); solid(936, by + 13, 46, 4)


def harbor(c):
    # sea along the bottom right with a pier
    for x in range(1290, W):
        top = 236 - (x - 1290) * 0.35 + math.sin(x * 0.08) * 2
        for y in range(int(top), H):
            sh = 0.3 + (0.4 if (x + y * 4) % 23 == 0 else 0) + (0.2 if y - top < 2 else 0)
            c.set(x, y, ramp(WATER, sh) if y - top >= 1 else CLOTH_CREAM[2])
        solid(x, top + 2, 1, H)
    c.fill(1330, 214, 12, 60, lambda x, y: WOOD[3] if (y - 214) % 4 else WOOD[1])
    solid(1330, 250, 12, 30)


def fields(c, x0, x1, y0, y1):
    for y in range(y0, y1):
        for x in range(x0, x1):
            row = (y - y0) % 6
            c.set(x, y, GRAIN[2] if row < 3 else (GRAIN[1] if row == 3 else DIRT[2]))
            if row == 1 and (x * 3) % 5 == 0:
                c.set(x, y, GRAIN[3])
    c.rect(x0 - 1, y0 - 2, x1 - x0 + 2, 1, WOOD[1])
    for x in range(x0 - 1, x1 + 1, 6):
        c.rect(x, y0 - 4, 1, 4, WOOD[2])


def tree(c, canopy, x, y, rng, pine=False):
    shadow(c, x + 1, y + 1, 7, 2.5, 80)
    c.rect(x - 1, y - 7, 3, 8, WOOD[1]); c.set(x - 1, y - 7, WOOD[3])
    if pine:
        for k in range(3):
            w = 9 - k * 2
            canopy.poly([(x - w, y - 6 - k * 6), (x + 1, y - 18 - k * 6), (x + w + 1, y - 6 - k * 6)],
                        lambda i, j: ramp(HILL_NEAR, 0.75 - (i - x + w) / (2 * w) * 0.6))
    else:
        r = rng.choice((7, 8, 9))
        for ox, oy, rr in ((0, -12, r), (-4, -9, r - 2), (4, -9, r - 2)):
            canopy.ellipse(x + ox, y + oy - r * 0.4, rr, rr * 0.85,
                           lambda i, j, d, cx=x + ox, cy=y + oy - r * 0.4, rr=rr: ramp(HILL_NEAR, sphere_t(i, j, cx, cy, rr, rr * 0.85) * 1.05 + 0.05))
        if rng.random() < 0.3:
            for _ in range(3):
                canopy.set(x + rng.randint(-5, 5), y - 12 + rng.randint(-5, 3), CLOTH_RED[2])
    solid(x - 2, y - 3, 5, 4)


def stall(c, cx, y, awn):
    a, b = awn
    shadow(c, cx, y + 2, 20, 3, 90)
    c.fill(cx - 17, y - 12, 34, 12, lambda i, j: ramp(WOOD, 0.75 - (j - y + 12) / 12 * 0.4))
    c.rect(cx - 18, y - 13, 36, 2, WOOD[4])
    for k in range(5):
        c.ellipse(cx - 12 + k * 6, y - 14, 2, 2, lambda i, j, d, k=k: [GRAIN, CLOTH_GREEN, GOLD, CLOTH_RED, GRAIN][k][2])
    c.rect(cx - 19, y - 34, 2, 34, WOOD[0]); c.rect(cx + 17, y - 34, 2, 34, WOOD[0])
    for x in range(cx - 21, cx + 22):
        pal = a if ((x - cx + 21) // 6) % 2 == 0 else b
        for yy in range(y - 40, y - 31 + (1 if (x - cx) % 6 in (2, 3) else 0)):
            c.set(x, yy, ramp(pal, 0.9 - (yy - y + 40) / 10 * 0.5))
    c.rect(cx - 22, y - 41, 44, 1, WOOD[0])
    solid(cx - 19, y - 14, 38, 14)


def signpost(c, x, y, rng):
    c.rect(x, y - 14, 2, 14, WOOD[1])
    c.fill(x - 8, y - 16, 18, 6, lambda i, j: WOOD[3] if j > y - 16 else WOOD[4])
    for i in range(x - 6, x + 8, 2):
        c.set(i, y - 13, WOOD[1])
    solid(x - 1, y - 3, 4, 3)


def noticeboard(c, x, y):
    c.rect(x - 9, y - 18, 2, 18, WOOD[1]); c.rect(x + 8, y - 18, 2, 18, WOOD[1])
    c.fill(x - 10, y - 20, 21, 12, lambda i, j: WOOD[2])
    c.rect(x - 11, y - 21, 23, 2, WOOD[0])
    solid(x - 10, y - 4, 21, 4)


def well(c, x, y):
    shadow(c, x, y + 1, 9, 2.5, 80)
    c.ellipse(x, y - 4, 8, 5, lambda i, j, d: STONE[3] if d > 0.55 else (30, 50, 70))
    c.rect(x - 7, y - 4, 14, 4, STONE[2])
    c.rect(x - 7, y - 16, 2, 12, WOOD[1]); c.rect(x + 6, y - 16, 2, 12, WOOD[1])
    c.poly([(x - 10, y - 15), (x, y - 22), (x + 10, y - 15)], lambda i, j: ROOF_RED[2])
    solid(x - 8, y - 8, 16, 8)


def plaza(c, cx):
    for y in range(146, 190):
        for x in range(cx - 150, cx + 151):
            d = ((x - cx) / 150) ** 2 + ((y - 170) / 26) ** 2
            if d < 1:
                bw, bh = 6, 4
                row = (y - 146) // bh
                edge = (y - 146) % bh == 0 or (x + row * 3) % bw == 0
                n = ((x + row * 3) // bw * 7 + row * 5) % 5 / 5
                t = 0.62 + n * 0.18 - edge * 0.25 - d * 0.15
                c.set(x, y, ramp(COBBLE_W, t) if d < 0.93 else GRASS[0])


COBBLE_W = [(92, 80, 76), (128, 112, 102), (160, 144, 128), (190, 176, 156)]


def town(c, canopy, k, cx, rng):
    roofs = [[ROOF_RED, ROOF_SLATE, ROOF_RED, ROOF_TEAL], [ROOF_SLATE, ROOF_TEAL, ROOF_SLATE, ROOF_RED], [ROOF_TEAL, ROOF_SLATE, ROOF_TEAL, ROOF_RED]][k]
    bldg = Canvas(W, H, seed=k)
    # merchant's home sits right behind the stall
    home_w = 40
    house(bldg, cx - home_w // 2, 120, home_w, 34, roofs[0], rng)
    solid(cx - home_w // 2 - 2, 104, home_w + 4, 50)
    for i, (dx, w, h) in enumerate([(-122, 28, 26), (-80, 30, 30), (62, 30, 28), (100, 26, 24)]):
        if k == 2 and dx > 0:
            continue
        hx = cx + dx
        house(bldg, hx, 154 - h, w, h, roofs[(i + 1) % 4], rng)
        solid(hx - 2, 154 - h - 10, w + 4, h + 10)
    if k == 0:
        windmill(bldg, cx + 128, 92, 0.3)
        solid(cx + 120, 92, 16, 40)
    if k == 1:
        gatehouse(bldg, cx + 128, 100)
        solid(cx + 98, 88, 62, 54)
    bldg.outline()
    c.blit(bldg, 0, 0)
    awn = [(CLOTH_RED, CLOTH_CREAM), (CLOTH_TEAL, CLOTH_CREAM), (CLOTH_BLUE, CLOTH_CREAM)][k]
    stall(c, cx, 176, awn)
    noticeboard(c, cx + 44, 178)
    signpost(c, cx - 50, 180, rng)
    if k != 2:
        well(c, cx - 96, 176)


def couriers(out):
    """Rider on a pony, 24x20, 2 frames, facing right."""
    sheet = Canvas(48, 20)
    for f in range(2):
        c = Canvas(24, 20)
        legs = [(5, 8), (16, 13)] if f == 0 else [(7, 6), (14, 15)]
        c.ellipse(10, 11, 7, 3.5, lambda i, j, d: ramp(WOOD, sphere_t(i, j, 10, 11, 7, 3.5) + 0.15))
        c.poly([(15, 9), (18, 3), (21, 4), (18, 11)], lambda i, j: WOOD[3])
        c.poly([(18, 3), (23, 5), (23, 7), (19, 7)], lambda i, j: WOOD[3])
        c.rect(22, 6, 1, 1, WOOD[0]); c.set(20, 4, INK); c.rect(18, 1, 1, 2, WOOD[2])
        c.line(15, 8, 18, 2, HAIR_BROWN[0])
        for lx, lx2 in [legs[0], legs[1]]:
            c.line(lx, 13, lx - 1 + f, 18, WOOD[0]); c.line(lx2, 13, lx2 + 1 - f, 18, WOOD[0])
        c.line(3, 10, 1, 15, HAIR_BROWN[0]); c.line(4, 10, 2, 14, HAIR_BROWN[1])
        c.rect(8, 3, 5, 6, CLOTH_TEAL[2]); c.rect(9, 0, 3, 3, SKIN[2]); c.rect(8, 0, 5, 1, HAIR_BROWN[0])
        c.rect(4, 4, 4, 4, CLOTH_CREAM[3]); c.rect(5, 5, 2, 1, CLOTH_RED[2])  # the news scroll
        c.outline()
        sheet.blit(c, f * 24, 0)
    sheet.save(f'{out}/courier.png')


def person(c, ox, facing, step, spec):
    """16x24 walker. facing 0 down, 1 left, 2 right, 3 up. step 0..3."""
    bob = 1 if step in (1, 3) else 0
    sk, hair, coat = spec['skin'], spec['hair'], spec['coat']
    shadow(c, ox + 8, 23, 5, 1.5, 90)
    # legs
    swing = [0, 2, 0, -2][step]
    if facing in (0, 3):
        c.rect(ox + 5, 18 - bob + (1 if swing > 0 else 0), 2, 5 - (1 if swing > 0 else 0), (52, 42, 48))
        c.rect(ox + 9, 18 - bob + (1 if swing < 0 else 0), 2, 5 - (1 if swing < 0 else 0), (52, 42, 48))
    else:
        c.rect(ox + 7 + swing // 2, 18 - bob, 2, 5, (52, 42, 48))
        c.rect(ox + 7 - swing // 2, 18 - bob, 2, 5, (40, 32, 38))
    # body
    c.fill(ox + 4, 11 - bob, 8, 8, lambda i, j: ramp(coat, 0.8 - (i - ox - 4) / 8 * 0.5))
    if facing == 0:
        c.rect(ox + 7, 12 - bob, 2, 6, spec.get('trim', coat)[3])
    c.rect(ox + 3, 12 - bob, 1, 5, coat[1]); c.rect(ox + 12, 12 - bob, 1, 5, coat[0])
    c.rect(ox + 3, 16 - bob + (swing // 2 if facing in (0, 3) else 0), 1, 2, sk[2])
    c.rect(ox + 12, 16 - bob - (swing // 2 if facing in (0, 3) else 0), 1, 2, sk[1])
    # head
    c.ellipse(ox + 8, 7 - bob, 4.5, 4.5, lambda i, j, d: ramp(sk, sphere_t(i, j, ox + 8, 7 - bob, 4.5, 4.5) + 0.1))
    if facing == 3:
        c.ellipse(ox + 8, 6 - bob, 4.6, 4.3, lambda i, j, d: hair[1])
    else:
        c.rect(ox + 4, 3 - bob, 9, 2, hair[1])
        if facing == 0:
            c.set(ox + 6, 7 - bob, INK); c.set(ox + 10, 7 - bob, INK)
        elif facing == 1:
            c.set(ox + 5, 7 - bob, INK); c.rect(ox + 9, 3 - bob, 4, 5, hair[1])
        else:
            c.set(ox + 11, 7 - bob, INK); c.rect(ox + 4, 3 - bob, 4, 5, hair[1])
    hat = spec.get('hat')
    if hat:
        c.rect(ox + 3, 2 - bob, 11, 2, hat[2]); c.rect(ox + 5, 0 - bob, 7, 2, hat[1])


def walkers(out):
    player = dict(skin=SKIN, hair=HAIR_RED, coat=CLOTH_RED, trim=GOLD, hat=WOOD)
    sheet = Canvas(16 * 4, 24 * 4)
    for f in range(4):
        for s in range(4):
            c = Canvas(16, 24)
            person(c, 0, f, s, player)
            c.outline()
            sheet.blit(c, s * 16, f * 24)
    sheet.save(f'{out}/player.png')
    specs = [dict(skin=SKIN, hair=HAIR_BROWN, coat=CLOTH_GREEN, trim=CLOTH_CREAM, hat=CLOTH_RED),
             dict(skin=SKIN, hair=HAIR_GREY, coat=CLOTH_TEAL, trim=GOLD, hat=ROOF_SLATE),
             dict(skin=SKIN_DARK, hair=HAIR_BROWN, coat=CLOTH_BLUE, trim=GOLD, hat=WOOD)]
    sheet = Canvas(32, 24 * 3)
    for k, sp in enumerate(specs):
        for s in range(2):
            c = Canvas(16, 24)
            person(c, 0, 0, s * 2 + 1 if s else 0, sp)
            c.outline()
            sheet.blit(c, s * 16, k * 24)
    sheet.save(f'{out}/townsfolk.png')


def build(out):
    c = Canvas(W, H, seed=3)
    canopy = Canvas(W, H, seed=4)
    rng = c.rng
    grass(c)
    fields(c, 70, 190, 222, 262)
    fields(c, 300, 400, 226, 270)
    road(c)
    river(c)
    harbor(c)
    for cx in TOWNS:
        plaza(c, cx)
    road(c)
    for k, cx in enumerate(TOWNS):
        town(c, canopy, k, cx, rng)
    # forest belts away from towns, road, river and sea
    for _ in range(170):
        x, y = rng.randint(4, W - 4), rng.randint(16, H - 6)
        if abs(y - ROAD_Y(x)) < 22 or any(abs(x - t) < 165 and 70 < y < 214 for t in TOWNS) or abs(x - RIVER_X(y)) < 22:
            continue
        if (x > 1280 and y > 220) or (60 < x < 200 and 210 < y < 268) or (290 < x < 410 and 215 < y < 275):
            continue
        tree(c, canopy, x, y, rng, pine=y < 70 or rng.random() < 0.25)
    canopy.outline()
    solid(0, 0, W, 66)  # northern treeline
    c.save(f'{out}/world.png')
    canopy.save(f'{out}/canopy.png')
    spots = [{'x': cx, 'y': 160, 'talk': {'x': cx, 'y': 196}} for cx in TOWNS]
    json.dump({'w': W, 'h': H, 'towns': [{'x': cx, 'name': NAMES[k]} for k, cx in enumerate(TOWNS)],
               'merchants': spots, 'boards': [{'x': cx + 44, 'y': 166} for cx in TOWNS],
               'road': [[x, round(ROAD_Y(x), 1)] for x in range(0, W + 1, 24)], 'solids': solids},
              open(f'{out}/world.json', 'w'))
    couriers(out)
    walkers(out)
    prev = Canvas(W, H)
    prev.blit(c, 0, 0); prev.blit(canopy, 0, 0)
    prev.save(f'{out}/world-preview.png', scale=1)


if __name__ == '__main__':
    build(sys.argv[1])
