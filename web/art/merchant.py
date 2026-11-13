"""Three merchants. One parametric figure in a 40x48 unit box, drawn at scale s.
Frames: idle0, idle1 (breath), blink, talk0, talk1, pleased, stern."""
import sys
from kit import *

MERCHANTS = [
    # Millford: grain seller, red headscarf, green apron, warm and shrewd
    dict(skin=SKIN, hair=HAIR_BROWN, coat=CLOTH_GREEN, trim=CLOTH_CREAM, hat='scarf', hatpal=CLOTH_RED,
         beard=False, brows=-1, earring=False, cheeks=True),
    # Pellgate: old toll-keeper, grey beard, slate cap, stern
    dict(skin=SKIN, hair=HAIR_GREY, coat=CLOTH_TEAL, trim=GOLD, hat='cap', hatpal=ROOF_SLATE,
         beard=True, brows=1, earring=False, cheeks=False),
    # Port town: sea trader, blue coat, gold hoop, tricorn
    dict(skin=SKIN_DARK, hair=HAIR_BROWN, coat=CLOTH_BLUE, trim=GOLD, hat='tricorn', hatpal=WOOD,
         beard=False, brows=0, earring=True, cheeks=False),
]

FRAMES = ['idle0', 'idle1', 'blink', 'talk0', 'talk1', 'pleased', 'stern']


