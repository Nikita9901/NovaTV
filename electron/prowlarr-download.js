// Где взять архив Prowlarr. Сначала официальная лента обновлений, а если она недоступна или вместо данных
// отдала страницу-заглушку (бывает за защитой сайта или в некоторых сетях), — GitHub.
const HEADERS = { 'User-Agent': 'NovaTV', Accept: 'application/json' };
const FROM_GITHUB = /^https:\/\/github\.com\/Prowlarr\/Prowlarr\/releases\//;

async function getJson(fetchFn, url) {
  const res = await fetchFn(url, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} ответил ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${new URL(url).host} вернул не данные, а веб-страницу`);
  }
}

// Имя архива для этой системы: Windows — zip, остальные — tar.gz
const assetPattern = (os, arch) => (os === 'windows' ? /\.windows-core-x64\.zip$/ : new RegExp(`\\.${os}-core-${arch}\\.tar\\.gz$`));

async function resolveDownload(fetchFn, { os, arch, feedUrl }) {
  const problems = [];

  try {
    const feed = await getJson(fetchFn, feedUrl);
    const url = feed?.[0]?.url;
    if (url && FROM_GITHUB.test(url)) return { url, version: feed[0].version, source: 'servarr' };
    problems.push('лента обновлений не содержит ссылку на загрузку');
  } catch (e) {
    problems.push(e.message);
  }

  try {
    const rel = await getJson(fetchFn, 'https://api.github.com/repos/Prowlarr/Prowlarr/releases/latest');
    const asset = (rel.assets || []).find((a) => assetPattern(os, arch).test(a.name));
    if (asset && FROM_GITHUB.test(asset.browser_download_url)) {
      return { url: asset.browser_download_url, version: String(rel.tag_name || '').replace(/^v/, ''), source: 'github' };
    }
    problems.push('на GitHub не нашлось архива для этой системы');
  } catch (e) {
    problems.push(e.message);
  }

  throw new Error(`Не удалось узнать, откуда скачать Prowlarr (${problems.join('; ')}). Проверьте интернет и VPN или выберите «Свой» Prowlarr.`);
}

module.exports = { resolveDownload };
