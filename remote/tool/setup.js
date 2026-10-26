// Дописывает в созданный `flutter create` манифест Android всё, что нужно приложению:
// доступ в сеть, обычное (не TLS) соединение с компьютером в домашней сети и название «Nova TV Remote».
// Запуск: node tool/setup.js (из папки remote/)
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (!fs.existsSync(file)) {
  console.error('Не найден', file, '\nСначала выполните в папке remote/: flutter create --platforms=android --project-name=novatv_remote --org=com.novatv .');
  process.exit(1);
}

let xml = fs.readFileSync(file, 'utf8');
const before = xml;

if (!xml.includes('android.permission.INTERNET')) {
  xml = xml.replace('<application', '<uses-permission android:name="android.permission.INTERNET"/>\n    <application');
}
if (!xml.includes('usesCleartextTraffic')) {
  xml = xml.replace('<application', '<application\n        android:usesCleartextTraffic="true"');
}
xml = xml.replace(/android:label="[^"]*"/, 'android:label="Nova TV Remote"');

// Подпись релизной сборки. Если заданы переменные NOVATV_KEYSTORE, NOVATV_KEYSTORE_PASSWORD и NOVATV_KEY_ALIAS,
// APK подписывается постоянным ключом (так каждая новая версия ставится поверх предыдущей).
// Без них остаётся отладочная подпись: годится для проверки, но у каждого компьютера она своя, и такие APK не ставятся друг поверх друга.
const gradle = path.join(__dirname, '..', 'android', 'app', 'build.gradle.kts');
if (fs.existsSync(gradle)) {
  let g = fs.readFileSync(gradle, 'utf8');
  if (!g.includes('NOVATV_KEYSTORE')) {
    g = g.replace(
      /(\s*)buildTypes \{/,
      `$1signingConfigs {
        create("novatv") {
            val ks = System.getenv("NOVATV_KEYSTORE")
            if (ks != null) {
                storeFile = file(ks)
                storePassword = System.getenv("NOVATV_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("NOVATV_KEY_ALIAS")
                keyPassword = System.getenv("NOVATV_KEYSTORE_PASSWORD")
            }
        }
    }
$1buildTypes {`,
    );
    g = g.replace(
      'signingConfig = signingConfigs.getByName("debug")',
      'signingConfig = if (System.getenv("NOVATV_KEYSTORE") != null) signingConfigs.getByName("novatv") else signingConfigs.getByName("debug")',
    );
    fs.writeFileSync(gradle, g);
    console.log('build.gradle.kts: подпись настроена');
  }
}

// Шаблонный тест от `flutter create` ссылается на несуществующий MyApp: он нам не нужен
fs.rmSync(path.join(__dirname, '..', 'test', 'widget_test.dart'), { force: true });

if (xml !== before) {
  fs.writeFileSync(file, xml);
  console.log('AndroidManifest.xml обновлён');
} else {
  console.log('AndroidManifest.xml уже в порядке');
}
