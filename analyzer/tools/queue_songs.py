"""One-off: append missing songs to featured.json (YouTube Music art tracks)."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from lemo_analyzer import storage  # noqa: E402

# User list (cleaned). Remixes, sped-up versions, and clips under a minute are omitted;
# songs already in the library are skipped below.
USER = [
    ("Tera Mera Rishta", "Vedika Sinha", "hi"),
    ("Girl I Need You", "Meet Bros, Arijit Singh, Roach Killa, Khushboo Grewal", "hi"),
    ("Double Decker Eyelashes", "Cornershop", "en"),
    ("Ballu Lagdu Banuli", "Narinder Singh Negi, Meena Rana", "gw"),
    ("See You Again", "Wiz Khalifa, Charlie Puth", "en"),
    ("The Hanging Tree", "James Newton Howard, Jennifer Lawrence", "en"),
    ("Main Pal Do Pal Ka Shair Hoon", "Mukesh", "hi"),
    ("rockstar", "Post Malone, 21 Savage", "en"),
    ("What A Wonderful World", "Louis Armstrong", "en"),
    ("Hey There Delilah", "Plain White T's", "en"),
    ("99 Problems", "Jay-Z", "en"),
    ("Escobar Paisa", "Escape Sequence, Kuhad", "hi"),
    ("Pal Pal Dil Ke Paas", "Kishore Kumar", "hi"),
    ("Tera Hone Laga Hoon", "Atif Aslam, Alisha Chinai", "hi"),
    ("O'Meri Laila", "Atif Aslam, Jyotica Tangri", "hi"),
    ("So High", "Doja Cat", "en"),
    ("american wedding (Hotel California)", "dopuu", "en"),
    ("Dooriyan", "Mohit Chauhan", "hi"),
    ("Mera Yaar", "Javed Bashir", "hi"),
    ("Khaabon Ke Parinday", "Mohit Chauhan, Alyssa Mendonsa", "hi"),
    ("Ilahi", "Arijit Singh", "hi"),
    ("Illegal", "PinkPantheress", "en"),
    ("You Are What You Do", "Aviram", "en"),
    ("Din Bisre", "Rakesh Manral, Arti Mudela", "gw"),
    ("LET THE WORLD BURN", "Chris Grey", "en"),
    ("Tere Bina", "A.R. Rahman, Chinmayi", "hi"),
    ("RIP Roach", "XXXTENTACION, Ski Mask The Slump God", "en"),
    ("Tum Ho", "Mohit Chauhan", "hi"),
    ("sdp interlude", "Travis Scott", "en"),
    ("Heartless", "Kanye West", "en"),
    ("Ek Ajnabee Haseena Se", "Kishore Kumar", "hi"),
    ("Runaway", "Kanye West, Pusha T", "en"),
    ("Jeene Laga Hoon", "Atif Aslam, Shreya Ghoshal", "hi"),
    ("Six Days", "DJ Shadow, Mos Def", "en"),
    ("Die For You", "The Weeknd", "en"),
    ("NEMZZZ TYPE BEAT", "Nemzzz", "en"),
    ("Satke Ligo Dil Madhuli", "Rohit Chauhan, Deepa Nagarkoti", "gw"),
    ("Буйно голова", "Гио Пика", "ru"),
    ("Шома тигр", "asanrap", "ru"),
    ("Jimmy Cooks", "Drake, 21 Savage", "en"),
    ("Lag Ja Gale", "Lata Mangeshkar", "hi"),
    ("I Will Survive", "Gloria Gaynor", "en"),
    ("Bulleya", "Papon", "hi"),
    ("Abhi Kuch Dino Se", "Mohit Chauhan", "hi"),
    ("Kachha Ghada", "Rahgir", "hi"),
    ("Wicked Games", "Kiana Ledé", "en"),
    ("Aye Mere Humsafar", "Palak Muchhal, Armaan Malik", "hi"),
    ("Meri Nazar Ka Safar", "Kishore Kumar", "hi"),
    ("Finding Her", "Kushagra, Bharath, Saaheal", "hi"),
    ("Bohemian Rhapsody", "Queen", "en"),
    ("Push It", "Kevin Gates", "en"),
    ("The Woo", "Pop Smoke, 50 Cent, Roddy Ricch", "en"),
    ("Vartmaan", "Uniyal, Soumya Rawat", "hi"),
    ("Risaune Bhaye", "Sushant KC", "ne"),
    ("Have You Ever Seen the Rain", "Arthur Gunn", "en"),
    ("My Kind Of Love", "Leon Else", "en"),
    ("Nature", "Kabira, Nj Nindaniya", "hi"),
    ("APT.", "ROSÉ, Bruno Mars", "en"),
    ("Die Hard", "Kendrick Lamar, Blxst, Amanda Reifer", "en"),
    ("Russian Bandana", "Dhanda Nyoliwala", "hr"),
    ("Bandana", "Shubh", "pa"),
    ("POWER", "Kanye West", "en"),
    ("Bad Reputation", "Avicii, Joe Janiak", "en"),
    ("Kakhuri", "Trio Mandili", "ka"),
    ("Turn on the Camera", "Bad History", "en"),
    ("Luka Chuppi", "Haniya Nafisa", "hi"),
    ("Thinking Out Loud", "Jasmine Thompson", "en"),
    ("Waiting", "Zhavia", "en"),
    ("GRRRLS", "AViVA", "en"),
    ("Don't Start Now", "Dua Lipa", "en"),
    ("Tera Khyalon Ma", "Feely_Silly", "gw"),
    ("In My Bed", "Sabrina Carpenter", "en"),
    ("Beautiful People", "Ed Sheeran, Khalid", "en"),
    ("Take Me Home, Country Roads", "John Denver", "en"),
    ("17", "Zhavia", "en"),
    ("Falling", "Alesso", "en"),
]

# Popular Haryanvi songs.
SUGGESTED = [
    ("52 Gaj Ka Daman", "Renuka Panwar", "hr"),
    ("Teri Aakhya Ka Yo Kajal", "Sapna Choudhary, Veer Dahiya", "hr"),
    ("Tu Cheez Lajawab", "Raju Punjabi, Sapna Choudhary", "hr"),
    ("Desi Desi Na Bolya Kar", "Raju Punjabi", "hr"),
    ("Solid Body", "Ajay Hooda", "hr"),
    ("Gajban", "Vishvajeet Choudhary", "hr"),
    ("Chatak Matak", "Renuka Panwar, Sapna Choudhary", "hr"),
    ("Bahu Kale Ki", "Ajay Hooda", "hr"),
    ("Jale 2", "Shiva Choudhary, Sapna Choudhary", "hr"),
    ("Matak Chalungi", "Sapna Choudhary", "hr"),
    ("Badli Badli Laage", "Sapna Choudhary", "hr"),
    ("Chundadi Jaipur Ki", "Ruchika Jangid", "hr"),
    ("Ghani Sayani", "Diler Kharkiya", "hr"),
    ("Moto", "Diler Kharkiya, Ajay Hooda", "hr"),
    ("Laad Piya Ke", "Gulzaar Chhaniwala", "hr"),
]


def parts(artist: str) -> list[str]:
    return [storage._skel(p) for p in re.split(r"\s*(?:,|&| ft\.? | feat\.? | and )\s*", artist or "") if storage._skel(p)]


def overlap(a: str, b: str) -> bool:
    pa, pb = parts(a), parts(b)
    return any(x == y or (len(x) >= 4 and (x in y or y in x)) for x in pa for y in pb)


# Same recording, different spelling / extra words in the title the user pasted.
ALIASES = {
    storage._skel("Ballu Lagdu Banuli"): storage._skel("Bhalu Lagdu Bhanuli"),
    storage._skel("Lag Ja Gale Se Phir"): storage._skel("Lag Ja Gale"),
    storage._skel("Moh Moh Ke Dhaage (Male)"): storage._skel("Moh Moh Ke Dhaage"),
}


def already(title: str, artist: str, items: list[dict]) -> bool:
    t = ALIASES.get(storage._skel(title), storage._skel(title))
    if not t:
        return False
    for f in items:
        et = storage._skel(f.get("title"))
        if not et:
            continue
        title_hit = t == et or (min(len(t), len(et)) >= 8 and (t in et or et in t))
        if title_hit and overlap(artist, f.get("artist") or ""):
            return True
    return False


def main() -> None:
    items = storage.prepare_list()
    added, skipped = [], []
    for title, artist, lang in USER + SUGGESTED:
        if already(title, artist, items):
            skipped.append(f"{title} · {artist}")
            continue
        items.append({"title": title, "artist": artist, "lang": lang, "hidden": True})
        added.append(f"{title} · {artist}")
    storage.FEATURED_FILE.write_text(
        "[\n" + ",\n".join("  " + json.dumps(f, ensure_ascii=False) for f in items) + "\n]\n"
    )
    print(f"added {len(added)} · skipped (already there) {len(skipped)}")
    print("--- skipped ---")
    print("\n".join(skipped) or "(none)")
    print("--- added ---")
    print("\n".join(added))


if __name__ == "__main__":
    main()
