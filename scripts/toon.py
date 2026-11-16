# Regenerate assets/avatar.png:  python scripts/toon.py <your-photo> <skin-reference-photo> assets/avatar.png  (needs opencv-python, numpy)
# Cel-shaded cartoon cutout v2: anime-style tone bands on the skin (colour matched to a reference
# photo), finer facial ink, and a shaded jawline.
# usage: python toon2.py <portrait> <skin-reference> <out.png>
import sys
import cv2
import numpy as np

src, refp, out = sys.argv[1:4]
img = cv2.imread(src, cv2.IMREAD_COLOR)
h0, w0 = img.shape[:2]
img = cv2.resize(img, (int(w0 * 900 / h0), 900), interpolation=cv2.INTER_AREA)
h, w = img.shape[:2]

# ---------------------------------------------------------------- cut-out mask
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
whiteish = ((hsv[..., 2] > 215) & (hsv[..., 1] < 40)).astype(np.uint8) * 255
ffmask = np.zeros((h + 2, w + 2), np.uint8)
for x in range(0, w, 7):
    if whiteish[0, x] == 255:
        cv2.floodFill(whiteish, ffmask, (x, 0), 128)
for y in range(0, int(h * 0.75), 7):
    for x in (0, w - 1):
        if whiteish[y, x] == 255:
            cv2.floodFill(whiteish, ffmask, (x, y), 128)
fg = (whiteish != 128).astype(np.uint8)
fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
n, lab, stats, _ = cv2.connectedComponentsWithStats(fg)
fg = (lab == 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])).astype(np.uint8)
for y in range(h):
    xs = np.where(fg[y])[0]
    if len(xs):
        fg[y, xs.min():xs.max() + 1] = 1

# ---------------------------------------------------------------- base toon (hair, suit, shirt)
smooth = cv2.edgePreservingFilter(img, flags=1, sigma_s=80, sigma_r=0.35)
for _ in range(3):
    smooth = cv2.bilateralFilter(smooth, 9, 45, 9)
Z = smooth.reshape(-1, 3).astype(np.float32)
crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
_, labels, centers = cv2.kmeans(Z, 10, None, crit, 3, cv2.KMEANS_PP_CENTERS)
toon = cv2.medianBlur(centers[labels.flatten()].reshape(img.shape).astype(np.uint8), 7)

# ---------------------------------------------------------------- skin: mask + reference colour
def skin_mask(im):
    ycc = cv2.cvtColor(im, cv2.COLOR_BGR2YCrCb)
    return (ycc[..., 1] > 133) & (ycc[..., 1] < 182) & (ycc[..., 2] > 80) & (ycc[..., 2] < 132) & (ycc[..., 0] > 70)

