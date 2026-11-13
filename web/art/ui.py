"""UI art: 9-slice panel and buttons, 16px icons, verdict stamps, coin spin, road map."""
import math
import sys
from kit import *

NAVY = [(18, 20, 34), (29, 34, 56), (40, 47, 76), (58, 68, 104)]
GREEN = [(30, 70, 40), (52, 116, 60), (86, 170, 90), (150, 214, 130)]
RED = [(84, 22, 26), (140, 36, 38), (200, 64, 56), (240, 120, 96)]
SLATE = [(46, 50, 64), (78, 84, 104), (120, 128, 150), (176, 182, 198)]


def panel(out):
    """24x24 9-slice: dark navy fill, gold bevel trim, studs in the corners (slice 8)."""
    c = Canvas(24, 24)
    c.rect(1, 1, 22, 22, NAVY[1])
    c.rect(0, 2, 24, 20, INK); c.rect(2, 0, 20, 24, INK); c.rect(1, 1, 22, 22, INK)
    c.rect(2, 2, 20, 20, GOLD[1])
    c.rect(2, 2, 20, 1, GOLD[3]); c.rect(2, 2, 1, 20, GOLD[3])
    c.rect(3, 3, 18, 18, GOLD[0])
    c.rect(4, 4, 16, 16, NAVY[1])
    c.rect(4, 4, 16, 1, NAVY[3]); c.rect(4, 4, 1, 16, NAVY[2])
    for x, y in ((2, 2), (20, 2), (2, 20), (20, 20)):
        c.rect(x, y, 2, 2, GOLD[4]); c.set(x + 1, y + 1, GOLD[2])
    c.save(f'{out}/panel.png')
    # inset well for inputs
    w = Canvas(12, 12)
    w.rect(0, 0, 12, 12, INK); w.rect(1, 1, 10, 10, NAVY[0]); w.rect(1, 1, 10, 1, (10, 10, 18)); w.rect(1, 10, 10, 1, NAVY[2])
    w.save(f'{out}/well.png')


def button(out, name, pal):
    """16x16 9-slice (slice 6) buttons: up and down states."""
    for state in ('up', 'down'):
        c = Canvas(16, 16)
        c.rect(1, 0, 14, 16, INK); c.rect(0, 1, 16, 14, INK)
        if state == 'up':
            c.rect(1, 1, 14, 12, pal[2]); c.rect(1, 13, 14, 2, pal[0])
            c.rect(2, 1, 12, 1, pal[3]); c.rect(1, 2, 1, 10, pal[3])
        else:
            c.rect(1, 3, 14, 12, pal[1]); c.rect(1, 1, 14, 2, INK)
            c.rect(2, 3, 12, 1, pal[2])
        c.save(f'{out}/btn-{name}-{state}.png')


