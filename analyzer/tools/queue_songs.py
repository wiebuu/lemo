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


# the user's list of Bollywood, rap and Punjabi favourites (Nov 2026)
NOV = [
    ("Tujhe Dekha To", "Lata Mangeshkar, Kumar Sanu", "hi"),
    ("Pehla Nasha", "Udit Narayan, Sadhana Sargam", "hi"),
    ("Zara Zara", "Bombay Jayashri", "hi"),
    ("Kal Ho Naa Ho", "Sonu Nigam", "hi"),
    ("Mitwa", "Shafqat Amanat Ali, Shankar Mahadevan", "hi"),
    ("Kaho Naa Pyaar Hai", "Udit Narayan, Alka Yagnik", "hi"),
    ("Suraj Hua Maddham", "Sonu Nigam, Alka Yagnik", "hi"),
    ("Aankhon Mein Teri", "KK", "hi"),
    ("Ajab Si", "KK", "hi"),
    ("Tere Bina", "A.R. Rahman, Chinmayi", "hi"),
    ("Tu Hi Re", "Hariharan, Kavita Krishnamurthy", "hi"),
    ("Chand Sifarish", "Shaan, Kailash Kher", "hi"),
    ("Jashn-E-Bahaaraa", "Javed Ali", "hi"),
    ("Tu Bin Bataye", "Madhushree, Naresh Iyer", "hi"),
    ("Main Yahaan Hoon", "Udit Narayan", "hi"),
    ("Aadat", "Atif Aslam", "hi"),
    ("Tera Hone Laga Hoon", "Atif Aslam, Alisha Chinai", "hi"),
    ("Tu Jaane Na", "Atif Aslam", "hi"),
    ("Pehli Nazar Mein", "Atif Aslam", "hi"),
    ("Dil Ibaadat", "KK", "hi"),
    ("Zara Sa", "KK", "hi"),
    ("Labon Ko", "KK", "hi"),
    ("Sach Keh Raha Hai", "KK", "hi"),
    ("Tujh Mein Rab Dikhta Hai", "Roop Kumar Rathod", "hi"),
    ("Tum Se Hi", "Mohit Chauhan", "hi"),
    ("Tum Ho", "Mohit Chauhan", "hi"),
    ("Pee Loon", "Mohit Chauhan", "hi"),
    ("Phir Se Ud Chala", "Mohit Chauhan", "hi"),
    ("Sadda Haq", "Mohit Chauhan", "hi"),
    ("Brown Rang", "Yo Yo Honey Singh", "pa"),
    ("Blue Eyes", "Yo Yo Honey Singh", "hi"),
    ("Dope Shope", "Yo Yo Honey Singh, Deep Money", "pa"),
    ("Angreji Beat", "Gippy Grewal, Yo Yo Honey Singh", "pa"),
    ("Love Dose", "Yo Yo Honey Singh", "hi"),
    ("Desi Kalakaar", "Yo Yo Honey Singh", "hi"),
    ("Dheere Dheere", "Yo Yo Honey Singh", "hi"),
    ("DJ Waley Babu", "Badshah, Aastha Gill", "hi"),
    ("Saturday Saturday", "Badshah, Indeep Bakshi", "hi"),
    ("Abhi Toh Party Shuru Hui Hai", "Badshah, Aastha Gill", "hi"),
    ("Kar Gayi Chull", "Badshah, Fazilpuria", "hi"),
    ("Kala Chashma", "Badshah, Amar Arshi, Neha Kakkar", "hi"),
    ("Swag Mera Desi", "Raftaar", "hi"),
    ("All Black", "Raftaar, Sukhe", "pa"),
    ("High Heels", "Jaz Dhami, Yo Yo Honey Singh", "pa"),
    ("Tum Hi Ho", "Arijit Singh", "hi"),
    ("Chahun Main Ya Naa", "Arijit Singh, Palak Muchhal", "hi"),
    ("Kabira", "Tochi Raina, Rekha Bhardwaj", "hi"),
    ("Kabira (Encore)", "Arijit Singh, Harshdeep Kaur", "hi"),
    ("Ilahi", "Arijit Singh", "hi"),
    ("Channa Mereya", "Arijit Singh", "hi"),
    ("Agar Tum Saath Ho", "Alka Yagnik, Arijit Singh", "hi"),
    ("Raabta", "Arijit Singh", "hi"),
    ("Hawayein", "Arijit Singh", "hi"),
    ("Shayad", "Arijit Singh", "hi"),
    ("Kesariya", "Arijit Singh", "hi"),
    ("Apna Bana Le", "Arijit Singh", "hi"),
    ("O Maahi", "Arijit Singh", "hi"),
    ("Satranga", "Arijit Singh", "hi"),
    ("Ve Kamleya", "Arijit Singh, Shreya Ghoshal", "hi"),
    ("Heeriye", "Jasleen Royal, Arijit Singh", "hi"),
    ("Husn", "Anuv Jain", "hi"),
    ("Baarishein", "Anuv Jain", "hi"),
    ("Alag Aasmaan", "Anuv Jain", "hi"),
    ("Gul", "Anuv Jain", "hi"),
    ("Maan Meri Jaan", "King", "hi"),
    ("Tu Aake Dekhle", "King", "hi"),
    ("Paniyon Sa", "Atif Aslam, Tulsi Kumar", "hi"),
    ("Ranjha", "B Praak, Jasleen Royal, Romy", "hi"),
    ("Sajni", "Arijit Singh", "hi"),
    ("Tere Vaaste", "Varun Jain, Shadab Faridi, Altamash Faridi", "hi"),
    ("Iktara", "Kavita Seth", "hi"),
    ("Kho Gaye Hum Kahan", "Jasleen Royal, Prateek Kuhad", "hi"),
    ("Kasoor", "Prateek Kuhad", "hi"),
    ("Lover", "Diljit Dosanjh", "pa"),
    ("Do You Know", "Diljit Dosanjh", "pa"),
    ("Proper Patola", "Diljit Dosanjh, Badshah", "pa"),
    ("Excuses", "AP Dhillon, Gurinder Gill, Intense", "pa"),
    ("Brown Munde", "AP Dhillon, Gurinder Gill, Shinda Kahlon", "pa"),
    ("Insane", "AP Dhillon", "pa"),
    ("With You", "AP Dhillon", "pa"),
    ("Khaab", "Akhil", "pa"),
    ("Qismat", "Ammy Virk", "pa"),
    ("Soch", "Harrdy Sandhu", "pa"),
    ("Backbone", "Harrdy Sandhu", "pa"),
    ("Naah", "Harrdy Sandhu", "pa"),
    ("High Rated Gabru", "Guru Randhawa", "pa"),
    ("Suit Suit", "Guru Randhawa, Arjun", "pa"),
    ("295", "Sidhu Moose Wala", "pa"),
    ("Tose Naina", "Arijit Singh", "hi"),
    ("Maula Mere Maula", "Roop Kumar Rathod", "hi"),
    ("Tu Hai Ki Nahi", "Ankit Tiwari", "hi"),
    ("Galliyan", "Ankit Tiwari", "hi"),
    ("Sun Saathiya", "Divya Kumar, Priya Saraiya", "hi"),
    ("Sajde", "KK, Sunidhi Chauhan", "hi"),
    ("O Re Piya", "Rahat Fateh Ali Khan", "hi"),
    ("Teri Deewani", "Kailash Kher", "hi"),
    ("Kun Faya Kun", "A.R. Rahman, Javed Ali, Mohit Chauhan", "hi"),
    ("Arziyan", "Javed Ali, Kailash Kher", "hi"),
    ("Lungi Dance", "Yo Yo Honey Singh", "hi"),
    ("Party All Night", "Yo Yo Honey Singh", "hi"),
    ("Chaar Botal Vodka", "Yo Yo Honey Singh", "hi"),
    ("One Bottle Down", "Yo Yo Honey Singh", "hi"),
    ("Sunny Sunny", "Yo Yo Honey Singh, Neha Kakkar", "hi"),
    ("Aata Majhi Satakli", "Yo Yo Honey Singh, Mamta Sharma", "hi"),
    ("Birthday Bash", "Yo Yo Honey Singh, Alfaaz", "hi"),
    ("Manali Trance", "Neha Kakkar, Yo Yo Honey Singh", "hi"),
    ("ABCD", "Yo Yo Honey Singh", "hi"),
    ("Fugly Fugly Kya Hai", "Yo Yo Honey Singh", "hi"),
    ("Party With The Bhoothnath", "Yo Yo Honey Singh", "hi"),
    ("Chhote Chhote Peg", "Yo Yo Honey Singh, Neha Kakkar, Navraj Hans", "hi"),
    ("Mercy", "Badshah", "hi"),
    ("Wakhra Swag", "Navv Inder, Badshah", "pa"),
    ("Tamanche Pe Disco", "RDB, Raftaar", "hi"),
    ("Aaj Ki Party", "Mika Singh", "hi"),
    ("Daaru Party", "Millind Gaba", "pa"),
    ("Ban Gaya Kutta", "Raftaar", "hi"),
    ("Gaddi Red Challenger", "R Nait", "pa"),
    ("Lamborghini", "The Doorbeen, Ragini", "pa"),
    ("Sun Raha Hai", "Ankit Tiwari", "hi"),
    ("Badtameez Dil", "Benny Dayal", "hi"),
    ("Subhanallah", "Sreeram, Shilpa Rao", "hi"),
    ("Jeene Laga Hoon", "Atif Aslam, Shreya Ghoshal", "hi"),
    ("Teri Ore", "Rahat Fateh Ali Khan, Shreya Ghoshal", "hi"),
    ("Mast Magan", "Arijit Singh, Chinmayi", "hi"),
    ("Samjhawan", "Arijit Singh, Shreya Ghoshal", "hi"),
    ("Hamari Adhuri Kahani", "Arijit Singh", "hi"),
    ("Muskurane", "Arijit Singh", "hi"),
    ("Bhula Dena", "Mustafa Zahid", "hi"),
    ("Zaroorat", "Mustafa Zahid", "hi"),
    ("Teri Jhuki Nazar", "Shafqat Amanat Ali", "hi"),
    ("Tera Mera Rishta", "Mustafa Zahid", "hi"),
    ("Tadap Tadap", "KK, Dominique", "hi"),
    ("Tu Hi Meri Shab Hai", "KK", "hi"),
    ("Nadaan Parindey", "A.R. Rahman, Mohit Chauhan", "hi"),
    ("Senorita", "Farhan Akhtar, Hrithik Roshan, Abhay Deol", "hi"),
    ("Khaabon Ke Parinday", "Alyssa Mendonsa, Mohit Chauhan", "hi"),
    ("Dil Chahta Hai", "Shankar Mahadevan", "hi"),
    ("Koi Kahe Kehta Rahe", "Shankar Mahadevan", "hi"),
    ("Make Some Noise For The Desi Boyz", "KK, Bob", "hi"),
    ("Twist", "Neeraj Shridhar", "hi"),
    ("Aahun Aahun", "Master Saleem, Neeraj Shridhar", "hi"),
    ("Character Dheela", "Neeraj Shridhar, Amrita Kak", "hi"),
    ("Right Now Now", "Sunidhi Chauhan, Wajid", "hi"),
    ("Ishq Sufiyana", "Kamal Khan", "hi"),
    ("Teri Meri", "Rahat Fateh Ali Khan, Shreya Ghoshal", "hi"),
    ("Halkat Jawani", "Sunidhi Chauhan", "hi"),
    ("Fevicol Se", "Mamta Sharma, Wajid", "hi"),
    ("Chikni Chameli", "Shreya Ghoshal", "hi"),
    ("Sheila Ki Jawani", "Sunidhi Chauhan, Vishal Dadlani", "hi"),
    ("Desi Beat", "Mika Singh, Amrita Kak", "hi"),
    ("5 Taara", "Diljit Dosanjh", "pa"),
    ("Patola", "Guru Randhawa, Bohemia", "pa"),
    ("Yaar Mod Do", "Guru Randhawa, Millind Gaba", "pa"),
    ("Same Beef", "Sidhu Moose Wala, Bohemia", "pa"),
    ("So High", "Sidhu Moose Wala", "pa"),
    ("Unko Bhi Humse Mohabbat Ho", "Sadhana Sargam", "hi"),
    ("Jeena Jeena", "Atif Aslam", "hi"),
    ("Nahin Milta", "Bayaan", "hi"),
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
    for title, artist, lang in USER + SUGGESTED + NOV:
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
