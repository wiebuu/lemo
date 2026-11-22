"""22 Nov 2026: about 30 of the most-heard songs for each country that watches Lemody's Shorts
(YouTube analytics, 28 days): India, Japan, Indonesia, US, Germany, Philippines, France, Italy, UK,
Vietnam, Bangladesh, Brazil, South Korea, Malaysia, Pakistan, Mexico, Canada, Thailand.
Songs already in Lemody are skipped, so countries that already have many (India, English) get few.
Same resolver as add_batch_nov15 (YouTube Music art tracks, never covers).
  python3 tools/add_batch_nov22.py <catalog.json> [out.json]"""
import importlib.util, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("b", Path(__file__).with_name("add_batch_nov15.py"))
b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)

def L(lang, *songs):
    return [(t, a, lang) for t, a in songs]

b.SONGS = (
    # Japan
    L("ja", ("Bling-Bang-Bang-Born", "Creepy Nuts"), ("Otonoke", "Creepy Nuts"), ("Subtitle", "Official HIGE DANdism"),
      ("Yoru ni Kakeru", "YOASOBI"), ("Idol", "YOASOBI"), ("Kaibutsu", "YOASOBI"), ("Tabun", "YOASOBI"),
      ("Lemon", "Kenshi Yonezu"), ("KICK BACK", "Kenshi Yonezu"), ("Sayonara Elegy", "Masaki Suda"),
      ("Marigold", "Aimyon"), ("Haru no Hi", "Aimyon"), ("Kaikai Kitan", "Eve"), ("Mayonaka no Door", "Miki Matsubara"),
      ("Zenzenzense", "RADWIMPS"), ("Hana ni Bourei", "Yorushika"), ("Ichizu", "King Gnu"), ("Gurenge", "LiSA"),
      ("Saikai", "LiSA, Uru"), ("I LOVE...", "Official HIGE DANdism"), ("Bunny Girl", "AKASAKI"), ("Overdose", "natori"),
      ("Kawaikute Gomen", "HoneyWorks"), ("Tokyo Flash", "Vaundy"), ("Odoriko", "Vaundy"), ("Sakura", "Ikimonogakari"),
      ("Mixed Nuts", "Official HIGE DANdism"), ("Ai no Uta", "Strawberry Flower"), ("Yuusha", "YOASOBI"), ("Plastic Love", "Mariya Takeuchi")),
    # Indonesia
    L("id", ("Garam & Madu", "Tenxi, Naykilla, Jemsii"), ("Satu Bulan", "Bernadya"), ("Kata Mereka Ini Berlebihan", "Bernadya"),
      ("Tak Ingin Usai", "Keisya Levronka"), ("Monokrom", "Tulus"), ("Interaksi", "Tulus"), ("Sial", "Mahalini"),
      ("Rumah Singgah", "Fabio Asher"), ("Cincin", "Hindia"), ("Tenang", "Yura Yunita"), ("Dan", "Sheila On 7"),
      ("Sephia", "Sheila On 7"), ("Melukis Senja", "Budi Doremi"), ("Akad", "Payung Teduh"), ("Bertaut", "Nadin Amizah"),
      ("Rayuan Perempuan Gila", "Nadin Amizah"), ("Takkan Terganti", "Marcell"), ("Pupus", "Dewa 19"), ("Risalah Hati", "Dewa 19"),
      ("Terlalu Lama Sendiri", "Kunto Aji"), ("Mendung Tanpo Udan", "Ndarboy Genk"), ("Hanya Rindu", "Andmesh"),
      ("Kita Usahakan Lagi", "Batas Senja"), ("Bergema Sampai Selamanya", "Nadhif Basalamah"), ("Penjaga Hati", "Nadhif Basalamah"),
      ("Tak Segampang Itu", "Anggi Marito"), ("Asmalibrasi", "Soegi Bornean"), ("Ruang Sendiri", "Tulus"), ("Komang", "Raim Laode"),
      ("Mangu", "Fourtwnty, Charita Utami")),
    # US, UK, Canada
    L("en", ("Espresso", "Sabrina Carpenter"), ("Please Please Please", "Sabrina Carpenter"), ("Manchild", "Sabrina Carpenter"),
      ("Beautiful Things", "Benson Boone"), ("luther", "Kendrick Lamar, SZA"), ("Not Like Us", "Kendrick Lamar"),
      ("Golden", "HUNTR/X, EJAE, AUDREY NUNA, REI AMI"), ("Messy", "Lola Young"), ("The Fate of Ophelia", "Taylor Swift"),
      ("I Had Some Help", "Post Malone, Morgan Wallen"), ("Sapphire", "Ed Sheeran"), ("Azizam", "Ed Sheeran"),
      ("Love Me Not", "Ravyn Lenae"), ("What I Want", "Morgan Wallen, Tate McRae"), ("Last Night", "Morgan Wallen"),
      ("Heat Waves", "Glass Animals"), ("As It Was", "Harry Styles"), ("Viva La Vida", "Coldplay"), ("Yellow", "Coldplay"),
      ("Mr. Brightside", "The Killers"), ("Wonderwall", "Oasis"), ("Riptide", "Vance Joy"), ("Thinking Out Loud", "Ed Sheeran"),
      ("Perfect", "Ed Sheeran"), ("Photograph", "Ed Sheeran"), ("Let Her Go", "Passenger"), ("Someone You Loved", "Lewis Capaldi"),
      ("Shivers", "Ed Sheeran"), ("Peaches", "Justin Bieber, Daniel Caesar, Giveon"), ("Hello", "Adele"),
      ("Rolling in the Deep", "Adele"), ("Dynamite", "BTS"), ("Seven", "Jung Kook, Latto")),
    # Germany
    L("de", ("Ein Kompliment", "Sportfreunde Stiller"), ("Atemlos durch die Nacht", "Helene Fischer"), ("Major Tom", "Peter Schilling"),
      ("99 Luftballons", "Nena"), ("Leuchtturm", "Nena"), ("Komet", "Udo Lindenberg, Apache 207"), ("Nur noch kurz die Welt retten", "Tim Bendzko"),
      ("Auf uns", "Andreas Bourani"), ("Ohne dich", "Münchener Freiheit"), ("Alles nur geklaut", "Die Prinzen"), ("Bologna", "Wanda"),
      ("Junge", "Die Ärzte"), ("Schrei nach Liebe", "Die Ärzte"), ("Für immer und dich", "Rio Reiser"), ("Applaus, Applaus", "Sportfreunde Stiller"),
      ("Engel", "Rammstein"), ("Sonne", "Rammstein"), ("Ich will", "Rammstein"), ("Wenn sie tanzt", "Max Giesinger"), ("Chöre", "Mark Forster"),
      ("Roller", "Apache 207"), ("Haus am See", "Peter Fox"), ("Musik sein", "Wincent Weiss"), ("Bauch und Kopf", "Mark Forster"),
      ("Layla", "DJ Robin, Schürze"), ("Du hast", "Rammstein"), ("Wolke 4", "Philipp Dittberner"), ("Tage wie diese", "Die Toten Hosen"),
      ("80 Millionen", "Max Giesinger"), ("Durch den Monsun", "Tokio Hotel")),
    # France
    L("fr", ("Formidable", "Stromae"), ("Papaoutai", "Stromae"), ("Santé", "Stromae"), ("Tous les mêmes", "Stromae"), ("Je veux", "Zaz"),
      ("Ne me quitte pas", "Jacques Brel"), ("Non, je ne regrette rien", "Édith Piaf"), ("Andalouse", "Kendji Girac"),
      ("Balance ton quoi", "Angèle"), ("Ta reine", "Angèle"), ("Bruxelles je t'aime", "Angèle"), ("Mistral gagnant", "Renaud"),
      ("Pookie", "Aya Nakamura"), ("SOS", "Indila"), ("Love Story", "Indila"), ("Elle me dit", "Mika"), ("Je te promets", "Johnny Hallyday"),
      ("Bella", "Maître Gims"), ("Est-ce que tu m'aimes ?", "GIMS"), ("Sapés comme jamais", "GIMS, Niska"), ("La Bohème", "Charles Aznavour"),
      ("Dommage", "Bigflo & Oli"), ("Tu m'oublieras", "Larusso"), ("Parce qu'on vient de loin", "Corneille"), ("Mon amour", "Slimane"),
      ("Je l'aime à mourir", "Francis Cabrel"), ("Les Champs-Élysées", "Joe Dassin"), ("Djadja", "Aya Nakamura"),
      ("Je te laisserai des mots", "Patrick Watson"), ("Tout oublier", "Angèle, Roméo Elvis")),
    # Italy
    L("it", ("Nel blu dipinto di blu", "Domenico Modugno"), ("Felicità", "Al Bano, Romina Power"), ("L'italiano", "Toto Cutugno"),
      ("Con te partirò", "Andrea Bocelli"), ("Zitti e buoni", "Måneskin"), ("Coraline", "Måneskin"), ("Vivo per lei", "Andrea Bocelli, Giorgia"),
      ("Brividi", "Mahmood, Blanco"), ("Soldi", "Mahmood"), ("Tuta gold", "Mahmood"), ("La noia", "Angelina Mango"), ("Due vite", "Marco Mengoni"),
      ("L'essenziale", "Marco Mengoni"), ("Senza una donna", "Zucchero"), ("Azzurro", "Adriano Celentano"), ("La solitudine", "Laura Pausini"),
      ("Strani amori", "Laura Pausini"), ("Ti amo", "Umberto Tozzi"), ("Gloria", "Umberto Tozzi"), ("Sarà perché ti amo", "Ricchi e Poveri"),
      ("Più bella cosa", "Eros Ramazzotti"), ("Se bastasse una canzone", "Eros Ramazzotti"), ("Caruso", "Lucio Dalla"),
      ("Grande amore", "Il Volo"), ("Cenere", "Lazza"), ("Musica leggerissima", "Colapesce, Dimartino"), ("Tango", "Tananai"),
      ("I p' me, tu p' te", "Geolier"), ("Mamma Maria", "Ricchi e Poveri"), ("Io vagabondo", "I Nomadi")),
    # Philippines
    L("tl", ("Mundo", "IV of Spades"), ("Buwan", "Juan Karlos"), ("Ere", "Juan Karlos"), ("Pagsamo", "Arthur Nery"), ("Tahanan", "Adie"),
      ("Paraluman", "Adie"), ("Mahika", "Adie, Janine Berdin"), ("Kathang Isip", "Ben&Ben"), ("Pagtingin", "Ben&Ben"), ("Maybe the Night", "Ben&Ben"),
      ("Leaves", "Ben&Ben"), ("Sining", "Dionela, Jay R"), ("Marilag", "Dionela"), ("Museo", "Eliza Maturan"), ("Multo", "Cup of Joe"),
      ("Tingin", "Cup of Joe, Janine Teñoso"), ("Palagi", "TJ Monterde"), ("Ikaw at Ako", "Moira Dela Torre, Jason Marvin"),
      ("Tagpuan", "Moira Dela Torre"), ("Babalik Sa'yo", "Moira Dela Torre"), ("Torete", "Moonstar88"), ("Huling Sayaw", "Kamikazee"),
      ("Kahit Maputi Na Ang Buhok Ko", "Rey Valera"), ("Ang Huling El Bimbo", "Eraserheads"), ("With a Smile", "Eraserheads"),
      ("Hawak Kamay", "Yeng Constantino"), ("Kilometro", "Sarah Geronimo"), ("Dilaw", "Maki"), ("Saksi Ang Langit", "December Avenue"),
      ("Kung 'Di Rin Lang Ikaw", "December Avenue, Moira Dela Torre"), ("Gento", "SB19"), ("Raining in Manila", "Lola Amour")),
    # Vietnam
    L("vi", ("Chúng Ta Của Hiện Tại", "Sơn Tùng M-TP"), ("Lạc Trôi", "Sơn Tùng M-TP"), ("Nơi Này Có Anh", "Sơn Tùng M-TP"),
      ("Hãy Trao Cho Anh", "Sơn Tùng M-TP"), ("Chạy Ngay Đi", "Sơn Tùng M-TP"), ("Em Của Ngày Hôm Qua", "Sơn Tùng M-TP"),
      ("Muộn Rồi Mà Sao Còn", "Sơn Tùng M-TP"), ("Có Chắc Yêu Là Đây", "Sơn Tùng M-TP"), ("See Tình", "Hoàng Thùy Linh"),
      ("Để Mị Nói Cho Mà Nghe", "Hoàng Thùy Linh"), ("Waiting For You", "MONO"), ("Ngày Đầu Tiên", "Đức Phúc"), ("Hơn Cả Yêu", "Đức Phúc"),
      ("Ánh Nắng Của Anh", "Đức Phúc"), ("Thằng Điên", "JustaTee, Phương Ly"), ("Bước Qua Nhau", "Vũ."), ("Lạ Lùng", "Vũ."),
      ("Đông Kiếm Em", "Vũ."), ("Bạc Phận", "Jack, K-ICM"), ("Hoa Hải Đường", "Jack"), ("Sóng Gió", "Jack, K-ICM"), ("Em Gì Ơi", "Jack, K-ICM"),
      ("Tháng Tư Là Lời Nói Dối Của Em", "Hà Anh Tuấn"), ("Rồi Ta Sẽ Ngắm Pháo Hoa Cùng Nhau", "O.lew"), ("Mất Kết Nối", "Dương Domic"),
      ("Tràn Bộ Nhớ", "Dương Domic"), ("Ngày Mai Người Ta Lấy Chồng", "Thành Đạt"), ("Từng Quen", "Wren Evans"), ("Một Đêm Say", "Thịnh Suy"),
      ("Anh Đã Quen Với Cô Đơn", "Soobin Hoàng Sơn"), ("Đi Về Nhà", "Đen, JustaTee"), ("Bài Này Chill Phết", "Đen, MIN"),
      ("Có Hẹn Với Thanh Xuân", "MONSTAR")),
    # Bangladesh
    L("bn", ("Bojhena Shey Bojhena", "Arijit Singh"), ("Tomake Chai", "Arijit Singh"), ("Mon Majhi Re", "Arijit Singh"),
      ("Amake Amar Moto Thakte Dao", "Anupam Roy"), ("Bolte Bolte Cholte Cholte", "Imran, Porshi"), ("Ei Poth Jodi Na Shesh Hoy", "Hemanta Mukherjee, Sandhya Mukherjee"),
      ("Lal Paharir Deshe Ja", "Arpita Chakraborty"), ("Shada Shada Kala Kala", "Arfan Mredha Shiblu"), ("Alo", "Tahsan"),
      ("Deyale Deyale", "Minar Rahman"), ("Bhalobashi Tomay", "Tahsan"), ("Ekla Cholo Re", "Kishore Kumar"), ("Coffee House", "Manna Dey"),
      ("Tumi Robe Nirobe", "Hemanta Mukherjee"), ("Ami Banglay Gaan Gai", "Pratul Mukhopadhyay"), ("Nasek Nasek", "Coke Studio Bangla"),
      ("Bulbuli", "Coke Studio Bangla, Ritu Raj, Nandita"), ("Prarthona", "Coke Studio Bangla"), ("Dekha Hobe Bondhu", "Bappa Mazumder"),
      ("Kotha Koio Na", "Coke Studio Bangla"), ("Ure Jaak", "Shironamhin"), ("Hasimukh", "Shironamhin"), ("Bhule Jete Bolo", "Minar Rahman"),
      ("Ekdin Matir Bhitore Hobe Ghor", "Fakir Lalon Shah"), ("Khachar Bhitor Ochin Pakhi", "Fakir Lalon Shah"), ("Tumi Ashbe Bole", "Habib Wahid"),
      ("Moner Manush", "Habib Wahid"), ("Shonar Bangla Circus", "Chandrabindoo"), ("Bondhu Tumi", "Ayub Bachchu"), ("Shei Tumi", "Ayub Bachchu")),
    # Brazil
    L("pt", ("Ai Se Eu Te Pego", "Michel Teló"), ("Evidências", "Chitãozinho & Xororó"), ("Trem-Bala", "Ana Vilela"), ("Velha Infância", "Tribalistas"),
      ("Já Sei Namorar", "Tribalistas"), ("Exagerado", "Cazuza"), ("Tempo Perdido", "Legião Urbana"), ("Pais e Filhos", "Legião Urbana"),
      ("Eduardo e Mônica", "Legião Urbana"), ("Anna Júlia", "Los Hermanos"), ("Ainda Bem", "Marisa Monte"), ("Amor I Love You", "Marisa Monte"),
      ("Bem Que Se Quis", "Marisa Monte"), ("Garota de Ipanema", "Tom Jobim, Vinicius de Moraes"), ("Aquarela", "Toquinho"),
      ("Asa Branca", "Luiz Gonzaga"), ("Sozinho", "Caetano Veloso"), ("Leão", "Marília Mendonça"), ("Infiel", "Marília Mendonça"),
      ("Supera", "Marília Mendonça"), ("Erro Gostoso", "Simone Mendes"), ("Coração Cachorro", "Ávine Vinny, Matheus Fernandes"),
      ("Facas", "Diego & Victor Hugo, Bruno & Marrone"), ("Lisboa", "ANAVITÓRIA, Lenine"), ("Trevo (Tu)", "ANAVITÓRIA, Tiago Iorc"),
      ("Amei Te Ver", "Tiago Iorc"), ("Céu Azul", "Charlie Brown Jr."), ("Só os Loucos Sabem", "Charlie Brown Jr."),
      ("Mulher de Fases", "Raimundos"), ("Girl from Rio", "Anitta")),
    # South Korea
    L("ko", ("Spring Day", "BTS"), ("Boy With Luv", "BTS"), ("FAKE LOVE", "BTS"), ("Love Dive", "IVE"), ("I AM", "IVE"), ("Hype Boy", "NewJeans"),
      ("Ditto", "NewJeans"), ("APT.", "ROSÉ, Bruno Mars"), ("Kill This Love", "BLACKPINK"), ("DDU-DU DDU-DU", "BLACKPINK"),
      ("How You Like That", "BLACKPINK"), ("Pink Venom", "BLACKPINK"), ("Supernova", "aespa"), ("Next Level", "aespa"), ("Whiplash", "aespa"),
      ("Magnetic", "ILLIT"), ("Fancy", "TWICE"), ("TT", "TWICE"), ("Antifragile", "LE SSERAFIM"), ("Love wins all", "IU"), ("Blueming", "IU"),
      ("Celebrity", "IU"), ("Through the Night", "IU"), ("Love Poem", "IU"), ("Gangnam Style", "PSY"), ("Like JENNIE", "JENNIE"),
      ("Drowning", "WOODZ"), ("Small girl", "Lee Young Ji, D.O."), ("Every Day, Every Moment", "Paul Kim"), ("Eyes, Nose, Lips", "Taeyang"),
      ("Stay With Me", "Chanyeol, Punch")),
    # Malaysia
    L("ms", ("Teman Pengganti", "Black"), ("Gemuruh", "Faizal Tahir"), ("Sejati", "Wings"), ("Isabella", "Search"),
      ("Fantasia Bulan Madu", "Search"), ("Cindai", "Siti Nurhaliza"), ("Seluruh Cinta", "Siti Nurhaliza, Cakra Khan"),
      ("Ombak Rindu", "Hafiz Suip, Adira"), ("Pulang", "Insomniacks"), ("Gadis Melayu", "Jamal Abdillah"), ("Sedetik Lebih", "Anuar Zain"),
      ("Cinta Muka Buku", "Najwa Latif"), ("Mencari Alasan", "Exists"), ("Jampi", "Hael Husaini"), ("Kau Ilham Ku", "Man Bai"),
      ("Bidadari", "Iklim"), ("Suci Dalam Debu", "Iklim"), ("Kenangan Terindah", "Samsons"), ("Cinta Dalam Hati", "Ungu"),
      ("Hati Ini Telah Dilukai", "Mas Idayu"), ("Aku Cinta Padamu", "Siti Nurhaliza"), ("Lagu Untukmu", "Hafiz Suip"),
      ("Dia", "Anji"), ("Dealova", "Once"), ("Kekasih Bayangan", "Cakra Khan"), ("Mimpi", "Anggun"), ("Sampai Bila", "Hafiz Suip"),
      ("Terukir Di Bintang", "Yuna"), ("Penantian", "Armada"), ("Cahaya", "Tulus")),
    # Pakistan
    L("ur", ("Pasoori", "Ali Sethi, Shae Gill"), ("Kana Yaari", "Kaifi Khalil, Eva B, Abdul Wahab Bugti"), ("Tu Jhoom", "Naseebo Lal, Abida Parveen"),
      ("Afreen Afreen", "Rahat Fateh Ali Khan, Momina Mustehsan"), ("Tajdar-e-Haram", "Atif Aslam"), ("Dil Dil Pakistan", "Vital Signs"),
      ("Kahani Suno 2.0", "Kaifi Khalil"), ("Jhol", "Maanu, Annural Khalid"), ("Ishq", "Faheem Abdullah, Rauhan Malik"),
      ("Meri Zindagi Hai Tu", "Asim Azhar, Sahir Ali Bagga"), ("Ghalat Fehmi", "Asim Azhar"), ("Jo Tu Na Mila", "Asim Azhar"),
      ("Aadat", "Atif Aslam"), ("Woh Lamhe", "Atif Aslam"), ("Bol Hu", "Soch the Band, Hadiqa Kiani"), ("Jhoom", "Ali Zafar"),
      ("Sanson Ki Mala", "Nusrat Fateh Ali Khan"), ("Tumhe Dillagi", "Rahat Fateh Ali Khan"), ("Zaroori Tha", "Rahat Fateh Ali Khan"),
      ("Mere Humsafar", "Qurat-ul-Ain Balouch"), ("Dil Jalane Ki Baat Karte Ho", "Asim Azhar"), ("Laaree Chootee", "Call"),
      ("Sajni", "Jal"), ("Aankhon Ke Sagar", "Fuzon"), ("Yaaron", "Strings"), ("Duur", "Strings"), ("Chal Bulleya", "Rahat Fateh Ali Khan"),
      ("Mast Qalandar", "Abida Parveen"), ("Kya Bataun", "Hassan Raheem"), ("Peechay Hutt", "Hasan Raheem, Justin Bibis")),
    # Mexico
    L("es", ("Despacito", "Luis Fonsi, Daddy Yankee"), ("La Bachata", "Manuel Turizo"), ("Ella Baila Sola", "Eslabon Armado, Peso Pluma"),
      ("TQG", "KAROL G, Shakira"), ("Provenza", "KAROL G"), ("Si Antes Te Hubiera Conocido", "KAROL G"), ("La Bicicleta", "Carlos Vives, Shakira"),
      ("Amor Eterno", "Rocío Dúrcal"), ("La Incondicional", "Luis Miguel"), ("Ahora Te Puedes Marchar", "Luis Miguel"), ("El Triste", "José José"),
      ("Corazón Espinado", "Santana, Maná"), ("Rayando el Sol", "Maná"), ("Oye Mi Amor", "Maná"), ("Como La Flor", "Selena"),
      ("Bidi Bidi Bom Bom", "Selena"), ("Tusa", "KAROL G, Nicki Minaj"), ("DÁKITI", "Bad Bunny, Jhayco"), ("Tití Me Preguntó", "Bad Bunny"),
      ("DtMF", "Bad Bunny"), ("Me Porto Bonito", "Bad Bunny, Chencho Corleone"), ("Shakira: Bzrp Music Sessions, Vol. 53", "Bizarrap, Shakira"),
      ("Quevedo: Bzrp Music Sessions, Vol. 52", "Bizarrap, Quevedo"), ("un x100to", "Grupo Frontera, Bad Bunny"), ("Por Las Noches", "Peso Pluma"),
      ("Hey Mor", "Ozuna, Feid"), ("Me Gustas Tú", "Manu Chao"), ("Vivir Mi Vida", "Marc Anthony"), ("Bailando", "Enrique Iglesias"),
      ("Hasta la Raíz", "Natalia Lafourcade")),
    # Thailand
    L("th", ("ฝนตกไหม", "Three Man Down"), ("ถ้าเธอรักใครคนหนึ่ง", "Three Man Down"), ("ทางของฝุ่น", "Atom Chanakan"),
      ("ชู้ทางใจ", "Atom Chanakan"), ("ภาพจำ", "Pop Pongkool"), ("ดาว", "Pop Pongkool"), ("ทรงอย่างแบด", "Paper Planes"),
      ("เพื่อนเล่น ไม่เล่นเพื่อน", "Tilly Birds"), ("คิดฮอด", "Bodyslam"), ("ความรักทำให้คนตาบอด", "Bodyslam"), ("ขอบใจจริงๆ", "Bodyslam"),
      ("ใจเย็น", "Bowkylion"), ("กอดได้ไหม", "Bowkylion"), ("ซ่อนกลิ่น", "Palmy"), ("ลมหายใจของกันและกัน", "Atom Chanakan"),
      ("เธอคือของขวัญ", "Getsunova"), ("ไกลแค่ไหน คือ ใกล้", "Getsunova"), ("ความลับในใจ", "Potato"), ("รักติดไซเรน", "Paper Planes"),
      ("ROCKSTAR", "LISA"), ("LALISA", "LISA"), ("MONEY", "LISA"), ("New Woman", "LISA, ROSALÍA"), ("ทิ้งไว้กลางทาง", "Potato"),
      ("คนไม่เอาถ่าน", "Bodyslam"), ("วาฬเกยตื้น", "Getsunova"), ("ฤดูที่แตกต่าง", "Bodyslam"), ("แค่เพียงได้คิดถึงเธอ", "Clash"),
      ("ทุกอย่าง", "Scrubb"), ("เธอทำให้ฉันเสียใจ", "Musketeers")),
)
b.SONGS = [s for country in b.SONGS for s in country]

# A song counts as already in Lemody only when its title AND first singer match (titles alone
# collide across languages: "Dan", "Idol", "Lemon"…). Then the shared resolver runs as usual.
_skel = b.storage._skel
def _key(t, a):  # non-Latin titles (Thai…) have an empty skeleton, so they're compared as written
    t2 = _skel(t) or str(t or "").strip().lower()
    return t2 + "|" + _skel(str(a or "").split(",")[0].split("&")[0])[:6]
import json as _json
_have = _json.load(open(sys.argv[1]))
_keys = {_key(e.get("title"), e.get("artist")) for e in _have.values()} | {_key(f.get("title"), f.get("artist")) for f in b.storage.prepare_list()}
_orig = b.storage._skel
# the shared resolver compares skeletons too: let a non-Latin title stand for itself there as well
b.storage._skel = lambda x: _orig(x) or str(x or "").strip().lower()
b.SONGS = [x for x in b.SONGS if _key(x[0], x[1]) not in _keys]
if "--only" in sys.argv:  # e.g. --only th
    b.SONGS = [x for x in b.SONGS if x[2] == sys.argv[sys.argv.index("--only") + 1]]
b.main(sys.argv[1])
