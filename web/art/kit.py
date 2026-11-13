"""Long Con pixel kit: palette ramps and a small RGBA canvas with shading, dithering and outlines."""
import math
import random
from PIL import Image

CLEAR = (0, 0, 0, 0)
INK = (28, 22, 30)

# Golden-hour road. Each ramp runs dark -> light.
SKY = [(38, 62, 104), (62, 98, 140), (110, 146, 170), (232, 168, 112), (250, 206, 140)]
HILL_FAR = [(70, 96, 116), (88, 116, 128), (112, 138, 140)]
HILL_NEAR = [(46, 82, 62), (64, 108, 70), (92, 136, 78), (128, 164, 92)]
GRASS = [(40, 74, 50), (58, 100, 58), (84, 128, 64), (122, 158, 74), (168, 186, 92)]
DIRT = [(74, 48, 38), (104, 70, 48), (136, 96, 62), (168, 126, 82), (198, 160, 110)]
COBBLE = [(58, 54, 62), (84, 78, 84), (112, 104, 106), (142, 132, 128), (176, 166, 156)]
WOOD = [(56, 34, 28), (86, 54, 38), (120, 78, 50), (154, 106, 66), (186, 138, 88)]
PLASTER = [(120, 92, 82), (168, 128, 104), (204, 168, 136), (226, 198, 164)]
ROOF_RED = [(86, 32, 32), (128, 48, 40), (168, 70, 50), (200, 100, 66)]
ROOF_TEAL = [(28, 62, 72), (40, 88, 96), (58, 118, 120), (90, 150, 146)]
ROOF_SLATE = [(44, 46, 62), (62, 66, 86), (84, 90, 112), (112, 120, 140)]
STONE = [(62, 60, 70), (88, 86, 94), (118, 114, 118), (150, 146, 146), (186, 182, 176)]
GOLD = [(118, 72, 20), (170, 110, 26), (222, 160, 40), (250, 204, 76), (255, 238, 160)]
CLOTH_RED = [(96, 26, 34), (146, 40, 44), (192, 62, 56), (226, 104, 82)]
CLOTH_CREAM = [(150, 132, 112), (196, 180, 156), (232, 222, 200), (248, 242, 228)]
CLOTH_TEAL = [(22, 70, 78), (32, 102, 108), (52, 138, 138), (96, 176, 166)]
CLOTH_GREEN = [(38, 70, 44), (56, 100, 56), (82, 132, 70), (120, 164, 90)]
CLOTH_BLUE = [(34, 50, 92), (48, 74, 128), (70, 104, 160), (110, 142, 190)]
SKIN = [(118, 70, 54), (168, 108, 80), (212, 150, 112), (236, 190, 150)]
SKIN_DARK = [(70, 42, 34), (104, 66, 48), (140, 92, 64), (172, 122, 86)]
HAIR_BROWN = [(46, 28, 24), (78, 48, 34), (112, 72, 46)]
HAIR_GREY = [(86, 84, 90), (128, 126, 130), (176, 174, 176)]
HAIR_RED = [(90, 34, 24), (140, 58, 34), (186, 92, 50)]
GRAIN = [(150, 110, 50), (196, 152, 72), (226, 190, 104), (246, 220, 150)]
WATER = [(30, 60, 90), (44, 88, 118), (70, 124, 146), (130, 176, 186)]
LAMP = [(255, 196, 96), (255, 226, 150), (255, 248, 210)]

BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def rgba(c, a=255):
    return (c[0], c[1], c[2], a)


def ramp(pal, t, x=0, y=0, dither=False):
    """Pick a ramp color for t in [0,1], ordered-dithered between neighbours."""
    t = min(max(t, 0.0), 0.9999) * (len(pal) - 1)
    i = int(t)
    f = t - i
    if dither and i + 1 < len(pal):
        if 0.3 < f < 0.7:
            i += 1 if (f - 0.3) / 0.4 > (BAYER4[y % 4][x % 4] + 0.5) / 16 else 0
        elif f >= 0.7:
            i += 1
    elif not dither and f > 0.5 and i + 1 < len(pal):
        i += 1
    return pal[i]


