"""Third list for 15 Nov 2026: famous Japanese, Indonesian and English songs (the countries that watch Lemody's Shorts the most). Same resolver as add_batch_nov15."""
import importlib.util, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("b", Path(__file__).with_name("add_batch_nov15.py"))
b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
b.SONGS = [
    # Japanese
    ("Uchiage Hanabi", "DAOKO, Kenshi Yonezu", "ja"), ("Mixed Nuts", "Official HIGE DANdism", "ja"),
    ("Yume Utsutsu", "Fujii Kaze", "ja"), ("Kaiju no Hanauta", "Vaundy", "ja"),
    ("Lilac", "Mrs. GREEN APPLE", "ja"), ("Ao to Natsu", "Mrs. GREEN APPLE", "ja"),
    ("Hakujitsu", "King Gnu", "ja"), ("SPECIALZ", "King Gnu", "ja"),
    ("Homura", "LiSA", "ja"), ("Gunjou", "YOASOBI", "ja"), ("Yuusha", "YOASOBI", "ja"),
    ("Ao no Sumika", "Tatsuya Kitani", "ja"), ("Odo", "Ado", "ja"), ("Shinjidai", "Ado", "ja"),
    ("Dry Flower", "Yuuri", "ja"), ("Cry Baby", "Official HIGE DANdism", "ja"),
    ("Haru Dorobou", "Yorushika", "ja"), ("Zankyosanka", "Aimer", "ja"),
    ("Suiheisen", "back number", "ja"), ("Kanden", "Kenshi Yonezu", "ja"),
    # Indonesian
    ("Untungnya, Hidup Harus Tetap Berjalan", "Bernadya", "id"), ("Sisa Rasa", "Mahalini", "id"),
    ("Melawan Restu", "Mahalini", "id"), ("Tak Dianggap", "Lyodra", "id"),
    ("Janji Setia", "Tiara Andini", "id"), ("Menjadi Dia", "Tiara Andini", "id"),
    ("Lagu Nikah", "Juicy Luicy", "id"), ("Tampar", "Juicy Luicy", "id"),
    ("To the Bone", "Pamungkas", "id"), ("Kesempurnaan Cinta", "Rizky Febian", "id"),
    ("Bukti", "Virgoun", "id"), ("Bertahan Terluka", "Fabio Asher", "id"),
    ("Jiwa yang Bersedih", "Ghea Indrawari", "id"), ("Kangen", "Dewa 19", "id"),
    ("Separuh Aku", "NOAH", "id"), ("Bukan Cinta Biasa", "Afgan", "id"),
    ("Kali Kedua", "Raisa", "id"), ("Hampa", "Ari Lasso", "id"),
    ("Evaluasi", "Hindia", "id"), ("Mati-Matian", "Mahalini", "id"),
    # English (most-played on YouTube)
    ("Die With A Smile", "Lady Gaga, Bruno Mars", "en"), ("Shape of You", "Ed Sheeran", "en"),
    ("See You Again", "Wiz Khalifa, Charlie Puth", "en"), ("Someone Like You", "Adele", "en"),
    ("Lovely", "Billie Eilish, Khalid", "en"), ("Night Changes", "One Direction", "en"),
    ("Flowers", "Miley Cyrus", "en"), ("Snowman", "Sia", "en"), ("Unholy", "Sam Smith, Kim Petras", "en"),
    ("Lose Control", "Teddy Swims", "en"),
]
b.main(sys.argv[1])
