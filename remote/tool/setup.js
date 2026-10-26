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

// Шаблонный тест от `flutter create` ссылается на несуществующий MyApp: он нам не нужен
fs.rmSync(path.join(__dirname, '..', 'test', 'widget_test.dart'), { force: true });

if (xml !== before) {
  fs.writeFileSync(file, xml);
  console.log('AndroidManifest.xml обновлён');
} else {
  console.log('AndroidManifest.xml уже в порядке');
}
