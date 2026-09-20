/* ================= i18n (TR + EN) =================
   Kaynak-string çevirisi (gettext tarzı): iç mantık/veri hep TÜRKÇE kalır
   (mood etiketleri, korumalı liste adları, durum eşleşmeleri) — yalnız GÖSTERİMDE
   T() İngilizce'ye çevirir. Veri göçü yok; showToast(T(...)) ile Python toast'ları da
   çevrilir. Türkçe = kaynak (dict'te yoksa aynen döner).

   Şablon yedeği: exact anahtar yoksa değişken run'lar placeholder'a çevrilir —
   “...” -> {q}/{q2}..., sayı -> {n}/{n2}... — şablon aranır, değer geri konur.
   Örn: "5 şarkı" -> "{n} şarkı" -> "{n} songs" -> "5 songs";
        "“Foo” silinsin mi?" -> "“{q}” silinsin mi?" -> "Delete “{q}”?" -> "Delete “Foo”?". */
(function (g) {
  var LANGS = {
    en: {
      /* ---- üst bar / kenar çubuğu ---- */
      'Geri': 'Back', 'İleri': 'Forward', 'Ana Sayfa': 'Home', 'Ara': 'Search',
      'Efektler': 'Effects', 'Tema': 'Theme', 'Dil / Language': 'Language', 'Özel vurgu rengi': 'Custom accent color',
      'Müzik klasörünü tara': 'Scan music folder', 'Tara': 'Scan', 'İstatistikler': 'Statistics',
      'Kompakt mod (panelleri gizle)': 'Compact mode (hide panels)',
      'Klavye kısayolları (Ctrl+K komut paleti)': 'Keyboard shortcuts (Ctrl+K palette)',
      'Yedek al': 'Backup', '📚 Kitaplığın': '📚 Your Library', 'MP3 içe aktar': 'Import MP3',
      'Ekle': 'Add', 'Çalma listesi oluştur': 'Create playlist',
      '🔍 Kütüphanede ara': '🔍 Search library', 'Ne çalmak istiyorsun?': 'What do you want to play?',
      'Kütüphanem': 'My Library', 'Beğenilen Şarkılar': 'Liked Songs', 'İndirilenler': 'Downloads',
      '⚙ Akıllı Listeler': '⚙ Smart Playlists', 'Çalma Listeleri': 'Playlists',
      'Kütüphanendeki Şarkılar': 'Songs in your library',
      /* ---- player ---- */
      'Müzik Çalar Hazır': 'Player Ready', 'Beğen': 'Like', 'Görselleştirici': 'Visualizer',
      'Karıştır': 'Shuffle', 'Önceki': 'Previous', 'Oynat/Duraklat': 'Play/Pause',
      'Sonraki': 'Next', 'Tekrarla': 'Repeat',
      'Klip izle (internetten akış — indirme yok)': 'Watch clip (stream — no download)',
      'Karaoke — vokal azalt': 'Karaoke — reduce vocals', 'Ambiyans ışığı': 'Ambient light',
      'Kuyruk (Sıradaki)': 'Queue (Up next)', 'Şarkı Sözleri': 'Lyrics', 'Tam ekran': 'Fullscreen',
      'Çalınıyor paneli': 'Now-playing panel', 'Hız': 'Speed', 'Uyku zamanlayıcı': 'Sleep timer',
      'Sessize al': 'Mute', 'Ses (100+ = boost)': 'Volume (100+ = boost)', 'Yerel Parça': 'Local Track',
      'Yerel': 'Local', 'Ses:': 'Volume:', '(boost)': '(boost)',
      /* ---- home ---- */
      'İyi geceler': 'Good night', 'Günaydın': 'Good morning', 'İyi günler': 'Good afternoon',
      'İyi akşamlar': 'Good evening', 'Son çalınanlar': 'Recently played', 'Çalma Listelerin': 'Your Playlists',
      /* ---- playlist görünümü ---- */
      'Çalma listesi': 'Playlist', 'İsim & Kapak senkronu': 'Name & cover sync', 'Sırala': 'Sort',
      '↕ Sıra': '↕ Order', 'Ada göre': 'By name', 'Sanatçıya göre': 'By artist',
      'Süreye göre': 'By duration', 'En çok çalınan': 'Most played', 'Başlık': 'Title', 'Kaynak': 'Source',
      'Bu liste boş. Sağ üstten MP3 ekleyebilir veya YouTube’dan indirebilirsin.':
        'This list is empty. Add MP3s from the top-right or download from YouTube.',
      'Liste boş.': 'List is empty.', 'YouTube': 'YouTube',
      /* ---- track menü ---- */
      '▶ Çal': '▶ Play', '▶ Sıradaki çal': '▶ Play next', '➕ Sıraya ekle': '➕ Add to queue',
      '❤ Beğen': '❤ Like', '💔 Beğenmekten vazgeç': '💔 Unlike', '✏️ Künyeyi düzenle': '✏️ Edit metadata',
      '❌ Listeden kaldır': '❌ Remove from list', '📁 Dosya konumunu aç': '📁 Open file location',
      'Şu listeye ekle': 'Add to playlist', 'Künyeyi düzenle': 'Edit metadata', 'Şarkı adı': 'Song title',
      'Sanatçı': 'Artist',
      /* ---- playlist menü ---- */
      '🔀 Karıştırarak çal': '🔀 Shuffle play', '➕ Tümünü kuyruğa ekle': '➕ Add all to queue',
      '🧹 Tekrarları kaldır': '🧹 Remove duplicates', '📄 M3U dışa aktar': '📄 Export M3U',
      '📝 Açıklama düzenle': '📝 Edit description', '🖼 Kapak ayarla (URL)': '🖼 Set cover (URL)',
      '✏️ Yeniden adlandır': '✏️ Rename', '🗑 Listeyi sil': '🗑 Delete list',
      'Liste açıklaması': 'List description', 'Açıklama': 'Description', 'Kapak görsel URL': 'Cover image URL',
      'Listeyi yeniden adlandır': 'Rename list', 'Yeni ad': 'New name', 'Yeni çalma listesi': 'New playlist',
      'Liste adı': 'List name',
      /* ---- arama / indirme ---- */
      '🔎 YouTube’dan İndir': '🔎 Download from YouTube',
      'Üstteki kutuya yaz; anında kütüphanende arar, Enter → YouTube’dan indir.':
        'Type in the box above; it searches your library instantly, Enter → download from YouTube.',
      '☑ Tümünü Seç': '☑ Select all', '⬇ Seçilenleri İndir': '⬇ Download selected',
      'Hemen indir': 'Download now', 'İndirmeye eklendi': 'Added to downloads',
      'Toplu indirme için seç': 'Select for bulk download', 'Sonuç yok.': 'No results.',
      /* ---- efektler ---- */
      '🎛 Ekolayzır & Efektler': '🎛 Equalizer & Effects', 'Ekolayzır': 'Equalizer', 'Açık': 'On',
      '✏️ Özel': '✏️ Custom', '🤖 Oto': '🤖 Auto', '↺ Sıfırla (Flat)': '↺ Reset (Flat)',
      '🔊 Ses Eşitleme (Normalize)': '🔊 Loudness (Normalize)', '🏛 Ortam (Reverb Preset)': '🏛 Room (Reverb Preset)',
      '↺ Efektleri Sıfırla': '↺ Reset effects', '🌊 Odak Sesleri': '🌊 Focus Sounds', 'Seviye': 'Level',
      'Müzik olmadan da çalar — odaklanmak/uyumak için.': 'Plays even without music — to focus or sleep.',
      '🎚 Geçiş & Discord': '🎚 Transitions & Discord', '🎚 Crossfade (sn)': '🎚 Crossfade (s)',
      'Kapalı': 'Off', '▶ Boşluksuz Çalma (Gapless)': '▶ Gapless Playback',
      'Crossfade parçaları üst üste eritir; boşluksuz mod sınırda kesintisiz geçer (albüm/DJ setleri için).':
        'Crossfade blends tracks together; gapless mode joins seamlessly at the boundary (for albums/DJ sets).',
      '🎮 Discord Durumu (Rich Presence)': '🎮 Discord Status (Rich Presence)',
      'Discord Application Client ID': 'Discord Application Client ID',
      'discord.com/developers → uygulama oluştur → Application ID’yi buraya yapıştır. Discord açık olmalı.':
        'discord.com/developers → create an app → paste the Application ID here. Discord must be running.',
      'pypresence bu derlemede yok — Discord durumu devre dışı.':
        'pypresence is missing in this build — Discord status is disabled.',
      'Crossfade: {n} sn': 'Crossfade: {n} s', 'Crossfade kapalı': 'Crossfade off',
      'Boşluksuz çalma açık': 'Gapless playback on', 'Boşluksuz çalma kapalı': 'Gapless playback off',
      'Discord için önce Client ID girin (Ayarlar).': 'Enter a Client ID first (Settings) for Discord.',
      'Discord durumu açık': 'Discord status on', 'Discord durumu kapalı': 'Discord status off',
      '🎚 Preamp': '🎚 Preamp', '🔊 Bass Boost': '🔊 Bass Boost', '🎙 Karaoke (Vokal Azalt)': '🎙 Karaoke (Reduce Vocals)',
      '📣 Echo (Yankı)': '📣 Echo', '⏱ Echo Süresi': '⏱ Echo Time', '🔁 Echo Tekrarı': '🔁 Echo Feedback',
      '🏛 Reverb (Oda)': '🏛 Reverb (Room)', '🌀 8D Spatial': '🌀 8D Spatial',
      '🚫 Kapalı': '🚫 Off', '🌧 Yağmur': '🌧 Rain', '📻 Beyaz Gürültü': '📻 White Noise', '🟤 Kahverengi Gürültü': '🟤 Brown Noise',
      'Kapalı': 'Off', 'Oda': 'Room', 'Salon': 'Hall', 'Katedral': 'Cathedral', 'Stüdyo': 'Studio', 'Stadyum': 'Stadium',
      /* ---- sağ panel / çalınıyor ---- */
      'Çalan parça yok.': 'No track playing.', '🌊 Şarkı DNA’sı': '🌊 Song DNA', '🎛 Spektrogram': '🎛 Spectrogram',
      '📻 Radyo': '📻 Radio', '✂️ Kırp (A-B)': '✂️ Trim (A-B)', '📝 Sözler': '📝 Lyrics', 'Getir': 'Fetch',
      'Lyrica’dan zaman kodlu (senkron) söz getir': 'Fetch timed (synced) lyrics from Lyrica',
      'Düzenle': 'Edit', 'Kaydet': 'Save', '⏭ Sıradaki': '⏭ Up next',
      'Söz yok. ([mm:ss] ile zaman kodlu sözler desteklenir)': 'No lyrics. ([mm:ss] timed lyrics supported)',
      'Önce bir şarkı çal.': 'Play a song first.',
      'Bu şarkının sözü yok. Sağ paneldeki ✏️ ile ekleyebilirsin.': 'This song has no lyrics. Add them with ✏️ in the right panel.',
      /* ---- A-B döngü ---- */
      'A-B döngü kapalı': 'A-B loop off', 'B seç': 'pick B', 'Döngü:': 'Loop:', '🔁 A-B Döngü': '🔁 A-B Loop',
      'Şarkı DNA’sı — tıkla seç': 'Song DNA — click to seek',
      /* ---- kuyruk / stats ---- */
      '📋 Kuyruk': '📋 Queue', 'Kuyruğu temizle': 'Clear queue', 'Şimdi çalıyor': 'Now playing', 'Sıradakiler': 'Up next',
      'Kuyruk boş. Şarkı menüsünden “Sıraya ekle” diyebilirsin.': 'Queue is empty. Use “Add to queue” from a song menu.',
      '📊 İstatistikler': '📊 Statistics', 'Toplam parça': 'Total tracks', 'Dinleme süresi': 'Listening time',
      '⭐ En Çok Dinlenenler': '⭐ Most Played', 'Henüz yeterli veri yok. Biraz müzik çal!': 'Not enough data yet. Play some music!',
      /* ---- modallar / kısayollar ---- */
      'İptal': 'Cancel', 'Tamam': 'OK', 'Evet': 'Yes', 'Kapat': 'Close', '⌨ Klavye Kısayolları': '⌨ Keyboard Shortcuts',
      'Boşluk': 'Space', 'Oynat / Duraklat': 'Play / Pause', '10 sn geri / ileri': '10s back / forward',
      'Ses': 'Volume', 'Tekrar': 'Repeat', 'Sonraki / Önceki': 'Next / Previous', 'Arama': 'Search', 'Bu pencere': 'This window',
      /* ---- güncelleme ---- */
      'Güncelleme indiriliyor…': 'Downloading update…', 'Güncelleme hazır:': 'Update ready:',
      'kapatınca otomatik kurulacak.': 'will install automatically on close.', 'Şimdi yeniden başlat': 'Restart now',
      'Gizle (çıkışta yine de kurulur)': 'Dismiss (still installs on exit)',
      /* ---- karaoke menü ---- */
      '🎤 Vokal / Karaoke': '🎤 Vocals / Karaoke',
      'Enstrümantal — vokalleri ayır (htdemucs)': 'Instrumental — separate vocals (htdemucs)',
      'Akapella — sadece vokal (htdemucs)': 'A cappella — vocals only (htdemucs)',
      '⚡ Hızlı karaoke (anında · mid-side)': '⚡ Quick karaoke (instant · mid-side)',
      '✕ Kapat': '✕ Off', 'motor yok, hızlıya düşer': 'engine missing, falls back to quick',
      'Karaoke / vokal ayır (htdemucs)': 'Karaoke / separate vocals (htdemucs)',
      'Hızlı karaoke (mid-side) açık': 'Quick karaoke (mid-side) on',
      'Karaoke: enstrümantal (htdemucs) açık': 'Karaoke: instrumental (htdemucs) on',
      'Akapella: sadece vokal (htdemucs) açık': 'A cappella: vocals only (htdemucs) on', 'Karaoke': 'Karaoke',
      /* ---- klip ---- */
      'Büyüt': 'Expand', 'Klibi kapat': 'Close clip', 'Klip yok.': 'No clip.', 'Klip': 'Clip',
      'internetten akış · indirme yok': 'streaming · no download', 'Sözleri klibin üstünde göster': 'Show lyrics over the clip',
      'Sese geç': 'Back to audio', 'Klipten çık, müziğe dön': 'Exit clip, back to music',
      /* ---- akıllı listeler ---- */
      '🔥 En Çok Dinlenenler': '🔥 Most Played', '⚡ Enerjik': '⚡ Energetic', '🌙 Sakin': '🌙 Calm',
      '✨ Aydınlık': '✨ Bright', '▶ Hiç Çalınmayanlar': '▶ Never Played',
      'Bu akıllı listede henüz şarkı yok.': 'This smart playlist has no songs yet.',
      /* ---- mood (engine.py; sadece gösterim) ---- */
      '🎧 Dengeli': '🎧 Balanced', '🎵 Dengeli': '🎵 Balanced', '🔥 Güçlü': '🔥 Powerful',
      '🌙 Sakin': '🌙 Calm', '✨ Aydınlık': '✨ Bright',
      /* ---- komut paleti ---- */
      'Komut ara veya şarkı/liste bul…': 'Search a command or find a song/list…',
      '🏠 Ana Sayfa': '🏠 Home', '🔎 Ara': '🔎 Search', '🎛 Efektler': '🎛 Effects', '📊 İstatistikler': '📊 Statistics',
      '📋 Kuyruk': '📋 Queue', '🔄 Müzik Tara': '🔄 Scan Music', '➕ MP3 Ekle': '➕ Add MP3', '💾 Yedek Al': '💾 Backup',
      '⛶ Tam Ekran': '⛶ Fullscreen', '💡 Ambiyans Işığı': '💡 Ambient Light', '🎙 Karaoke': '🎙 Karaoke',
      '⌨ Kısayollar': '⌨ Shortcuts', '⏭ Sonraki': '⏭ Next', '⏮ Önceki': '⏮ Previous', '⏯ Oynat/Duraklat': '⏯ Play/Pause',
      /* ---- SLEEPS ---- */
      '⏰ Kapalı': '⏰ Off', '5 dk': '5 min', '15 dk': '15 min', '30 dk': '30 min', '60 dk': '60 min',
      /* ---- tema adları ---- */
      '🟢 Yeşil': '🟢 Green', '🟣 Mor': '🟣 Purple', '🟠 Turuncu': '🟠 Orange', '🌸 Pembe': '🌸 Pink',
      '⚪ Gümüş': '⚪ Silver', '🔵 Mavi': '🔵 Blue', '🔴 Kırmızı': '🔴 Red', '🩵 Turkuaz': '🩵 Teal',
      '🟡 Altın': '🟡 Gold', '🟣 Çivit': '🟣 Indigo', '🌹 Gül': '🌹 Rose', '💠 Camgöbeği': '💠 Cyan',
      /* ---- toast'lar (Python + JS, showToast T() ile çevirir) ---- */
      'Dosya bulunamadı (taşınmış olabilir).': 'File not found (it may have moved).',
      'Sıraya eklendi.': 'Added to queue.', 'Sıradaki olarak eklendi.': 'Added as next.',
      'Tüm liste kuyruğa eklendi.': 'Whole list added to queue.', 'Karışık çalma açık': 'Shuffle on',
      'Sıralı çalma': 'Sequential play', 'Tekrar açık': 'Repeat on', 'Tekrar kapalı': 'Repeat off',
      'Listeyi tekrarla': 'Repeat list', 'Parçayı tekrarla': 'Repeat track',
      'Ambiyans ışığı açık': 'Ambient light on', 'Ambiyans ışığı kapalı': 'Ambient light off',
      'Uyku zamanlayıcı kapalı.': 'Sleep timer off.', 'Uyku zamanı — durduruldu.': 'Sleep time — stopped.',
      'Bu parça zaten indirilmiş.': 'This track is already downloaded.', 'Sözler kaydedildi.': 'Lyrics saved.',
      'Uygun/yeni dosya bulunamadı.': 'No suitable/new files found.', 'Yeni şarkı bulunamadı.': 'No new songs found.',
      'Müzik klasörü taranıyor…': 'Scanning music folder…',
      'Playlist boş veya çözülemedi.': 'Playlist is empty or could not be resolved.',
      '📃 Playlist yükleniyor…': '📃 Loading playlist…',
      'Hiçbir şey seçmedin — istersen satıra tıklayıp tek tek de indirebilirsin.':
        'You selected nothing — you can also click a row to download one by one.',
      '⚡ Hızlı karaoke açık (mid-side)': '⚡ Quick karaoke on (mid-side)',
      '🎤 Karaoke — enstrümantal (vokal ayrıldı)': '🎤 Karaoke — instrumental (vocals removed)',
      '🎙 Akapella — sadece vokal': '🎙 A cappella — vocals only',
      '🎤 Vokaller ayrılıyor… (CPU, birkaç dk sürebilir)': '🎤 Separating vocals… (CPU, may take a few min)',
      'Stüdyo karaoke motoru yok — hızlı karaoke açıldı.': 'No studio karaoke engine — quick karaoke enabled.',
      '🎬 Klip görüntüsü hazırlanıyor…': '🎬 Preparing clip video…', 'Klip için şarkı adı gerekli.': 'A song name is needed for the clip.',
      'Klip görüntüsü oynatılamadı (kodek/ağ).': 'Clip video could not play (codec/network).',
      'Bu şarkının zaman kodlu sözü yok.': 'This song has no timed lyrics.',
      'Sözler klipte açık': 'Lyrics shown over clip', 'Sözler klipte kapalı': 'Lyrics hidden on clip',
      '🎵 Sözler aranıyor…': '🎵 Searching lyrics…', 'Sözler bulunamadı.': 'No lyrics found.',
      'Ruh haline göre renk: açık': 'Mood-based color: on', 'Ruh haline göre renk: kapalı': 'Mood-based color: off',
      'Güncelleme kuruluyor, birazdan yeniden açılacak…': 'Installing update, reopening shortly…',
      'İndiriliyor…': 'Downloading…', 'Dönüştürülüyor…': 'Converting…', 'Aranıyor…': 'Searching…',
      'İndirilen dosya bulunamadı.': 'Downloaded file not found.', 'Sonuç bulunamadı.': 'No results found.',
      'Parça': 'Track',
      /* ---- parametrik şablonlar ({n}=sayı, {q}=tırnaklı ad) ---- */
      '{n} şarkı': '{n} songs', '{n} kez': '{n} plays', 'Çalma listesi • {n} şarkı': 'Playlist • {n} songs',
      '{n} sonuç — satıra tıkla anında indir, ya da seçip toplu indir':
        '{n} results — click a row to download instantly, or select and bulk-download',
      '{n} parça indirme kuyruğuna eklendi.': '{n} tracks added to the download queue.',
      '📃 Playlist: {n} parça — seç ve indir.': '📃 Playlist: {n} tracks — select and download.',
      '{n} şarkı eklendi.': '{n} songs added.', '📻 Radyo: {n} benzer parça sıraya eklendi.': '📻 Radio: {n} similar tracks queued.',
      '{n} dk sonra duracak.': 'Will stop in {n} min.', '{n} sa {n2} dk': '{n}h {n2}min', '{n} dk': '{n} min',
      '“{q}” silinsin mi?': 'Delete “{q}”?',
      '“{q}” adları dosya adından temizlenip kapaklar yeniden çekilsin mi?': 'Clean “{q}” names from filenames and re-fetch covers?',
      'Kütüphanede “{q}” için sonuç yok.': 'No results for “{q}” in your library.',
      '“{q}” için Enter’a bas → YouTube’da {n} sonuç.': 'Press Enter for “{q}” → {n} results on YouTube.',
      '“{q}” aranıyor…': 'Searching “{q}”…', '“{q}” indirmeye eklendi.': '“{q}” added to downloads.',
      'İndiriliyor… {n}/{n2}': 'Downloading… {n}/{n2}'
    }
  };

  var LANG = 'tr';

  function t(s, params) {
    if (s == null) return s;
    var str = '' + s;
    var dict = LANGS[LANG];
    if (dict) {
      if (dict[str] != null) {
        str = dict[str];
      } else {
        var qs = [], ns = [];
        var key = str
          .replace(/“[^”]*”/g, function (m) { qs.push(m.slice(1, -1)); return qs.length === 1 ? '“{q}”' : '“{q' + qs.length + '}”'; })
          .replace(/\d+/g, function (m) { ns.push(m); return ns.length === 1 ? '{n}' : '{n' + ns.length + '}'; });
        if ((qs.length || ns.length) && dict[key] != null) {
          var out = dict[key];
          for (var i = 0; i < qs.length; i++) out = out.replace(i === 0 ? '{q}' : '{q' + (i + 1) + '}', qs[i]);
          for (var j = 0; j < ns.length; j++) out = out.replace(j === 0 ? '{n}' : '{n' + (j + 1) + '}', ns[j]);
          str = out;
        }
      }
    }
    if (params) str = str.replace(/\{(\w+)\}/g, function (m, k) { return params[k] != null ? params[k] : m; });
    return str;
  }

  function setLang(code) { LANG = (code === 'en') ? 'en' : 'tr'; }
  function getLang() { return LANG; }
  function langList() { return [['tr', 'Türkçe'], ['en', 'English']]; }

  // T = çeviri fonksiyonu (app.js'te 't' çoğu yerde yerel değişken olduğu için 'T')
  g.T = t; g.setLang = setLang; g.getLang = getLang; g.langList = langList;
})(window);