def icons(out):
    """16x16 icons in one strip: coin, sun, lock, star, scroll, sack, news, road, moon, hourglass."""
    names = ['coin', 'sun', 'lock', 'star', 'scroll', 'sack', 'news', 'road', 'moon', 'hourglass']
    strip = Canvas(16 * len(names), 16)
    for k, n in enumerate(names):
        c = Canvas(16, 16)
        if n == 'coin':
            c.ellipse(8, 8, 6, 6, lambda x, y, d: ramp(GOLD, sphere_t(x, y, 8, 8, 6, 6) + 0.1))
            c.rect(7, 5, 2, 6, GOLD[1]); c.rect(6, 5, 1, 1, GOLD[1]); c.set(7, 4, GOLD[4])
        elif n == 'sun':
            for a in range(8):
                t = a * math.pi / 4
                c.line(8 + math.cos(t) * 5, 8 + math.sin(t) * 5, 8 + math.cos(t) * 7, 8 + math.sin(t) * 7, GOLD[3])
            c.ellipse(8, 8, 4, 4, lambda x, y, d: ramp(GOLD, 1 - d * 0.5))
        elif n == 'moon':
            c.ellipse(8, 8, 6, 6, lambda x, y, d: CLOTH_CREAM[2])
            for y in range(16):
                for x in range(16):
                    if ((x - 11) ** 2 + (y - 6) ** 2) <= 25:
                        c.px[x, y] = CLEAR
        elif n == 'lock':
            c.rect(5, 2, 6, 2, SLATE[2]); c.rect(4, 3, 2, 5, SLATE[2]); c.rect(10, 3, 2, 5, SLATE[1])
            c.rect(3, 7, 10, 8, GOLD[2]); c.rect(3, 7, 10, 1, GOLD[4]); c.rect(3, 14, 10, 1, GOLD[0])
            c.rect(7, 9, 2, 3, INK)
        elif n == 'star':
            pts = []
            for a in range(10):
                r = 7 if a % 2 == 0 else 3
                t = -math.pi / 2 + a * math.pi / 5
                pts.append((8 + math.cos(t) * r, 8.5 + math.sin(t) * r))
            c.poly(pts, lambda x, y: GOLD[4] if x < 8 and y < 8 else GOLD[2])
        elif n == 'scroll':
            c.rect(4, 3, 9, 10, CLOTH_CREAM[2]); c.rect(3, 2, 11, 2, CLOTH_CREAM[1]); c.rect(3, 12, 11, 2, CLOTH_CREAM[1])
            for y in (6, 8, 10):
                c.rect(5, y, 7, 1, SLATE[1])
        elif n == 'sack':
            c.poly([(3, 15), (4, 7), (6, 4), (10, 4), (12, 7), (13, 15)], lambda x, y: ramp(GRAIN, sphere_t(x, y, 8, 10, 6, 6)))
            c.rect(6, 2, 4, 2, GRAIN[0])
        elif n == 'news':
            c.rect(2, 3, 12, 10, WOOD[2]); c.rect(3, 4, 10, 8, CLOTH_CREAM[2])
            c.rect(4, 5, 4, 3, RED[2]); c.rect(9, 6, 3, 1, SLATE[1]); c.rect(9, 8, 3, 1, SLATE[1]); c.rect(4, 9, 8, 1, SLATE[1])
        elif n == 'road':
            c.poly([(6, 1), (10, 1), (14, 15), (2, 15)], lambda x, y: DIRT[3])
            for y in (3, 7, 11):
                c.rect(7, y, 2, 2, CLOTH_CREAM[3])
        elif n == 'hourglass':
            c.rect(3, 1, 10, 2, WOOD[2]); c.rect(3, 13, 10, 2, WOOD[2])
            c.poly([(4, 3), (12, 3), (8, 8)], lambda x, y: (140, 180, 200))
            c.poly([(8, 8), (12, 13), (4, 13)], lambda x, y: (140, 180, 200))
            c.poly([(6, 4), (10, 4), (8, 7)], lambda x, y: GRAIN[2]); c.rect(5, 11, 6, 2, GRAIN[2])
        c.outline()
        strip.blit(c, k * 16, 0)
    strip.save(f'{out}/icons.png')
    return names


def stamps(out):
    """64x64 verdict stamps: advanced (green seal), refused (red X), timed out (slate hourglass ring)."""
    specs = [('committed', GREEN), ('refused', RED), ('timed_out', SLATE)]
    strip = Canvas(64 * 3, 64)
    for k, (name, pal) in enumerate(specs):
        c = Canvas(64, 64, seed=k)
        rng = c.rng
        # wax blob with ragged rim
        for y in range(64):
            for x in range(64):
                a = math.atan2(y - 32, x - 32)
                r = 27 + 2 * math.sin(a * 7 + k) + rng.random() * 1.2
                d = math.hypot(x - 32, y - 32)
                if d < r:
                    c.set(x, y, ramp(pal, sphere_t(x, y, 32, 32, r, r) * 0.9 + 0.05))
        c.ellipse(32, 32, 20, 20, lambda x, y, d: pal[0] if 0.82 < d < 1 else None)
        if name == 'committed':
            for i in range(-2, 3):
                c.line(21, 32 + i, 28, 40 + i, pal[3]); c.line(28, 40 + i, 43, 23 + i, pal[3])
        elif name == 'refused':
            for i in range(-2, 3):
                c.line(23 + i, 23, 41 + i, 41, pal[3]); c.line(41 + i, 23, 23 + i, 41, pal[3])
        else:
            c.rect(25, 21, 14, 3, pal[3]); c.rect(25, 40, 14, 3, pal[3])
            c.poly([(27, 24), (37, 24), (32, 32)], pal[3]); c.poly([(32, 32), (37, 40), (27, 40)], pal[3])
        c.outline()
        strip.blit(c, k * 64, 0)
    strip.save(f'{out}/stamps.png')


