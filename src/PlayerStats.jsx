import React, { useEffect, useRef, useState } from 'react';

const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

// Статистика воспроизведения по клавише I: помогает понять, откуда рывки (экран, декодер, сеть или раскладка кадров)
export default function PlayerStats({ video, mode, net }) {
  const [s, setS] = useState(null);
  const acc = useRef({ raf: [], shown: [], missed: 0 });

  useEffect(() => {
    const v = video.current;
    let alive = true;
    let rafId;
    let last = performance.now();
    let lastShown = null;
    let lastPresented = 0;
    let lastMedia = null;
    const a = acc.current;
    const raf = (t) => {
      a.raf.push(t - last);
      last = t;
      if (a.raf.length > 240) a.raf.shift();
      if (alive) rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);
    // Реальные моменты показа кадров (там, где браузер это умеет)
    const onFrame = (now, meta) => {
      if (lastPresented && meta.presentedFrames - lastPresented > 1) a.missed += meta.presentedFrames - lastPresented - 1;
      lastPresented = meta.presentedFrames;
      if (lastShown != null) a.shown.push(meta.expectedDisplayTime - lastShown);
      lastShown = meta.expectedDisplayTime;
      if (lastMedia != null && meta.mediaTime > lastMedia) a.fps = 1 / (meta.mediaTime - lastMedia);
      lastMedia = meta.mediaTime;
      if (a.shown.length > 240) a.shown.shift();
      if (alive) v.requestVideoFrameCallback?.(onFrame);
    };
    v?.requestVideoFrameCallback?.(onFrame);

    const id = setInterval(() => {
      const vv = video.current;
      if (!vv) return;
      const period = median(a.raf) || 16.7;
      const hz = 1000 / period;
      const fps = a.fps || 0;
      const ratio = fps ? hz / fps : 0;
      // Ровно ли кадры ложатся на обновления экрана: 24 кадра/с на 60 Гц — 2,5 обновления на кадр (ритм 3:2), на 120 Гц — ровно 5
      const even = ratio && Math.abs(ratio * 2 - Math.round(ratio * 2)) < 0.03;
      const hist = { 1: 0, 2: 0, 3: 0, '4+': 0 };
      for (const d of a.shown) {
        const n = Math.max(1, Math.round(d / period));
        hist[n >= 4 ? '4+' : n]++;
      }
      const q = vv.getVideoPlaybackQuality?.() || { totalVideoFrames: 0, droppedVideoFrames: 0 };
      setS({ hz, fps, ratio, even, hist, missed: a.missed, q, w: vv.videoWidth, h: vv.videoHeight });
    }, 500);
    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
      clearInterval(id);
    };
  }, [video]);

  if (!s) return null;
  const total = Object.values(s.hist).reduce((n, x) => n + x, 0) || 1;
  const pct = (k) => Math.round((s.hist[k] / total) * 100);
  return (
    <div className="pstats">
      <div>
        <b>Видео</b> {s.w}×{s.h} · {s.fps ? s.fps.toFixed(2) : '…'} к/с · режим {mode}
      </div>
      <div>
        <b>Экран</b> {s.hz.toFixed(1)} Гц · обновлений на кадр {s.ratio ? s.ratio.toFixed(2) : '…'}{' '}
        <span className={s.even ? 'ok' : 'bad'}>{s.even ? 'ровная раскладка' : 'неровная раскладка: рывки'}</span>
      </div>
      <div>
        <b>Кадры</b> пропущено декодером {s.q.droppedVideoFrames} из {s.q.totalVideoFrames} · пропущено показом {s.missed}
      </div>
      <div>
        <b>Время показа кадра</b> 1 об.: {pct(1)}% · 2: {pct(2)}% · 3: {pct(3)}% · 4+: {pct('4+')}%
      </div>
      {net && (
        <div>
          <b>Сеть</b> запас {Math.round(net.aheadSec)} с · ↓{(net.speed / 1e6).toFixed(1)} МБ/с · пиров {net.peers}
        </div>
      )}
    </div>
  );
}
