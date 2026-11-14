"""Count differing pixels between each <name>-old.png and <name>-new.png in the given dirs.

A pixel counts as different if any RGB channel differs by any amount.
"""
import glob
import os
import sys

from PIL import Image, ImageChops

for d in sys.argv[1:]:
    tot = 0
    for old in sorted(glob.glob(os.path.join(d, '*-old.png'))):
        a = Image.open(old).convert('RGB')
        b = Image.open(old.replace('-old', '-new')).convert('RGB')
        if a.size != b.size:
            print(os.path.basename(old), 'SIZE', a.size, b.size)
            tot += 1
            continue
        r, g, bl = ImageChops.difference(a, b).split()
        mask = ImageChops.lighter(ImageChops.lighter(r, g), bl).point(lambda v: 255 if v else 0)
        n = mask.histogram()[255]
        tot += n
        print(os.path.basename(d), os.path.basename(old)[:-8], a.size, 'diff px', n)
    print('TOTAL', d, tot)