class Canvas:
    def __init__(self, w, h, seed=7):
        self.w, self.h = w, h
        self.img = Image.new('RGBA', (w, h), CLEAR)
        self.px = self.img.load()
        self.rng = random.Random(seed)

    def set(self, x, y, col, a=255):
        x, y = int(x), int(y)
        if not (0 <= x < self.w and 0 <= y < self.h) or a <= 0:
            return
        if a >= 255:
            self.px[x, y] = rgba(col)
            return
        b = self.px[x, y]
        k = a / 255
        self.px[x, y] = (int(b[0] * (1 - k) + col[0] * k), int(b[1] * (1 - k) + col[1] * k),
                         int(b[2] * (1 - k) + col[2] * k), max(b[3], a))

    def get(self, x, y):
        return self.px[x, y] if 0 <= x < self.w and 0 <= y < self.h else CLEAR

    def rect(self, x, y, w, h, col, a=255):
        for j in range(int(y), int(y + h)):
            for i in range(int(x), int(x + w)):
                self.set(i, j, col, a)

    def fill(self, x, y, w, h, fn):
        for j in range(int(y), int(y + h)):
            for i in range(int(x), int(x + w)):
                c = fn(i, j)
                if c is not None:
                    self.set(i, j, c)

    def ellipse(self, cx, cy, rx, ry, fn):
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                d = ((x + 0.5 - cx) / max(rx, .01)) ** 2 + ((y + 0.5 - cy) / max(ry, .01)) ** 2
                if d <= 1:
                    c = fn(x, y, d) if callable(fn) else fn
                    if c is not None:
                        self.set(x, y, c)

    def poly(self, pts, fn):
        ys = [p[1] for p in pts]
        xs = [p[0] for p in pts]
        for y in range(int(min(ys)), int(max(ys)) + 1):
            for x in range(int(min(xs)), int(max(xs)) + 1):
                if inside(pts, x + .5, y + .5):
                    c = fn(x, y) if callable(fn) else fn
                    if c is not None:
                        self.set(x, y, c)

    def line(self, x0, y0, x1, y1, col, a=255):
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for k in range(n + 1):
            t = k / n
            self.set(round(x0 + (x1 - x0) * t), round(y0 + (y1 - y0) * t), col, a)

    def outline(self, col=INK):
        """1px outline around every opaque region, drawn on transparent neighbours."""
        src = self.img.copy().load()
        for y in range(self.h):
            for x in range(self.w):
                if src[x, y][3] == 0:
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < self.w and 0 <= ny < self.h and src[nx, ny][3] > 0:
                            self.px[x, y] = rgba(col)
                            break

    def blit(self, other, ox, oy):
        self.img.alpha_composite(other.img if isinstance(other, Canvas) else other, (int(ox), int(oy)))
        self.px = self.img.load()

    def save(self, path, scale=1):
        im = self.img if scale == 1 else self.img.resize((self.w * scale, self.h * scale), Image.NEAREST)
        im.save(path)


def inside(pts, x, y):
    n, j, res = len(pts), len(pts) - 1, False
    for i in range(n):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi:
            res = not res
        j = i
    return res


def sphere_t(x, y, cx, cy, rx, ry, light=(-0.6, -0.7)):
    """Lambert-ish shade in [0,1] for a point on an ellipse lit from the upper left."""
    nx, ny = (x + .5 - cx) / max(rx, .01), (y + .5 - cy) / max(ry, .01)
    nz = math.sqrt(max(0.0, 1 - nx * nx - ny * ny))
    l = (-light[0] * -1, -light[1] * -1)
    d = -(nx * light[0] + ny * light[1]) * 0.9 + nz * 0.55
    return min(max(d * 0.75 + 0.2, 0), 1)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def smooth_ramp(stops, n):
    """Expand a few color stops into an n-step ramp."""
    out = []
    for k in range(n):
        t = k / (n - 1) * (len(stops) - 1)
        i = min(int(t), len(stops) - 2)
        out.append(lerp(stops[i], stops[i + 1], t - i))
    return out


def shadow(c, cx, cy, rx, ry, a=90):
    for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
            d = ((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2
            if d < 1:
                c.set(x, y, (24, 20, 34), int(a * (1 - d * 0.5)))
