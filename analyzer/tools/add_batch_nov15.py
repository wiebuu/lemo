"""15 Nov 2026: ~100 famous original songs for Lemody's YouTube audience (India, Indonesia,
Japan, Germany, US) plus more English. Each is resolved to its YouTube Music art track
(the plain studio recording, never a cover), skipping songs already in the library.
Writes tools/add_batch_nov15.out.json: resolved + unresolved."""

from __future__ import annotations

import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from lemo_analyzer import storage  # noqa: E402

SONGS = [
    # Hindi / Bollywood
    ("Tum Kya Mile", "Arijit Singh, Shreya Ghoshal", "hi"), ("O Bedardeya", "Arijit Singh", "hi"),
    ("Phir Bhi Tumko Chaahunga", "Arijit Singh, Shashaa Tirupati", "hi"), ("Khairiyat", "Arijit Singh", "hi"),
    ("Bekhayali", "Sachet Tandon", "hi"), ("Dil Diyan Gallan", "Atif Aslam", "hi"), ("Jeena Jeena", "Atif Aslam", "hi"),
    ("Kaun Tujhe", "Palak Muchhal", "hi"), ("Mere Rashke Qamar", "Rahat Fateh Ali Khan", "hi"),
    ("Malang Sajna", "Sachet Tandon, Parampara Tandon", "hi"), ("Kahani Suno 2.0", "Kaifi Khalil", "hi"),
    ("Teri Mitti", "B Praak", "hi"), ("Mann Bharryaa 2.0", "B Praak", "hi"), ("Filhall", "B Praak", "hi"),
    ("Lut Gaye", "Jubin Nautiyal", "hi"), ("Humnava Mere", "Jubin Nautiyal", "hi"),
    ("Dil Galti Kar Baitha Hai", "Jubin Nautiyal", "hi"), ("Galliyan", "Ankit Tiwari", "hi"),
    ("Sun Saathiya", "Priya Saraiya, Divya Kumar", "hi"), ("Jhoome Jo Pathaan", "Arijit Singh, Sukriti Kakar", "hi"),
    ("Deva Deva", "Arijit Singh, Jonita Gandhi", "hi"), ("Ram Siya Ram", "Sachet Tandon, Parampara Tandon", "hi"),
    ("Phir Kabhi", "Arijit Singh", "hi"), ("Bol Do Na Zara", "Armaan Malik", "hi"),
    ("Main Rahoon Ya Na Rahoon", "Armaan Malik", "hi"), ("Dil Ko Karaar Aaya", "Yasser Desai, Neha Kakkar", "hi"),
    ("Tujhko Jo Paaya", "Mohit Chauhan", "hi"), ("Bhula Dena", "Mustafa Zahid", "hi"),
    ("Lambiyaan Si Judaiyaan", "Arijit Singh", "hi"), ("Sanam Re", "Arijit Singh", "hi"),
    ("Janam Janam", "Arijit Singh, Antara Mitra", "hi"), ("Khuda Jaane", "KK, Shilpa Rao", "hi"),
    ("Tu Hi Haqeeqat", "Javed Ali", "hi"), ("Phir Se Ud Chala", "Mohit Chauhan", "hi"),
    ("Baarish", "Mohammed Irfan", "hi"), ("Tera Ban Jaunga", "Akhil Sachdeva, Tulsi Kumar", "hi"),
    ("Pehle Bhi Main", "Vishal Mishra", "hi"), ("Maiyya Mainu", "Sachet Tandon", "hi"),
    ("Jo Bheji Thi Duaa", "Arijit Singh", "hi"), ("Qaafirana", "Arijit Singh, Nikhita Gandhi", "hi"),
    ("Saware", "Arijit Singh", "hi"), ("Kya Baat Ay", "Harrdy Sandhu", "hi"),
    # Punjabi
    ("Lover", "Diljit Dosanjh", "pa"), ("Born To Shine", "Diljit Dosanjh", "pa"), ("G.O.A.T.", "Diljit Dosanjh", "pa"),
    ("With You", "AP Dhillon", "pa"), ("Insane", "AP Dhillon", "pa"), ("Summer High", "AP Dhillon", "pa"),
    ("Admirin' You", "Karan Aujla", "pa"), ("Winning Speech", "Karan Aujla", "pa"), ("Lehanga", "Jass Manak", "pa"),
    ("Qismat", "Ammy Virk", "pa"), ("So High", "Sidhu Moose Wala", "pa"), ("Jee Ni Lagda", "Karan Aujla", "pa"),
    # English
    ("Believer", "Imagine Dragons", "en"), ("Counting Stars", "OneRepublic", "en"), ("Photograph", "Ed Sheeran", "en"),
    ("Thinking Out Loud", "Ed Sheeran", "en"), ("All of Me", "John Legend", "en"),
    ("Say You Won't Let Go", "James Arthur", "en"), ("Heat Waves", "Glass Animals", "en"),
    ("Unstoppable", "Sia", "en"), ("lovely", "Billie Eilish, Khalid", "en"), ("ocean eyes", "Billie Eilish", "en"),
    ("Happier Than Ever", "Billie Eilish", "en"), ("Too Sweet", "Hozier", "en"),
    ("Story of My Life", "One Direction", "en"), ("Love Yourself", "Justin Bieber", "en"), ("Ghost", "Justin Bieber", "en"),
    ("The Scientist", "Coldplay", "en"), ("Fix You", "Coldplay", "en"), ("Riptide", "Vance Joy", "en"),
    ("Golden Hour", "JVKE", "en"), ("Line Without a Hook", "Ricky Montgomery", "en"), ("Calm Down", "Rema, Selena Gomez", "en"),
    ("Dandelions", "Ruth B.", "en"), ("Starboy", "The Weeknd, Daft Punk", "en"),
    ("Somebody That I Used To Know", "Gotye, Kimbra", "en"), ("Rewrite The Stars", "Zac Efron, Zendaya", "en"),
    ("Lose You To Love Me", "Selena Gomez", "en"), ("Treat You Better", "Shawn Mendes", "en"),
    ("Señorita", "Shawn Mendes, Camila Cabello", "en"), ("Attention", "Charlie Puth", "en"),
    ("We Don't Talk Anymore", "Charlie Puth, Selena Gomez", "en"), ("drivers license", "Olivia Rodrigo", "en"),
    ("traitor", "Olivia Rodrigo", "en"), ("vampire", "Olivia Rodrigo", "en"), ("Apocalypse", "Cigarettes After Sex", "en"),
    ("Sweater Weather", "The Neighbourhood", "en"), ("Daylight", "David Kushner", "en"),
    # Indonesian
    ("Rumah Singgah", "Fabio Asher", "id"), ("Sampai Jadi Debu", "Banda Neira", "id"), ("Kangen", "Dewa 19", "id"),
    ("Separuh Nafas", "Dewa 19", "id"), ("Mangu", "Fourtwnty, Charita Utami", "id"), ("Satu Bulan", "Bernadya", "id"),
    ("Untungnya, Hidup Masih Bisa Berjalan", "Bernadya", "id"), ("Kita Usahakan Lagi", "Batas Senja", "id"),
    ("Bergema Sampai Selamanya", "Nadhif Basalamah", "id"), ("Penjaga Hati", "Nadhif Basalamah", "id"),
    ("Tak Segampang Itu", "Anggi Marito", "id"), ("Asmalibrasi", "Soegi Bornean", "id"), ("Ruang Sendiri", "Tulus", "id"),
    ("Hanya Rindu", "Andmesh", "id"), ("Cinta Luar Biasa", "Andmesh", "id"), ("Dan", "Sheila On 7", "id"),
    ("Sephia", "Sheila On 7", "id"),
    # Japanese
    ("Lemon", "Kenshi Yonezu", "ja"), ("KICK BACK", "Kenshi Yonezu", "ja"), ("Marigold", "Aimyon", "ja"),
    ("Suzume", "RADWIMPS", "ja"), ("Nandemonaiya", "RADWIMPS", "ja"), ("Sparkle", "RADWIMPS", "ja"),
    ("Bling-Bang-Bang-Born", "Creepy Nuts", "ja"), ("Subtitle", "Official HIGE DANdism", "ja"),
    ("Mixed Nuts", "Official HIGE DANdism", "ja"), ("Usseewa", "Ado", "ja"), ("Show", "Ado", "ja"),
    ("Kaikai Kitan", "Eve", "ja"), ("Hana ni Bourei", "Yorushika", "ja"), ("Matsuri", "Fujii Kaze", "ja"),
    ("Kirari", "Fujii Kaze", "ja"), ("Gunjou", "YOASOBI", "ja"), ("Shukufuku", "YOASOBI", "ja"),
    # German
    ("Durch den Monsun", "Tokio Hotel", "de"), ("Bauch und Kopf", "Mark Forster", "de"), ("Chöre", "Mark Forster", "de"),
    ("Wenn sie tanzt", "Max Giesinger", "de"), ("Tage wie diese", "Die Toten Hosen", "de"), ("Haus am See", "Peter Fox", "de"),
    ("Musik sein", "Wincent Weiss", "de"),
]

