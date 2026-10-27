// Только Linux: подменяем запускной файл небольшим скриптом.
//
// Electron на Linux не запускается, если в системе нельзя включить «песочницу» Chromium: в AppImage нет права
// setuid у chrome-sandbox, а Ubuntu 24.04 и новее по умолчанию запрещают непривилегированные пользовательские
// пространства имён. Тогда приложение закрывается сразу после запуска без единого сообщения. Скрипт проверяет, работает ли
// песочница, и только если нет, добавляет --no-sandbox. Там, где песочница возможна, она остаётся включённой.
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;
  const name = context.packager.executableName;
  const exe = path.join(context.appOutDir, name);
  if (!fs.existsSync(exe)) throw new Error(`afterPack: не найден ${exe}`);

  fs.renameSync(exe, `${exe}.bin`);
  fs.writeFileSync(
    exe,
    `#!/bin/sh
# Запуск Nova TV: включаем --no-sandbox только там, где песочница Chromium работает неправильно
DIR="$(dirname "$(readlink -f "$0")")"
FLAGS=""
if [ ! -u "$DIR/chrome-sandbox" ] && ! unshare --user --map-root-user true >/dev/null 2>&1; then
  FLAGS="--no-sandbox"
fi
exec "$DIR/${name}.bin" $FLAGS "$@"
`,
  );
  fs.chmodSync(exe, 0o755);
};