def draw(spec, frame, s=1):
    W, H = 40 * s, 48 * s
    c = Canvas(W, H)
    b = 1 if frame == 'idle1' else 0          # breath: shoulders up 1 unit
    hx, hy = 20, 18 - b * 0.5                  # head centre

    def E(cx, cy, rx, ry, fn):
        c.ellipse(cx * s, cy * s, rx * s, ry * s, fn)

    def R(x, y, w, h, col):
        c.rect(x * s, y * s, max(1, w * s), max(1, h * s), col)

    def P(pts, fn):
        c.poly([(x * s, y * s) for x, y in pts], fn)

    # body: coat torso, shoulders
    coat = spec['coat']
    P([(4, 48), (6, 34 - b), (12, 29 - b), (28, 29 - b), (34, 34 - b), (36, 48)],
      lambda x, y: ramp(coat, 0.85 - (x / s - 4) / 32 * 0.7 + (0.1 if y / s < 33 else 0)))
    # lapels / apron
    if spec['hat'] == 'scarf':
        P([(13, 34), (27, 34), (28, 48), (12, 48)], lambda x, y: ramp(CLOTH_CREAM, 0.9 - (x / s - 12) / 16 * 0.5))
        R(13, 36, 14, 1, CLOTH_CREAM[0])
    else:
        P([(15, 29 - b), (20, 40), (25, 29 - b)], lambda x, y: ramp(CLOTH_CREAM, 0.95 - (x / s - 15) / 10 * 0.5))
        for k in range(3):
            E(20, 41 + k * 2.5, 0.8, 0.8, lambda x, y, d: spec['trim'][3])
        R(6, 35 - b, 1, 13, spec['trim'][2])
        R(33, 35 - b, 1, 13, spec['trim'][1])
    # neck
    R(17, 25 - b, 6, 5, spec['skin'][1])
    # hair behind head
    if spec['hat'] != 'cap':
        E(hx, hy + 1, 9.5, 10, lambda x, y, d: ramp(spec['hair'], 0.5 - (x / s - hx) / 20))
    # head
    sk = spec['skin']
    E(hx, hy, 8.5, 9.5, lambda x, y, d: ramp(sk, sphere_t(x, y, hx * s, hy * s, 8.5 * s, 9.5 * s) * 1.1))
    # ears
    E(hx - 8.5, hy + 1, 1.5, 2.2, lambda x, y, d: sk[2])
    E(hx + 8.5, hy + 1, 1.5, 2.2, lambda x, y, d: sk[1])
    if spec['earring']:
        E(hx - 8.8, hy + 4.2, 1.2, 1.2, lambda x, y, d: GOLD[3] if d < 0.45 else GOLD[2])
    # eyes
    ey = hy + 0.5
    for ex in (hx - 3.5, hx + 3.5):
        if frame == 'blink':
            R(ex - 1.5, ey + 0.5, 3, 0.6, INK)
        elif frame == 'pleased':
            R(ex - 1.5, ey, 1, 0.6, INK); R(ex - 0.5, ey - 0.6, 1, 0.6, INK); R(ex + 0.5, ey, 1, 0.6, INK)
        else:
            R(ex - 1.2, ey - 0.8, 2.4, 2, (246, 240, 228))
            R(ex - 0.4 + (0.3 if ex > hx else 0), ey - 0.6, 1.2, 1.8, INK)
    # brows
    bt = spec['brows'] + (1.5 if frame == 'stern' else 0) - (1 if frame == 'pleased' else 0)
    browcol = spec['hair'][0]
    for side in (-1, 1):
        ex = hx + side * 3.5
        for k in range(4):
            xx = ex - 2 + k
            tilt = (k - 1.5) * 0.35 * bt * (-side)
            R(xx, ey - 2.8 + tilt, 1, 0.8, browcol)
    # nose
    R(hx - 0.5, hy + 2, 1.4, 2.4, sk[0] if spec['skin'] is SKIN_DARK else sk[1])
    R(hx + 0.6, hy + 2.6, 0.6, 1.6, sk[3])
    # cheeks
    if spec['cheeks']:
        for cx_ in (hx - 5, hx + 5):
            E(cx_, hy + 3.5, 1.6, 0.9, lambda x, y, d: (214, 120, 100))
    # beard
    if spec['beard']:
        P([(hx - 8, hy + 1), (hx + 8, hy + 1), (hx + 6, hy + 9), (hx, hy + 12), (hx - 6, hy + 9)],
          lambda x, y: ramp(spec['hair'], 0.85 - (x / s - hx + 8) / 16 * 0.6 + (0.1 if (x + y) % 3 == 0 else 0)))
    # mouth
    my = hy + 5.6
    if frame in ('talk0',):
        R(hx - 1.5, my - 0.3, 3, 1.6, (70, 24, 28)); R(hx - 1, my + 0.7, 2, 0.6, (190, 90, 90))
    elif frame == 'talk1':
        R(hx - 1.2, my, 2.4, 0.8, (70, 24, 28))
    elif frame == 'pleased':
        R(hx - 2.5, my - 0.4, 1, 0.7, INK); R(hx - 1.5, my + 0.2, 3, 0.8, INK); R(hx + 1.5, my - 0.4, 1, 0.7, INK)
    elif frame == 'stern':
        R(hx - 2, my + 0.3, 4, 0.7, INK)
    else:
        R(hx - 1.6, my + 0.2, 3.2, 0.7, sk[0] if not spec['beard'] else INK)
    # headwear
    hp = spec['hatpal']
    if spec['hat'] == 'scarf':
        P([(hx - 10, hy - 1), (hx - 8, hy - 8), (hx - 3, hy - 11), (hx + 4, hy - 11), (hx + 9, hy - 7), (hx + 10, hy - 1), (hx + 7, hy - 4), (hx - 7, hy - 4)],
          lambda x, y: ramp(hp, 0.95 - (x / s - hx + 10) / 20 * 0.6))
        for k in range(5):
            E(hx - 6 + k * 3, hy - 6.5, 0.6, 0.6, lambda x, y, d: CLOTH_CREAM[3])
        P([(hx + 8, hy - 3), (hx + 13, hy + 4), (hx + 10, hy + 5), (hx + 8, hy + 1)], lambda x, y: hp[1])
    elif spec['hat'] == 'cap':
        P([(hx - 9, hy - 3), (hx - 7, hy - 10), (hx, hy - 12), (hx + 7, hy - 10), (hx + 9, hy - 3)],
          lambda x, y: ramp(hp, 0.9 - (x / s - hx + 9) / 18 * 0.6))
        R(hx - 10, hy - 4, 20, 1.6, hp[0])
        E(hx - 4, hy - 9, 1.2, 1.2, lambda x, y, d: spec['trim'][3])
        # grey hair tufts under cap
        R(hx - 9, hy - 2, 2, 4, spec['hair'][1]); R(hx + 7, hy - 2, 2, 4, spec['hair'][0])
    elif spec['hat'] == 'tricorn':
        P([(hx - 13, hy - 4), (hx - 6, hy - 13), (hx, hy - 11), (hx + 6, hy - 13), (hx + 13, hy - 4), (hx, hy - 6)],
          lambda x, y: ramp(hp, 0.75 - (x / s - hx + 13) / 26 * 0.55))
        R(hx - 12, hy - 5, 24, 1, GOLD[2])
    c.outline()
    return c


def strip(spec, s):
    frames = [draw(spec, f, s) for f in FRAMES]
    w, h = frames[0].w, frames[0].h
    out = Canvas(w * len(frames), h)
    for i, f in enumerate(frames):
        out.blit(f, i * w, 0)
    return out


if __name__ == '__main__':
    out = sys.argv[1]
    for i, m in enumerate(MERCHANTS):
        strip(m, 1).save(f'{out}/merchant{i}.png')          # 40x48 per frame, in-scene
        strip(m, 3).save(f'{out}/portrait{i}.png')          # 120x144 per frame, dialogue
        strip(m, 3).save(f'{out}/portrait{i}-x2.png', scale=2)
