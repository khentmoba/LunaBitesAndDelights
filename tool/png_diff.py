"""Count differing pixels between each <name>-old.png and <name>-new.png in the given dirs."""
import sys,glob,os
from PIL import Image, ImageChops
for d in sys.argv[1:]:
    tot=0
    for old in sorted(glob.glob(os.path.join(d,'*-old.png'))):
        a=Image.open(old).convert('RGB'); b=Image.open(old.replace('-old','-new')).convert('RGB')
        if a.size!=b.size: print(os.path.basename(old),'SIZE',a.size,b.size); tot+=1; continue
        bbox=ImageChops.difference(a,b).getbbox()
        n=0
        if bbox:
            diff=ImageChops.difference(a,b).convert('L').point(lambda v:255 if v else 0); n=diff.histogram()[255]
        tot+=n; print(d.split(os.sep)[-1][-10:], os.path.basename(old)[:-8], a.size, 'diff px', n)
    print('TOTAL',d,tot)