def main(catalog_path: str) -> None:
    have = json.load(open(catalog_path))
    titles = {storage._skel(e.get("title")) for e in have.values()} | {storage._skel(f.get("title")) for f in storage.prepare_list() if f.get("title")}
    vids = {sid[3:] for sid in have} | {f.get("videoId") for f in storage.prepare_list()}
    todo, skipped = [], []
    for t, a, l in SONGS:
        (skipped if storage._skel(t) in titles else todo).append((t, a, l))
    print(f"{len(SONGS)} listed, {len(skipped)} already in Lemody: {', '.join(t for t, _, _ in skipped)}", flush=True)

    def one(x):
        t, a, l = x
        try:
            hit = storage.resolve(t, a)
        except Exception as e:  # network hiccup: one retry
            try:
                hit = storage.resolve(t, a)
            except Exception:
                hit = None
        print(("OK  " if hit else "MISS"), t, "-", a, (hit or {}).get("videoId", ""), (hit or {}).get("track", ""), flush=True)
        return {"title": t, "artist": a, "lang": l, **({"videoId": hit["videoId"], "track": hit["track"], "duration": hit["duration"]} if hit else {})}

    with ThreadPoolExecutor(4) as ex:
        res = list(ex.map(one, todo))
    res = [r for r in res if r.get("videoId") not in vids or not r.get("videoId")]
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).with_suffix(".out.json")
    out.write_text(json.dumps(res, ensure_ascii=False, indent=1))
    print(f"resolved {sum(1 for r in res if r.get('videoId'))} of {len(res)} → {out}", flush=True)


if __name__ == "__main__":
    main(sys.argv[1])
