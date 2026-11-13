"""Town scenes, 320x180 native. Layers: back.png (sky to stall back), front.png (counter and near props)."""
import math
import sys
from kit import *

W, H = 320, 180
GROUND_Y = 132
COBBLE_WARM = smooth_ramp([(54, 46, 52), (98, 82, 78), (150, 128, 112), (196, 176, 150)], 8)

THEMES = [
    dict(name='mill', roof=ROOF_RED, awning=(CLOTH_RED, CLOTH_CREAM), seed=11),
    dict(name='gate', roof=ROOF_SLATE, awning=(CLOTH_TEAL, CLOTH_CREAM), seed=23),
    dict(name='port', roof=ROOF_TEAL, awning=(CLOTH_BLUE, CLOTH_CREAM), seed=37),
]


SKY12 = smooth_ramp([(36, 58, 100), (64, 100, 142), (138, 150, 168), (230, 160, 116), (252, 210, 146)], 12)


def sky(c):
    for y in range(GROUND_Y):
        t = min(y / 96, 1) ** 1.25
        for x in range(W):
            c.set(x, y, ramp(SKY12, t, x, y, dither=True))


def clouds(c, rng):
    for _ in range(6):
        cx, cy = rng.randint(0, W), rng.randint(10, 52)
        n = rng.randint(3, 6)
        for k in range(n):
            rx, ry = rng.randint(8, 18), rng.randint(3, 6)
            ox = cx + k * rng.randint(7, 12) - n * 5
            oy = cy + rng.randint(-3, 3)
            c.ellipse(ox, oy, rx, ry, lambda x, y, d, oy=oy, ry=ry: (
                (250, 222, 180) if y > oy + ry * 0.25 else (236, 176, 140) if y > oy - ry * 0.3 else (172, 156, 170)))


def hills(c, rng, pal, base, amp, freq, phase):
    for x in range(W):
        top = base - amp * (0.6 * math.sin(x * freq + phase) + 0.4 * math.sin(x * freq * 2.3 + phase * 1.7))
        top += rng.random() * 0.8
        for y in range(int(top), GROUND_Y):
            t = 1 - (y - top) / max(GROUND_Y - top, 1)
            c.set(x, y, ramp(pal, t * 0.9, x, y))
        c.set(x, int(top), pal[-1])


