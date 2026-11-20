"""Second list for 15 Nov 2026 (more English and Hindi): same resolver as add_batch_nov15."""
import importlib.util, json, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("b", Path(__file__).with_name("add_batch_nov15.py"))
b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
b.SONGS = [
    ("Shayad", "Arijit Singh", "hi"), ("Tera Yaar Hoon Main", "Arijit Singh", "hi"),
    ("Agar Tum Mil Jao", "Shreya Ghoshal", "hi"), ("Tum Mile", "Neeraj Shridhar", "hi"),
    ("Sooraj Dooba Hai", "Arijit Singh, Aditi Singh Sharma", "hi"), ("Hasi", "Ami Mishra", "hi"),
    ("Hawa Banke", "Darshan Raval", "hi"), ("Tera Zikr", "Darshan Raval", "hi"),
    ("Kabhi Jo Baadal Barse", "Arijit Singh", "hi"), ("Dhadak", "Ajay Gogavale, Shreya Ghoshal", "hi"),
    ("Kalank", "Arijit Singh", "hi"), ("Ghungroo", "Arijit Singh, Shilpa Rao", "hi"),
    ("Main Agar Kahoon", "Sonu Nigam, Shreya Ghoshal", "hi"), ("Muskurane", "Arijit Singh", "hi"),
    ("Hamdard", "Arijit Singh", "hi"), ("Ishq Bulaava", "Sanam Puri, Shipra Goyal", "hi"),
    ("Arjan Vailly", "Bhupinder Babbal", "pa"), ("Tu Hai Kahan", "AUR", "hi"),
    ("Perfect", "One Direction", "en"), ("Night Changes", "One Direction", "en"),
    ("Let Me Love You", "DJ Snake, Justin Bieber", "en"), ("Closer", "The Chainsmokers, Halsey", "en"),
    ("Faded", "Alan Walker", "en"), ("Cheap Thrills", "Sia", "en"), ("Hymn for the Weekend", "Coldplay", "en"),
    ("Yellow", "Coldplay", "en"), ("Stitches", "Shawn Mendes", "en"), ("Night We Met", "Lord Huron", "en"),
    ("Arcade", "Duncan Laurence", "en"), ("Another Love", "Tom Odell", "en"), ("Glimpse of Us", "Joji", "en"),
    ("Cruel Summer", "Taylor Swift", "en"), ("Lover", "Taylor Swift", "en"), ("Love Story", "Taylor Swift", "en"),
    ("Blank Space", "Taylor Swift", "en"), ("Shake It Off", "Taylor Swift", "en"),
    ("Snooze", "SZA", "en"), ("Kill Bill", "SZA", "en"), ("Greedy", "Tate McRae", "en"),
    ("Lose Control", "Teddy Swims", "en"), ("Stargazing", "Myles Smith", "en"), ("Pink Pony Club", "Chappell Roan", "en"),
]
b.main(sys.argv[1])
