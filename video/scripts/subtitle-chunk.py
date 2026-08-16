import re
# 字幕の割り方。**行頭が中途半端にならない**ことを最優先にする（001のFB）
STRONG = re.compile(r'(?<=[。．！？!?])')
COMMA  = re.compile(r'(?<=[、，])')
# 文がまだ長いときに切ってよい場所（助詞・接続の直後）。切ると意味が壊れる所では切らない
JOINT_WORDS = ['んですが','ですが','ますが','ですけど','ますけど','けど','ので','から',
               'たら','なら','ても','ながら','つつ','ですね','ますね','でして','まして']
PARTICLE = re.compile(r'(?<=[はがをにでとももへやばね])(?=[ぁ-んァ-ヶ一-龥])')

def cuts(t):
    """切ってよい位置の候補を、強い順に返す"""
    out=[]
    for rx,w in ((STRONG,0),(COMMA,1),(PARTICLE,3)):
        for m in rx.finditer(t):
            i=m.start()
            if 0<i<len(t): out.append((i,w))
    for word in JOINT_WORDS:
        j=0
        while True:
            k=t.find(word,j)
            if k<0: break
            i=k+len(word)
            if 0<i<len(t): out.append((i,2))
            j=k+1
    return out

def bad_break(t,i):
    """数字の途中や、行頭が助詞・小書き文字になる切り方を禁じる"""
    if i<=0 or i>=len(t): return True
    a,b=t[i-1],t[i]
    if a.isdigit() and (b.isdigit() or b in '、，.'): return True
    # 「4、5回」のような数の並びを割らない
    if b.isdigit() and a in '、，.' and i>=2 and t[i-2].isdigit(): return True
    if b in 'ぁぃぅぇぉっゃゅょゎー、。」）':  return True
    if b in 'はがをにでともへやのねよ' and t[i-1] not in '。、！？': return True
    return False

def chunk(t, lo=12, hi=26, hard=30):
    t=t.strip()
    if len(t)<=hi: return [t]
    cand=sorted({i for i,_ in cuts(t) if not bad_break(t,i)})
    weight={i:w for i,w in sorted(cuts(t),key=lambda x:-x[1])}
    out=[]; start=0
    while len(t)-start>hi:
        best=None
        for i in cand:
            if i<=start: continue
            n=i-start
            if n>hard: break
            if n<lo//2: continue
            score=(weight.get(i,3), abs(n-(lo+hi)//2))
            if best is None or score<best[0]: best=(score,i)
        if best is None:
            i=start+hi
            while i>start+lo and bad_break(t,i): i-=1
            out.append(t[start:i]); start=i
        else:
            out.append(t[start:best[1]]); start=best[1]
    if start<len(t): out.append(t[start:])
    return [c.strip() for c in out if c.strip()]
