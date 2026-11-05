# Güvenlik ve gizlilik

Mesaj metni ve yanıt alıntısı tarayıcıdaki Web Crypto API ile AES-256-GCM kullanılarak şifrelenir. Her işlemde bağımsız 96 bit nonce üretilir. Mesaj kimliği ve gönderen UID, kimlik doğrulamalı ek veriye bağlanır. Firebase yalnızca şifreli içerik ve gerekli metaveriyi saklar.

Ortak anahtar rastgele 256 bittir. Sunucuya gönderilmez, bağlantılara eklenmez, kaynak kodunda ya da tarayıcının kalıcı deposunda tutulmaz. Sayfa yenilendiğinde yeniden girilir. Anahtar kopyalanırsa panoda, indirilirse indirilen dosyada kalacağını unutmayın. Anahtar kaybolursa mesaj kurtarma yoktur. Anahtar değişimi için mevcut sohbetin üzerine yazılamaz.

Firebase Auth oturumu aynı tarayıcıda kalıcı olarak saklanır; uygulama, Firebase'in doğrulanmış giriş zamanından 24 saat sonra yeniden Google girişi ister. Tarayıcı kalıcı saklamayı engellerse sekme oturumu kullanılır. Bu, istemci oturum davranışıdır; sunucu tokenlarının zorla iptali değildir. Sohbet anahtarı yine bellekte kalır ve sayfa yenilendiğinde yeniden girilir. Yalnızca doğrulanmış ve özel sunucu izin listesinde olan Google hesapları veriye erişebilir. `private/access` belgesini uygulama okuyamaz veya değiştiremez; yönetici tarafından yönetilir. Gerçek e-posta adreslerini bu depoya eklemeyin.

Mesaj yazarı kendi mesajını düzenleyebilir veya silebilir; UID ve oluşturma zamanı değiştirilemez. Durum belgesine yalnızca sahibi yazabilir. Mesaj sorguları 50 belgeyle sınırlıdır. Başka koleksiyonlar varsayılan olarak kapalıdır. Son 50 mesaj canlı güncellenir; eski sayfalar yeniden açıldığında güncellenir.

Mesaj zamanları, gönderici kimlikleri, yazıyor ve okundu bilgileri şifrelenmez. Firebase ve GitHub ağ bağlantısı metaverilerini görebilir. Bu uygulama Signal protokolünü uygulamaz; ileri gizlilik, cihaz doğrulaması veya bağımsız güvenlik denetimi sağlamaz. Ortak anahtarı alan kişi, yetkili bir hesapla geçmiş mesajları da okuyabilir. Cihaz güvenliği ve yayınlanan kodun bütünlüğü güven sınırının parçasıdır.

GitHub hesabı ve Google hesabı için iki adımlı doğrulama kullanın. Yönetici anahtarı, servis hesabı dosyası veya erişim belirteci depoya eklenmemelidir. Firebase web yapılandırması herkese açıktır; veriyi sunucudaki kurallar korur. Google yönetici hesabı normal istemci kurallarının dışındadır.

Spark planı kullanım kotaları içerir. Yalnızca iki kullanıcı olsa da kota aşılabilir ve servis geçici olarak kullanılamayabilir. Bu proje ücretli Cloud Functions, dosya depolama ve SMS kullanmaz. Faturalandırma hesabı bağlamayın. Uygulamada dosya/ses/video gönderme veya uygulama kapalıyken anlık bildirim yoktur.

İsteğe bağlı e-posta bildirimleri ayrı ve özel Google Apps Script projesinde çalışır. Google hesabı yetkilendirmesi ve dakikalık tetikleyici kurulmadan etkin değildir. Kod yalnızca gönderici kimliği, mesaj zamanı, okunma zamanı ve özel bildirim ayarlarını ister; mesaj içerikleri veya şifreleme anahtarı e-postaya eklenmez. Gerçek gönderen e-posta adresi alıcıya görünür. Gönderim dakikalık kontrol, Google kotaları, spam filtreleri ve teslim gecikmeleri nedeniyle kesin zaman veya teslim garantisi vermez. Kod en fazla günde 50 bildirim dener; aynı okunmamış seri için tekrar bildirim üretmez. Gönderimden önce rezervasyon yapıldığından kesintide bir bildirim kaçabilir; belirsiz gönderim otomatik tekrarlanmaz.

Kurallar prototip olarak hazırlanmış, Firebase derleyicisinden ve yerel saldırı senaryosu testlerinden geçirilmiştir. Bu kontroller tüm güvenlik açıklarının bulunmuş olduğu anlamına gelmez.

Sekme ve ana ekran adı "Başlangıç" olarak nötr tutulur; okunmamış mesajlar sekme adını değiştirmez. Hızlı çıkış, bellekteki sohbet anahtarını, çözülen mesajları ve taslak metni temizleyip sohbeti kilitler; ardından `location.replace` ile YouTube ana sayfasını açar. Sayfadan ayrılmada anahtar temizlenir ve tarayıcı önbelleğinden geri yüklemede kilit yeniden uygulanır. Google oturumu bu işlemde kapatılmaz. Bu özellik önceki tarayıcı geçmişini silmez, alan adını değiştirmez ve ağ/cihaz izlemeyi engellemez.