skin = skin_mask(smooth) & (fg > 0) & (cv2.cvtColor(smooth, cv2.COLOR_BGR2GRAY) > 112)
skin[int(h * 0.70):] = False                          # nothing below the collar opening is face
skin8 = cv2.morphologyEx(skin.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
skin8 = cv2.morphologyEx(skin8, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
skin = skin8 > 0

ref = cv2.imread(refp, cv2.IMREAD_COLOR)
rh, rw = ref.shape[:2]
patches = [(0.36, 0.40), (0.63, 0.40), (0.50, 0.25), (0.50, 0.36)]  # cheeks, forehead, nose bridge
samp = np.concatenate([ref[int(py * rh) - 8:int(py * rh) + 8, int(px * rw) - 8:int(px * rw) + 8].reshape(-1, 3) for px, py in patches])
ref_lab = cv2.cvtColor(samp.reshape(-1, 1, 3), cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)
src_lab = cv2.cvtColor(smooth, cv2.COLOR_BGR2LAB).astype(np.float32)
s_px = src_lab[skin]
# Reinhard colour transfer on the skin only
mu_s, sd_s = s_px.mean(0), s_px.std(0) + 1e-3
mu_r, sd_r = ref_lab.mean(0), ref_lab.std(0) + 1e-3
matched = src_lab.copy()
for c in range(3):
    gain = sd_r[c] / sd_s[c] if c else 1.0          # keep the photo's own light/shadow range
    matched[..., c] = (src_lab[..., c] - mu_s[c]) * gain + mu_r[c]

# ---------------------------------------------------------------- anime cel shading on the skin
L = cv2.GaussianBlur(matched[..., 0], (0, 0), 3)
lv = L[skin]
t1, t2, t3 = np.percentile(lv, [10, 32, 80])
base = mu_r.copy()
def tone(dl, da=0, db=0):
    c = np.array([[[np.clip(base[0] + dl, 0, 255), base[1] + da, base[2] + db]]], np.float32)
    return cv2.cvtColor(c.astype(np.uint8), cv2.COLOR_LAB2BGR)[0, 0]
med = np.median(samp, 0)                         # reference skin, BGR
warm = lambda k, r=0, b=0: np.clip(med * k + np.array([b, 0, r]), 0, 255)
deep, shadow, mid, light = warm(0.62, 4, -6), warm(0.80, 6, -4), warm(1.0), warm(1.13, 4, -2)
band = np.select([L < t1, L < t2, L < t3], [0, 1, 2], 3).astype(np.uint8)
band = cv2.medianBlur(band, 9)
palette = np.array([deep, shadow, mid, light], np.uint8)
skin_toon = palette[band]

# ---------------------------------------------------------------- jawline: shaded underside + slimmer contour
cx, cy, ax, ay = 336, 420, 118, 120          # jaw ellipse (lower half), in the 900px-tall frame
under = np.zeros((h, w), np.uint8)
cv2.ellipse(under, (cx, cy + 10), (ax + 4, ay + 34), 0, 8, 172, 255, -1)
cv2.ellipse(under, (cx, cy), (ax, ay), 0, 0, 180, 0, -1)
under[: cy + 10] = 0
contour = np.zeros((h, w), np.uint8)
cv2.ellipse(contour, (cx, cy), (ax, ay), 0, 12, 168, 255, -1)
cv2.ellipse(contour, (cx, cy - 6), (ax - 20, ay - 22), 0, 0, 180, 0, -1)
contour[: cy] = 0
contour[:, cx - 36:cx + 36] = 0                 # keep the chin itself lit
under = cv2.GaussianBlur(under, (0, 0), 2) > 120
contour = cv2.GaussianBlur(contour, (0, 0), 2) > 120
skin_toon[under & skin] = deep
lowered = np.minimum(band, 1)
skin_toon[contour & skin & (band >= 2)] = palette[1]

toon[skin] = skin_toon[skin]

# ---------------------------------------------------------------- ink
def ink_from(gray, block, C, min_area):
    th = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, block, C)
    inv = 255 - th
    n, lab, st, _ = cv2.connectedComponentsWithStats(inv)
    keep = np.zeros(inv.shape, bool)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] >= min_area:
            keep |= lab == i
    return keep

coarse = ink_from(cv2.medianBlur(cv2.cvtColor(smooth, cv2.COLOR_BGR2GRAY), 7), 13, 7, 60)
fine_src = cv2.medianBlur(cv2.cvtColor(cv2.bilateralFilter(img, 9, 30, 9), cv2.COLOR_BGR2GRAY), 3)
fine = ink_from(fine_src, 9, 8, 28)
face = np.zeros((h, w), bool)
face[255:445, 240:430] = True                    # brows, eyes, nose, mouth
ink = coarse & ~skin | (coarse & skin & ~face) | (fine & face)
# jawline ink strokes, anime style: broken lines on both sides, a small chin curve
jaw = np.zeros((h, w), np.uint8)
cv2.ellipse(jaw, (cx, cy), (ax, ay), 0, 28, 66, 255, 3, cv2.LINE_AA)
cv2.ellipse(jaw, (cx, cy), (ax, ay), 0, 114, 152, 255, 3, cv2.LINE_AA)
cv2.ellipse(jaw, (cx, cy + ay - 6), (30, 8), 0, 20, 160, 255, 2, cv2.LINE_AA)
ink |= (jaw > 100) & (fg > 0)

inkcol = np.array(tone(-80, 8, 8), np.float32)
toon = toon.astype(np.float32)
toon[ink] = toon[ink] * 0.15 + inkcol * 0.10
# small catch-light in each eye
for ex, ey in ((282, 320), (395, 320)):
    cv2.circle(toon, (ex, ey), 2, (255, 255, 255), -1, cv2.LINE_AA)
toon = np.clip(toon, 0, 255).astype(np.uint8)

# ---------------------------------------------------------------- sticker outline + export
m = fg * 255
white = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (19, 19)))
black = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (29, 29)))
edge = cv2.subtract(cv2.dilate(m, np.ones((3, 3), np.uint8)), cv2.erode(m, np.ones((3, 3), np.uint8)))
rgba = np.zeros((h, w, 4), np.uint8)
rgba[black > 0] = (10, 10, 10, 255)
rgba[white > 0] = (255, 255, 255, 255)
person = fg > 0
rgba[person, :3] = toon[person]
rgba[person, 3] = 255
rgba[edge > 0] = (10, 10, 10, 255)
rgba[..., 3] = cv2.GaussianBlur(rgba[..., 3], (3, 3), 0)
ys, xs = np.where(rgba[..., 3] > 0)
rgba = rgba[max(0, ys.min() - 4):h, max(0, xs.min() - 4):min(w, xs.max() + 4)]
cv2.imwrite(out, rgba)
print("saved", out, rgba.shape, "skin px", int(skin.sum()))
