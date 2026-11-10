# render-schedule.py VID[=start-end|=line text] ... : copy a song from the analyzer, set its clip in reels-schedule.json, render it, contact sheet in data/sheet.jpg
import json,sys,subprocess,shutil,os
R='/Users/vishwassingh/Desktop/lemo/reels'; A='/Users/vishwassingh/Desktop/lemo/analyzer/data/songs'
S='/Users/vishwassingh/Desktop/lemo/reels/data'
P=R+'/reels-schedule.json'; d=json.load(open(P))
batch=[]
for a in sys.argv[1:]:
    vid,_,clip=a.partition('=')
    e=next(x for x in d if x['song']=='songs/yt-'+vid)
    os.makedirs(f"{R}/songs/yt-{vid}",exist_ok=True)
    for f in ['reference.json','lyrics.json','backing.m4a','vocals.m4a']: shutil.copy(f"{A}/yt-{vid}/{f}",f"{R}/songs/yt-{vid}/{f}")
    for k in ('start','end','line'): e.pop(k,None)
    if clip and clip[0].isdigit(): s,t=clip.split('-'); e['start'],e['end']=float(s),float(t)
    elif clip: e['line']=clip
    batch.append(e)
open(P,'w').write("[\n"+",\n".join("  "+json.dumps(o,ensure_ascii=False) for o in d)+"\n]\n")
json.dump(batch,open(S+'/b.json','w'),ensure_ascii=False)
subprocess.run(['node','make-reel.mjs','--batch',S+'/b.json'],cwd=R)
imgs=[]
for e in batch:
    o=R+'/'+e['out']
    for t in (3,8):
        p=f"{S}/s{len(imgs)}.jpg"; subprocess.run(['ffmpeg','-v','error','-y','-ss',str(t),'-i',o,'-frames:v','1','-vf','scale=240:-1',p]); imgs.append(p)
subprocess.run(['ffmpeg','-v','error','-y',*sum([['-i',p] for p in imgs],[]),'-filter_complex',f"hstack={len(imgs)}" if len(imgs)>1 else 'null',S+'/sheet.jpg'])
