"""Screenshots one URL at phone and desktop widths through the shared `deepsurge` browser profile.

Run it through the harness (scripts/shoot.sh does): it owns one new tab for its whole life and closes it.
Env: SHOOT_URL, SHOOT_OUT (file prefix), SHOOT_READY (JS predicate that must turn true), SHOOT_WIDTHS (default 390,1440),
SHOOT_HEIGHT_390 / SHOOT_HEIGHT_1440 (viewport heights for the above-the-fold shot).
Writes <prefix>-<width>-fold.png (the first screen) and <prefix>-<width>-full.png (the whole page).
"""
import base64, os, time

url = os.environ["SHOOT_URL"]
out = os.environ["SHOOT_OUT"]
ready = os.environ.get("SHOOT_READY", "document.readyState==='complete'")
widths = [int(w) for w in os.environ.get("SHOOT_WIDTHS", "390,1440").split(",")]
heights = {390: int(os.environ.get("SHOOT_HEIGHT_390", "844")), 1440: int(os.environ.get("SHOOT_HEIGHT_1440", "900"))}

tid = cdp("Target.createTarget", url="about:blank", background=True)["targetId"]
sid = attach_tab(tid)


def ev(expr):
    r = cdp("Runtime.evaluate", session_id=sid, expression=expr, returnByValue=True, awaitPromise=True)
    return r.get("result", {}).get("value")


def save(path, full):
    r = cdp("Page.captureScreenshot", session_id=sid, format="png", captureBeyondViewport=full)
    open(path, "wb").write(base64.b64decode(r["data"]))
    return path


try:
    cdp("Page.enable", session_id=sid)
    cdp("Emulation.setDeviceMetricsOverride", session_id=sid, width=widths[0], height=heights.get(widths[0], 900), deviceScaleFactor=2, mobile=widths[0] < 700)
    cdp("Page.navigate", session_id=sid, url=url)
    for w in widths:
        h = heights.get(w, 900)
        cdp("Emulation.setDeviceMetricsOverride", session_id=sid, width=w, height=h, deviceScaleFactor=2, mobile=w < 700)
        end = time.time() + 120
        while ev(f"!!({ready})") is not True:
            if time.time() > end:
                raise SystemExit(f"timeout waiting for: {ready}")
            time.sleep(1)
        time.sleep(1.2)
        overflow = ev("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        print(f"{w}px: horizontal overflow {overflow}px, page height {ev('document.documentElement.scrollHeight')}px")
        print(save(f"{out}-{w}-fold.png", False))
        print(save(f"{out}-{w}-full.png", True))
finally:
    try:
        cdp("Emulation.clearDeviceMetricsOverride", session_id=sid)
    finally:
        cdp("Target.closeTarget", targetId=tid)
