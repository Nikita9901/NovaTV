import React, { useState } from 'react';

const LAYOUTS = {
  ru: ['1234567890', 'йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбю'],
  en: ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'],
};
const SYMBOLS = ['.', '/', ':', '-', '_', '@', '?', '=', '&', '.com', '.ru'];

// Экранная клавиатура для геймпада. Ничего не знает о том, куда вводит: сообщает о символах через колбэки.
export default function Osk({ onChar, onBackspace, onEnter, enterLabel = 'Готово', symbols = false }) {
  const [lang, setLang] = useState('en');
  const [upper, setUpper] = useState(false);
  const put = (ch) => onChar(upper ? ch.toUpperCase() : ch);
  return (
    <div className="osk wide-osk">
      {LAYOUTS[lang].map((row) => (
        <div key={row} className="row">
          {[...row].map((ch) => (
            <button key={ch} data-focusable data-key className="key" onClick={() => put(ch)}>
              {upper ? ch.toUpperCase() : ch}
            </button>
          ))}
        </div>
      ))}
      {symbols && (
        <div className="row">
          {SYMBOLS.map((s) => (
            <button key={s} data-focusable data-key className="key" onClick={() => onChar(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="row">
        <button data-focusable className="key wide" onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}>
          {lang === 'ru' ? 'RU → EN' : 'EN → RU'}
        </button>
        <button data-focusable className="key wide" onClick={() => setUpper((u) => !u)}>
          {upper ? 'ABC' : 'abc'}
        </button>
        <button data-focusable className="key wider" onClick={() => onChar(' ')}>
          пробел
        </button>
        <button data-focusable className="key wide" onClick={onBackspace}>
          ⌫
        </button>
        <button data-focusable className="key go" onClick={onEnter}>
          {enterLabel}
        </button>
      </div>
    </div>
  );
}
