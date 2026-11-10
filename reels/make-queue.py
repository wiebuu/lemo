# NOTE: reels-v2-queue.json was re-planned on 10 Nov around the old-layout Shorts already scheduled; edit that file directly.
# Writes reels-v2-queue.json: the new-layout Shorts, their slot (India time) and their YouTube
# title and description. Three a day to 20 Nov with the Shorts already scheduled on YouTube:
# 16:30 Indonesian (18:00 in Jakarta), 19:30 Hindi (India's evening), 22:30 English (US/UK day).
import json

SITE = "lemodysounds.online"


def en(song, artist, line, tags, hook=None):
    return (
        f"{hook or f'Can you sing {song} in tune?'} 🎤 {artist} #shorts",
        f"The white line is {artist}'s real voice. Sing on Lemody and yours draws its own line on top, live, "
        f"so you see every note you hit and every one you miss.\n\"{line}\" ... still on the note?\n\n"
        f"Free, right in your browser: {SITE}\n\n{tags} #singing #karaoke #singingchallenge #vocals #shorts",
    )


def hi(song, artist, line, tags):
    return (
        f"{song} sur mein gaa sakte ho? 🎤 {artist} #shorts",
        f"The white line is {artist}'s real voice. Sing on Lemody and your own line shows up on top, live: "
        f"every note you hit, every note you miss.\n\"{line}\" ... sur mein gaa paoge?\n\n"
        f"Free, in your browser: {SITE} (Hindi, Punjabi, English & more)\n\n{tags} #singing #karaoke #hindisongs #bollywood #singingchallenge #shorts",
    )


def idn(song, artist, line, tags):
    return (
        f"Bisa nyanyi {song} tanpa fals? 🎤 {artist} #shorts",
        f"Garis putih itu suara asli {artist}. Nyanyi di Lemody dan suaramu jadi garis sendiri di atasnya, langsung.\n"
        f"\"{line}\" ... masih pas nadanya?\n\nGratis, langsung di browser: {SITE}\n\n"
        f"{tags} #nyanyi #karaoke #laguindonesia #coverlagu #fyp #shorts",
    )