def fields(c, rng):
    # striped crop rows on the near hill, mill country
    for y in range(100, GROUND_Y):
        for x in range(W):
            if (x + y * 2) % 9 < 2 and c.get(x, y)[3]:
                c.set(x, y, GRAIN[1] if (y // 3) % 2 else GRAIN[2], 150)


def house(c, x, y, w, h, roof, rng, plaster=PLASTER):
    # walls lit from the left
    c.fill(x, y, w, h, lambda i, j: ramp(plaster, 0.85 - (i - x) / w * 0.55, i, j))
    # timber frame
    for i in range(x, x + w, max(5, w // 3)):
        c.rect(i, y, 1, h, WOOD[1])
    c.rect(x, y, w, 1, WOOD[1])
    c.rect(x, y + h // 2, w, 1, WOOD[1])
    # windows, some lit
    for wx in range(x + 3, x + w - 4, 7):
        lit = rng.random() < 0.55
        c.rect(wx, y + 3, 3, 4, LAMP[0] if lit else (40, 44, 60))
        if lit:
            c.set(wx, y + 3, LAMP[2])
    # door
    if w > 14:
        dx = x + w // 2 - 2
        c.rect(dx, y + h - 7, 4, 7, WOOD[0])
    # roof
    peak = y - max(6, w // 2.4)
    pts = [(x - 2, y + 1), (x + w / 2, peak), (x + w + 2, y + 1)]
    c.poly(pts, lambda i, j: ramp(roof, 0.95 - (i - x + 2) / (w + 4) * 0.8 - ((j - peak) % 3 == 0) * 0.15, i, j))
    c.line(x - 2, y + 1, x + w + 2, y + 1, roof[0])
    # chimney
    if rng.random() < 0.6:
        cx = x + int(w * 0.7)
        c.rect(cx, peak + 2, 3, 6, STONE[1])
        c.rect(cx, peak + 2, 1, 6, STONE[3])


def windmill(c, x, y, phase=0.0):
    # tapered stone tower
    for j in range(40):
        half = 6 + j * 0.16
        for i in range(int(-half), int(half) + 1):
            c.set(x + i, y + j, ramp(STONE, 0.9 - (i + half) / (2 * half) * 0.7, x + i, y + j))
    c.rect(x - 2, y + 30, 4, 10, WOOD[0])
    c.rect(x - 1, y + 12, 2, 3, LAMP[0])
    # cap
    c.poly([(x - 8, y + 1), (x, y - 7), (x + 8, y + 1)], lambda i, j: ramp(ROOF_RED, 0.8 - (i - x + 8) / 16 * 0.6, i, j))
    # four sails
    for k in range(4):
        a = phase + k * math.pi / 2
        ex, ey = x + math.cos(a) * 26, y - 2 + math.sin(a) * 26
        c.line(x, y - 2, ex, ey, WOOD[0])
        for s in range(6, 26):
            px_, py_ = x + math.cos(a) * s, y - 2 + math.sin(a) * s
            ox, oy = -math.sin(a) * 4, math.cos(a) * 4
            c.line(px_, py_, px_ + ox, py_ + oy, CLOTH_CREAM[2] if s % 4 else WOOD[1])
    c.rect(x - 1, y - 3, 3, 3, WOOD[0])


def gatehouse(c, x, y):
    for tx in (x - 30, x + 18):
        c.fill(tx, y - 10, 14, 50, lambda i, j, tx=tx: ramp(STONE, 0.9 - (i - tx) / 14 * 0.6 - (((j // 4) + (i // 6)) % 2) * 0.08, i, j))
        for k in range(0, 14, 4):
            c.rect(tx + k, y - 13, 2, 3, STONE[2])
        c.rect(tx + 5, y + 2, 3, 5, LAMP[0])
    c.fill(x - 16, y + 4, 34, 36, lambda i, j: ramp(STONE, 0.7 - (i - x + 16) / 34 * 0.4, i, j))
    c.ellipse(x + 1, y + 26, 9, 12, lambda i, j, d: (34, 30, 40) if j > y + 16 else (24, 22, 30))
    c.rect(x - 8, y + 26, 18, 14, (34, 30, 40))
    for k in range(-7, 10, 3):
        c.rect(x + k, y + 16, 1, 24, WOOD[1])
    # banner
    c.rect(x - 1, y - 6, 1, 10, WOOD[0])
    c.fill(x, y - 6, 7, 5, lambda i, j: CLOTH_TEAL[2] if (i + j) % 5 else CLOTH_TEAL[1])


def harbor(c, x, y, rng):
    c.fill(0, y + 18, W, GROUND_Y - y - 18, lambda i, j: ramp(WATER, 0.25 + 0.6 * ((j - y - 18) / 30) + (0.25 if (i * 3 + j * 7) % 23 == 0 else 0), i, j))
    # ship hull and mast
    c.poly([(x - 26, y + 12), (x + 30, y + 12), (x + 22, y + 22), (x - 20, y + 22)], lambda i, j: ramp(WOOD, 0.7 - (j - y - 12) / 10 * 0.6, i, j))
    c.rect(x, y - 30, 2, 42, WOOD[0])
    c.poly([(x + 2, y - 28), (x + 24, y + 6), (x + 2, y + 6)], lambda i, j: ramp(CLOTH_CREAM, 0.95 - (i - x) / 24 * 0.5, i, j))
    c.poly([(x - 1, y - 22), (x - 20, y + 6), (x - 1, y + 6)], lambda i, j: ramp(CLOTH_CREAM, 0.75 - (x - i) / 20 * 0.4, i, j))
    c.fill(x + 2, y - 33, 6, 3, lambda i, j: CLOTH_BLUE[2])


def street(c, rng):
    for y in range(GROUND_Y, H):
        depth = (y - GROUND_Y) / (H - GROUND_Y)
        bh = 3 + int(depth * 4)
        bw = 7 + int(depth * 8)
        row = (y - GROUND_Y) // bh
        for x in range(W):
            off = (row * bw // 2) % bw
            edge = (y - GROUND_Y) % bh == 0 or (x + off) % bw == 0
            n = ((x + off) // bw * 31 + row * 17) % 7 / 7
            t = 0.62 - depth * 0.3 + n * 0.22 - edge * 0.32
            col = ramp(COBBLE_WARM, t)
            lane = abs(x - 160) < 26 + depth * 30
            if lane and not edge:
                col = lerp(col, ramp(DIRT, 0.55 - depth * 0.25 + n * 0.15), 0.7)
            c.set(x, y, col)
    # warm light pools under lamps added later by lamp()
    c.rect(0, GROUND_Y, W, 1, COBBLE[0])


def lamp(c, x):
    c.rect(x, GROUND_Y - 34, 2, 34, (40, 36, 44))
    c.rect(x - 1, GROUND_Y - 2, 4, 2, (40, 36, 44))
    c.rect(x - 2, GROUND_Y - 40, 6, 6, (40, 36, 44))
    c.rect(x - 1, GROUND_Y - 39, 4, 4, LAMP[1])
    c.set(x, GROUND_Y - 38, LAMP[2])
    c.rect(x - 3, GROUND_Y - 41, 8, 1, (40, 36, 44))
    # warm pool on the cobbles
    for j in range(GROUND_Y, GROUND_Y + 16):
        for i in range(x - 26, x + 28):
            d = ((i - x - 1) / 26) ** 2 + ((j - GROUND_Y - 6) / 9) ** 2
            if d < 1:
                c.set(i, j, (255, 196, 120), int(70 * (1 - d) ** 1.5))


def stall_back(c, cx, theme):
    a, b = theme['awning']
    # posts
    for px_ in (cx - 44, cx + 42):
        c.fill(px_, GROUND_Y - 62, 3, 62, lambda i, j, px_=px_: WOOD[3] if i == px_ else WOOD[1])
    # back cloth (shadowed)
    c.fill(cx - 41, GROUND_Y - 52, 83, 30, lambda i, j: b[0] if (i // 6) % 2 else lerp(b[0], b[1], 0.35))
    # shelves with goods
    c.rect(cx - 40, GROUND_Y - 36, 81, 2, WOOD[2])
    for k in range(9):
        gx = cx - 36 + k * 9
        pal = [GRAIN, CLOTH_GREEN, GOLD, CLOTH_RED][k % 4]
        c.ellipse(gx + 3, GROUND_Y - 40, 3, 4, lambda i, j, d, gx=gx, pal=pal: ramp(pal, sphere_t(i, j, gx + 3, GROUND_Y - 40, 3, 4), i, j))
    # awning: scalloped stripes
    top = GROUND_Y - 70
    for x in range(cx - 50, cx + 51):
        stripe = ((x - cx + 50) // 8) % 2
        pal = a if stripe == 0 else b
        hang = 14 + (2 if ((x - cx + 50) % 8) in (3, 4) else 0) + (1 if ((x - cx + 50) % 8) in (2, 5) else 0)
        for y in range(top, top + hang):
            slope = (y - top) / hang
            c.set(x, y, ramp(pal, 0.95 - slope * 0.55 - (0.15 if x - cx > 30 else 0), x, y))
        c.set(x, top + hang, pal[0])
    c.rect(cx - 51, top - 1, 103, 2, WOOD[1])


def stall_front(c, cx):
    # counter, front layer so the merchant stands behind it
    y0 = GROUND_Y - 24
    c.fill(cx - 46, y0, 93, 24, lambda i, j: WOOD[0] if (i - cx) % 12 == 0 else ramp(WOOD, 0.78 - (j - y0) / 24 * 0.5))
    c.fill(cx - 48, y0 - 3, 97, 3, lambda i, j: WOOD[4] if j == y0 - 3 else WOOD[3])
    # grain sacks on the ground
    BURLAP = [(92, 66, 44), (132, 100, 66), (170, 136, 92), (204, 176, 128)]
    for k, sx in enumerate((cx - 66, cx - 56, cx + 58)):
        shadow(c, sx + 1, GROUND_Y, 9, 2)
        c.poly([(sx - 7, GROUND_Y), (sx - 6, GROUND_Y - 9), (sx - 2, GROUND_Y - 13), (sx + 3, GROUND_Y - 13), (sx + 7, GROUND_Y - 9), (sx + 8, GROUND_Y)],
               lambda i, j, sx=sx: ramp(BURLAP, sphere_t(i, j, sx, GROUND_Y - 6, 8, 9) + (0.08 if (i + 2 * j) % 5 == 0 else 0)))
        c.rect(sx - 2, GROUND_Y - 15, 5, 2, BURLAP[0])
        c.rect(sx - 1, GROUND_Y - 17, 3, 2, GRAIN[2])
        for i in range(sx - 4, sx + 5, 2):
            c.set(i, GROUND_Y - 6, BURLAP[0])
    # scale on the counter
    c.rect(cx + 18, y0 - 12, 1, 9, (60, 50, 40))
    c.rect(cx + 10, y0 - 12, 17, 1, (60, 50, 40))
    for sx in (cx + 11, cx + 25):
        c.ellipse(sx, y0 - 6, 4, 1.5, lambda i, j, d: GOLD[2] if d < .5 else GOLD[1])
        c.line(sx - 3, y0 - 6, sx, y0 - 11, (90, 76, 60))
        c.line(sx + 3, y0 - 6, sx, y0 - 11, (90, 76, 60))
    # coin stack
    for k in range(4):
        c.ellipse(cx - 26, y0 - 2 - k * 2, 4, 1.6, lambda i, j, d: GOLD[3] if d < .4 else GOLD[1])
    # ledger book
    c.fill(cx - 12, y0 - 4, 14, 3, lambda i, j: CLOTH_CREAM[3] if j < y0 - 2 else CLOTH_RED[1])
    c.outline()


def crates(c, rng, xs):
    for x in xs:
        s = rng.choice((12, 14))
        c.fill(x, GROUND_Y - s, s, s, lambda i, j, x=x, s=s: ramp(WOOD, 0.8 - (i - x) / s * 0.4 - (0.25 if (i - x) in (0, s - 1) or (j - GROUND_Y + s) in (0, s - 1) or (i - x) == (j - GROUND_Y + s) else 0), i, j))


def build(theme_idx, out):
    th = THEMES[theme_idx]
    rng = random.Random(th['seed'])
    back = Canvas(W, H, th['seed'])
    sky(back)
    clouds(back, rng)
    hills(back, rng, HILL_FAR, 74, 7, 0.031, th['seed'])
    if th['name'] == 'port':
        harbor(back, 250, 86, rng)
    hills(back, rng, HILL_NEAR, 92, 5, 0.05, th['seed'] * 2)
    if th['name'] == 'mill':
        fields(back, rng)
    # town row behind the square
    row = Canvas(W, H, th['seed'])
    xs = [6, 40, 230, 268] if th['name'] != 'port' else [6, 42, 200]
    for i, x in enumerate(xs):
        w = rng.choice((24, 28, 32))
        h = rng.choice((22, 26, 30))
        house(row, x, GROUND_Y - h, w, h, [th['roof'], ROOF_RED, ROOF_SLATE][(i + theme_idx) % 3], rng)
    if th['name'] == 'mill':
        windmill(row, 292, GROUND_Y - 58, 0.35)
    if th['name'] == 'gate':
        gatehouse(row, 298, GROUND_Y - 40)
    row.outline()
    back.blit(row, 0, 0)
    street(back, rng)
    crates(back, rng, [74, 214])
    for lx in (96, 222):
        lamp(back, lx)
    shadow(back, 160, GROUND_Y + 2, 60, 4)
    for sx in (80, 220):
        shadow(back, sx, GROUND_Y + 1, 9, 2)
    stall = Canvas(W, H)
    stall_back(stall, 160, th)
    stall.outline()
    back.blit(stall, 0, 0)
    front = Canvas(W, H)
    stall_front(front, 160)
    back.save(f'{out}/town{theme_idx}-back.png')
    front.save(f'{out}/town{theme_idx}-front.png')
    comp = Canvas(W, H)
    comp.blit(back, 0, 0)
    comp.blit(front, 0, 0)
    return comp


if __name__ == '__main__':
    out = sys.argv[1]
    for i in range(3):
        build(i, out).save(f'{out}/town{i}-preview.png', scale=4)