def coin_spin(out):
    """8 frames, 12x12: a gold coin turning."""
    strip = Canvas(12 * 8, 12)
    for f in range(8):
        c = Canvas(12, 12)
        w = abs(math.cos(f / 8 * math.pi)) * 5 + 0.6
        c.ellipse(6, 6, w, 5, lambda x, y, d: ramp(GOLD, sphere_t(x, y, 6, 6, w, 5) + 0.15))
        if w > 2.5:
            c.rect(6, 4, 1, 4, GOLD[1])
        c.outline()
        strip.blit(c, f * 12, 0)
    strip.save(f'{out}/coin.png')


def road_map(out):
    """320x64 strip: a dirt road winding across fields between three town plots, at 1/5, 1/2, 4/5."""
    W, H = 320, 64
    c = Canvas(W, H, seed=5)
    c.fill(0, 0, W, H, lambda x, y: ramp(GRASS, 0.45 + 0.25 * math.sin(x * 0.07 + y * 0.11) * math.sin(y * 0.3) + (0.15 if (x * 7 + y * 13) % 29 == 0 else 0)))
    # river crossing between town 2 and 3
    for y in range(H):
        rx = 228 + math.sin(y * 0.12) * 6
        for x in range(int(rx), int(rx) + 9):
            c.set(x, y, ramp(WATER, 0.4 + (0.4 if (x + y) % 7 == 0 else 0)))
    road_y = lambda x: 34 + math.sin(x * 0.028) * 9
    for x in range(W):
        y0 = road_y(x)
        for y in range(int(y0 - 4), int(y0 + 5)):
            edge = abs(y - y0) > 3
            c.set(x, y, DIRT[1] if edge else ramp(DIRT, 0.6 + (0.15 if (x // 3 + y) % 5 == 0 else 0)))
    # bridge
    for x in range(224, 242):
        y0 = road_y(x)
        c.rect(x, int(y0 - 5), 1, 11, WOOD[2] if x % 3 else WOOD[0])
    # trees
    rng = c.rng
    for _ in range(46):
        x, y = rng.randint(0, W), rng.randint(2, H - 4)
        if abs(y - road_y(x)) < 9 or any(abs(x - tx) < 26 for tx in (64, 160, 256)) or 222 < x < 244:
            continue
        c.ellipse(x, y + 4, 4, 1.5, lambda i, j, d: GRASS[0])
        c.ellipse(x, y, 4, 4, lambda i, j, d: ramp(HILL_NEAR, sphere_t(i, j, x, y, 4, 4)))
    # town plots (cobble circles), the client draws markers on top
    for tx in (64, 160, 256):
        ty = road_y(tx)
        c.ellipse(tx, ty, 22, 13, lambda i, j, d: ramp(COBBLE_MAP, 0.7 - d * 0.4 + (0.1 if (i + j) % 4 == 0 else 0)))
    c.save(f'{out}/roadmap.png')
    with open(f'{out}/roadmap.json', 'w') as f:
        f.write('{"towns":[%s]}' % ','.join('{"x":%d,"y":%d}' % (tx, round(road_y(tx))) for tx in (64, 160, 256)))


COBBLE_MAP = [(84, 78, 84), (120, 110, 108), (156, 144, 134), (190, 178, 162)]


def town_badges(out):
    """48x40 town tokens for the road map, one per theme: mill, gate, port."""
    from town import house, windmill, gatehouse
    strip = Canvas(56 * 3, 52)
    for k in range(3):
        c = Canvas(56, 52, seed=k)
        rng = c.rng
        if k == 0:
            house(c, 4, 34, 18, 14, ROOF_RED, rng)
            windmill(c, 38, 24, 0.4)
        elif k == 1:
            gatehouse(c, 28, 12)
        else:
            house(c, 2, 36, 16, 12, ROOF_TEAL, rng)
            house(c, 20, 32, 20, 16, ROOF_SLATE, rng)
            c.rect(46, 18, 1, 30, WOOD[0]); c.poly([(47, 19), (53, 32), (47, 32)], CLOTH_CREAM[2])
        c.outline()
        strip.blit(c, k * 56, 0)
    strip.save(f'{out}/towns.png')


if __name__ == '__main__':
    out = sys.argv[1]
    panel(out)
    button(out, 'gold', GOLD[1:])
    button(out, 'green', GREEN)
    button(out, 'navy', NAVY)
    print(icons(out))
    stamps(out)
    coin_spin(out)
    road_map(out)
    town_badges(out)