Q = [
    ("2026-11-11", "16:30", "2MyjWg7P00A", "n07-sial", idn("Sial", "Mahalini", "Bagaimana dengan aku terlanjur mencintaimu?", "#Sial #Mahalini")),
    ("2026-11-11", "19:30", "Dm6YRJHy64c", "n15-raataan-lambiyan", hi("Raataan Lambiyan", "Jubin Nautiyal", "Ki raatan lambiyan-lambiyan re", "#RaataanLambiyan #JubinNautiyal #Shershaah")),
    ("2026-11-12", "22:30", "4VwtfInG-LU", "n16-heeriye", hi("Heeriye", "Arijit Singh & Jasleen Royal", "Teri hoke maraan, jind-jaan karaan", "#Heeriye #ArijitSingh #JasleenRoyal")),
    ("2026-11-13", "16:30", "YsGwU8vTRsE", "n08-tak-ingin-usai", idn("Tak Ingin Usai", "Keisya Levronka", "Jujur ku tak ingin engkau pergi", "#TakInginUsai #KeisyaLevronka")),
    ("2026-11-13", "19:30", "YALvuUpY_b0", "n17-apna-bana-le", hi("Apna Bana Le", "Arijit Singh", "Apna bana le piya", "#ApnaBanaLe #ArijitSingh #Bhediya")),
    ("2026-11-13", "22:30", "6bGmUTAfh-A", "n03-let-her-go", en("Let Her Go", "Passenger", "Only know you love her when you let her go", "#LetHerGo #Passenger")),
    ("2026-11-14", "16:30", "DWa0ImUSAKk", "n18-bertaut", idn("Bertaut", "Nadin Amizah", "Seperti detak jantung yang bertaut", "#Bertaut #NadinAmizah")),
    ("2026-11-14", "19:30", "usvVGXFIpTM", "n19-jo-tum-mere-ho", hi("Jo Tum Mere Ho", "Anuv Jain", "Jo tum mere ho, to main kuch nahin maangoon duniya se", "#JoTumMereHo #AnuvJain")),
    ("2026-11-14", "22:30", "kIft-LUHHVA", "n10-espresso", en("Espresso", "Sabrina Carpenter", "That's that me espresso", "#Espresso #SabrinaCarpenter")),
    ("2026-11-15", "19:30", "_9FyH8PmRSU", "n20-maan-meri-jaan", hi("Maan Meri Jaan", "King", "Tu maan meri jaan, main tujhe jaane na doonga", "#MaanMeriJaan #King")),
    ("2026-11-15", "22:30", "znvky0Uq8qc", "n05-until-i-found-you", en("Until I Found You", "Stephen Sanchez", "I would never fall in love again until I found her", "#UntilIFoundYou #StephenSanchez")),
    ("2026-11-16", "16:30", "lABZ_-uhC0E", "n21-gala-bunga-matahari", idn("Gala Bunga Matahari", "Sal Priadi", "Mungkinkah kau mampir hari ini?", "#GalaBungaMatahari #SalPriadi")),
    ("2026-11-16", "19:30", "FOA9iyxsW_A", "n22-agar-tum-saath-ho", hi("Agar Tum Saath Ho", "Arijit Singh & Alka Yagnik", "Bin bole baatein tumse karun, agar tum saath ho", "#AgarTumSaathHo #ArijitSingh #AlkaYagnik #Tamasha")),
    ("2026-11-16", "22:30", "BSTsnWoslP4", "n04-bohemian", en("Bohemian Rhapsody", "Freddie Mercury", "Mama, ooh, didn't mean to make you cry", "#BohemianRhapsody #Queen #FreddieMercury", hook="Can you sing Freddie's line in tune?")),
    ("2026-11-17", "16:30", "1RrF6Ee_io0", "n23-monokrom", idn("Monokrom", "Tulus", "Kukirimkan terima kasih untuk warna dalam hidupku", "#Monokrom #Tulus")),
    ("2026-11-17", "19:30", "I94fhjQ-U30", "n24-tum-se-hi", hi("Tum Se Hi", "Mohit Chauhan", "Tum se hi din hota hai", "#TumSeHi #MohitChauhan #JabWeMet")),
    ("2026-11-17", "22:30", "th92jw2CFOA", "n06-when-i-was-your-man", en("When I Was Your Man", "Bruno Mars", "That I should've bought you flowers", "#WhenIWasYourMan #BrunoMars")),
    ("2026-11-18", "16:30", "T79fB4dkLXM", "n09-pupus", idn("Pupus", "Dewa 19", "Cintaku bertepuk sebelah tangan", "#Pupus #Dewa19")),
    ("2026-11-18", "19:30", "ii9KLQoV78I", "n25-hawayein", hi("Hawayein", "Arijit Singh", "Le jaayein jaane kahaan hawayein", "#Hawayein #ArijitSingh")),
    ("2026-11-18", "22:30", "YRkWZO4iLYk", "n11-another-love", en("Another Love", "Tom Odell", "All my tears have been used up", "#AnotherLove #TomOdell")),
    ("2026-11-19", "16:30", "TA1W-pHNKl8", "n12-a-thousand-years", en("A Thousand Years", "Christina Perri", "I have loved you for a thousand years", "#AThousandYears #ChristinaPerri")),
    ("2026-11-19", "19:30", "Pm0Ga7R-vrM", "n26-tujhe-kitna-chahne-lage", hi("Tujhe Kitna Chahne Lage", "Arijit Singh", "Tujhe kitna chahne lage hum", "#TujheKitnaChahneLage #ArijitSingh #KabirSingh")),
    ("2026-11-19", "22:30", "eLhSxOAaWmg", "n13-beautiful-things", en("Beautiful Things", "Benson Boone", "Please stay, I want you, I need you, oh God", "#BeautifulThings #BensonBoone", hook="Can you hit the Beautiful Things high note?")),
    ("2026-11-20", "16:30", "Ha4fSclVanI", "n27-jhol", hi("Jhol", "Maanu & Annural Khalid", "Haan, tere hi jhol 'te nachde saare", "#Jhol #Maanu #AnnuralKhalid")),
    ("2026-11-20", "19:30", "YCwP7X42wfw", "n28-satranga", hi("Satranga", "Arijit Singh", "Badrang mein satranga, hai yeh ishq re", "#Satranga #ArijitSingh #Animal")),
    ("2026-11-20", "22:30", "nujn6wbr-e8", "n14-as-it-was", en("As It Was", "Harry Styles", "You know it's not the same as it was", "#AsItWas #HarryStyles")),
]

out = [
    {"id": v, "out": f"out2/{n}.mp4", "date": d, "time": t, "title": ti, "description": de}
    for d, t, v, n, (ti, de) in Q
]
for o in out:
    assert len(o["title"]) <= 100, o["title"]
json.dump(out, open("reels-v2-queue.json", "w"), ensure_ascii=False, indent=1)
print(len(out), "entries")
