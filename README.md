# İkimiz

Google hesabıyla giriş yapılan, iki kişilik özel mesajlaşma uygulaması. GitHub Pages arayüzü ve Firebase Authentication / Cloud Firestore arka ucu kullanır.

## Özellikler

- Mobil öncelikli Türkçe arayüz, açık/koyu görünüm, ana ekrana ekleme manifesti.
- Rastgele ortak anahtar ile tarayıcıda AES-256-GCM mesaj şifreleme.
- Anlık son 50 mesaj, önceki mesaj sayfaları, yüklenen metinlerde yerel arama.
- Mesaj yanıtlama, kendi mesajını düzenleme/silme, okundu/yazıyor durumu.
- İki doğrulanmış Google hesabına özel sunucu izin listesi.
- Sekme arka planda iki dakika kaldığında sohbeti kilitleme.
- Aynı tarayıcıda yaklaşık 24 saatte bir Google girişi; yazıyor bilgisi mesaj kutusu üzerinde.
- Özel Google Apps Script projesiyle isteğe bağlı nötr e-posta bildirimleri; kurulum için [notifications/README.md](notifications/README.md).
- Anahtar cihazda kalıcı olarak saklanmaz. Yenileme sonrası yeniden girilir.

## Geliştirme

Node.js 24.12 veya üzerini kullanın. `npm ci`, `npm run dev` ve `npm run build` komutlarıyla çalıştırın. Üretim çıktısı `dist/` klasörüne yazılır. `docs/`, GitHub Pages için aynı çıktının depoya eklenen kopyasıdır; kaynak değişiklikleri sonrası `npm run release` ile güncellenir.

`npm test` şifreleme testlerini çalıştırır. Firebase emülatörü olmadan güvenlik kuralları testleri açıkça atlanır. Tam kurallar testini `npx -y firebase-tools@latest emulators:exec --only firestore --project demo-ikimiz "npm test"` ile çalıştırın; Java 21 gerekir. Windows kullanıcı adında özel karakter varsa `JAVA_TOOL_OPTIONS` içinde `-Djdk.net.unixdomain.tmpdir=<ASCII-yol>` ayarlamak gerekebilir.

## Yayın ve ilk kullanım

GitHub Settings → Pages → Deploy from a branch → main → /docs → Save. Site kökü `/ikimiz/` olarak derlenir. Firebase Authentication içinde yayın alanı yetkilendirilmiş olmalıdır. Firebase kuralları ayrıca `npx -y firebase-tools@latest deploy --only firestore --project ikimiz-omurbektas-2026` ile yayınlanır; GitHub'a kod yüklemek kuralları otomatik değiştirmez.

İlk kişi Google hesabıyla giriş yapıp yeni anahtar oluşturur, anahtarı güvenle kaydeder ve kaydettiğini onaylayarak sohbeti açar. Diğer kişi aynı anahtarı özel bir yoldan alıp kendi izinli Google hesabıyla girer. Anahtar kaybolursa eski mesajlar kurtarılamaz. Anahtarı bu depoya, sorun kayıtlarına veya URL'lere yazmayın.

Gerçek iki hesapla giriş ve cihazlar arası gönderim son kullanıcı tarafından doğrulanmalıdır. Güvenlik sınırları ve mevcut kısıtlar için [SECURITY.md](SECURITY.md) dosyasını okuyun.

Hiçbir parola, özel şifreleme anahtarı, servis hesabı veya yönetici anahtarı kaynak koduna eklenmemelidir. Firebase web yapılandırması erişim yetkisi vermez; veri erişimini sunucudaki güvenlik kuralları belirler.
