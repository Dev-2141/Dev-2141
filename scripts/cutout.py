# Regenerate assets/avatar.png:  python scripts/cutout.py <your-photo> assets/avatar.png  (needs opencv-python, numpy)
# Background-removed cut-out of a studio portrait (photo left exactly as shot) with a white sticker edge.
# usage: python cutout.py <portrait> <out.png>
import sys
import cv2
import numpy as np

src, out = sys.argv[1:3]
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

toon = img  # the original photo, unchanged

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
print("saved", out, rgba.shape)
