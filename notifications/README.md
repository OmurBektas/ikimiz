# Özel e-posta bildirimleri

Bu klasördeki kod, GitHub Pages içinde çalışmaz. Sahibi tarafından yetkilendirilmiş, özel Google Apps Script projesinde çalıştırılır. Web uygulaması olarak herkese açık dağıtmayın.

## Davranış

- Önceki mesajdan bir saatten fazla sonra gelen ilk okunmamış mesaj için bildirim.
- Diğer konuşmalarda ilk okunmamış mesajdan yedi dakika sonra hatırlatma.
- Okunmuş veya yanıtlanmış mesajda hatırlatma yok.
- Aynı okunmamış seri için tek e-posta; bir saatlik yeni ara yeni bir seri başlatabilir.
- Kontrol dakikada bir yapılır. Zamanlama ve teslim kesin değildir.
- Konu/gönderen adı: **Güncelleme**. Metin: **Yeni bir güncelleme var.**
- Mesaj metni, anahtar ve site bağlantısı e-postada bulunmaz. Gerçek gönderen adresi görünür.
- Günlük 50 deneme sınırı ve Google hesabının kalan MailApp kotası uygulanır.
- İlk kurulum geçmiş mesajları bildirim yağmuruna dönüştürmez; yalnızca sonraki mesajları izler.

## Kurulum

1. `Code.gs` ve `appsscript.json` dosyalarını özel Apps Script projesine ekleyin.
2. `private/notification-settings` belgesini Firebase yöneticisi hazırlamalı: `enabled` boolean, `senderEmail` string, `recipients` map (yalnızca iki Firebase UID → e-posta), `subject`, `body`, `senderName` onaylı nötr metinleri. Bu belge istemciler için varsayılan olarak kapalıdır. Gerçek e-postaları kaynak koduna koymayın.
3. Bildirimi gönderecek ve Firebase projesine erişimi olan Google hesabıyla `installNotifications` çalıştırın. Google, veri erişimi ve e-posta gönderme iznini kullanıcıdan ister.
4. Yürütme günlüğünde başarılı kurulum görünmeli; tetikleyicilerde `pollNotifications` dakikalık olarak bulunmalı.
5. `pollNotifications` işlevini bir kez elle çalıştırıp hatasız tamamlandığını kontrol edin. Hiçbir mesajı tetiklemeyen bir kontrolde e-posta gönderilmez.

Kapatmak için `stopNotifications` çalıştırın veya özel Firebase ayarında `enabled:false` yapın. Yeniden kurulum mevcut durum kaydını korur ve ikinci bir tetikleyici oluşturmaz. `installNotifications` işlevini tekrar çalıştırmak güvenlidir.

Google varsayılan Cloud projesi API erişimi isterse, Google Apps Script projesinin GCP bağlantısı ve Firestore API erişimi ayrıca yapılandırılmalıdır. Ücretli faturalandırma hesabı bağlamayın. Apps Script yetkilendirmesi Firebase'in istemci kurallarından ayrı IAM erişimi kullanır; bu nedenle projeyi paylaşmayın.
