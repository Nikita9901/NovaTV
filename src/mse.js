// Подача видео в <video> через MediaSource.
//
// Зачем: с обычным <video src="…"> браузер сам решает, когда читать поток, и через пару секунд закрывает соединение,
// чтобы «досчитать» с нужного байта запросом `Range: bytes=…`. Живой поток от ffmpeg так продолжить нельзя —
// воспроизведение на мгновение сбивалось (микрозависания), а запас буфера не превышал 2–3 секунд.
// Здесь поток читаем мы сами: один запрос, фрагменты добавляем в SourceBuffer и держим запас в минуту-две.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

// Конец блока moov: начальный сегмент (ftyp + moov) пришёл целиком. -1 — ещё нет.
function initEnd(buf) {
  let pos = 0;
  while (pos + 8 <= buf.length) {
    const size = ((buf[pos] << 24) | (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3]) >>> 0;
    const type = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);
    if (size < 8) return -1;
    if (type === 'moov') return pos + size <= buf.length ? pos + size : -1;
    pos += size;
  }
  return -1;
}

// Кодеки из начального сегмента: видео — по блоку avcC (профиль, совместимость, уровень), звук у нас всегда AAC-LC
function codecsOf(init) {
  let text = '';
  for (let i = 0; i < init.length; i++) text += String.fromCharCode(init[i]);
  const codecs = [];
  const i = text.indexOf('avcC');
  if (i >= 0) codecs.push(`avc1.${hex2(init[i + 5])}${hex2(init[i + 6])}${hex2(init[i + 7])}`);
  if (text.includes('mp4a')) codecs.push('mp4a.40.2');
  return codecs;
}

/**
 * Подключает поток по адресу url к элементу video.
 * @param {HTMLVideoElement} video
 * @param {string} url
 * @param {{ ahead?: number, onError?: (e: Error) => void }} opts  ahead — сколько секунд держать запас вперёд
 * @returns {{ stop: () => void }}
 */
export function attachStream(video, url, { ahead = 120, onError } = {}) {
  const ms = new MediaSource();
  const objectUrl = URL.createObjectURL(ms);
  const ctrl = new AbortController();
  let stopped = false;
  let sb = null;

  // Выполнить операцию над SourceBuffer и дождаться её окончания
  const op = (fn) =>
    new Promise((resolve, reject) => {
      const ok = () => {
        sb.removeEventListener('error', bad);
        resolve();
      };
      const bad = () => {
        sb.removeEventListener('updateend', ok);
        reject(new Error('SourceBuffer error'));
      };
      sb.addEventListener('updateend', ok, { once: true });
      sb.addEventListener('error', bad, { once: true });
      try {
        fn();
      } catch (e) {
        sb.removeEventListener('updateend', ok);
        sb.removeEventListener('error', bad);
        reject(e);
      }
    });

  const idle = () =>
    new Promise((resolve) => {
      if (!sb.updating) resolve();
      else sb.addEventListener('updateend', () => resolve(), { once: true });
    });

  // Выбрасываем уже просмотренное, чтобы не упереться в лимит памяти браузера
  const trimBehind = async (keep = 30) => {
    if (!sb || sb.updating || !video.buffered.length) return;
    const from = video.buffered.start(0);
    const to = video.currentTime - keep;
    if (to - from > 10) await op(() => sb.remove(from, to));
  };

  const append = async (chunk) => {
    try {
      await op(() => sb.appendBuffer(chunk));
    } catch (e) {
      if (e.name !== 'QuotaExceededError') throw e;
      await trimBehind(5);
      await op(() => sb.appendBuffer(chunk));
    }
  };

  let startFixed = false;
  // Поток может начинаться чуть позже нуля (например, с 0,08 с): подводим воспроизведение к началу данных
  const fixStart = () => {
    if (startFixed || !video.buffered.length) return;
    startFixed = true;
    const first = video.buffered.start(0);
    if (first > video.currentTime) video.currentTime = first;
  };

  ms.addEventListener(
    'sourceopen',
    async () => {
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.getReader();
        let head = new Uint8Array(0);

        for (;;) {
          const { done, value } = await reader.read();
          if (stopped) return;
          if (done) break;

          if (!sb) {
            head = concat(head, value);
            const end = initEnd(head);
            if (end < 0) continue; // начальный сегмент ещё не целиком
            sb = ms.addSourceBuffer(`video/mp4; codecs="${codecsOf(head.subarray(0, end)).join(',')}"`);
            await append(head);
            head = null;
          } else {
            await append(value);
            fixStart();
          }

          // Запаса хватает — не читаем дальше (ffmpeg тоже подождёт): так не копим лишнего в памяти
          while (!stopped) {
            const b = video.buffered;
            const end = b.length ? b.end(b.length - 1) : 0;
            if (end - video.currentTime < ahead) break;
            await sleep(500);
          }
          if (video.currentTime > 90) await trimBehind().catch(() => {});
        }

        if (!stopped && ms.readyState === 'open') {
          await idle();
          ms.endOfStream(); // после этого <video> корректно сообщит «ended»
        }
      } catch (e) {
        if (!stopped && e.name !== 'AbortError') onError?.(e);
      }
    },
    { once: true },
  );

  video.src = objectUrl;

  return {
    stop() {
      stopped = true;
      ctrl.abort();
      try {
        video.removeAttribute('src');
        video.load();
      } catch {
        /* элемент уже убран */
      }
      URL.revokeObjectURL(objectUrl);
    },
  };
}
