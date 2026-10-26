import React, { useState } from 'react';

// Сетка 12 × 4: все клавиши одного размера, ряды ровные. Лишние места занимают знаки, нужные для адресов.
const LAYOUTS = {
  en: ['1234567890-.', 'qwertyuiop@_', 'asdfghjkl/:?', 'zxcvbnm,=&+%'],
  ru: ['1234567890-.', 'йцукенгшщзхъ', 'фывапролджэ/', 'ячсмитьбю,?@'],
};
const SHORTCUTS = ['www.', '.com', '.ru', '.org'];

// Экранная клавиатура для геймпада. Ничего не знает о том, куда вводит: сообщает о символах через колбэки.
export default function Osk({ onChar, onBackspace, onEnter, enterLabel = 'Готово', symbols = false }) {
  const [lang, setLang] = useState('en');
  const [upper, setUpper] = useState(false);
  const put = (ch) => onChar(upper ? ch.toUpperCase() : ch);
  return (
    <div className="osk grid-osk">
      {symbols && (
        <div className="osk-short">
          {SHORTCUTS.map((s) => (
            <button key={s} data-focusable data-key className="key" onClick={() => onChar(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="osk-keys">
        {LAYOUTS[lang].flatMap((row) =>
          [...row].map((ch) => (
            <button key={row + ch} data-focusable data-key className="key" onClick={() => put(ch)}>
              {upper ? ch.toUpperCase() : ch}
            </button>
          )),
        )}
        <button data-focusable className="key s2" onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}>
          {lang === 'ru' ? 'RU → EN' : 'EN → RU'}
        </button>
        <button data-focusable className="key s2" onClick={() => setUpper((u) => !u)}>
          {upper ? 'ABC' : 'abc'}
        </button>
        <button data-focusable className="key s4 space" onClick={() => onChar(' ')}>
          пробел
        </button>
        <button data-focusable className="key s2" onClick={onBackspace}>
          ⌫
        </button>
        <button data-focusable className="key s2 go" onClick={onEnter}>
          {enterLabel}
        </button>
      </div>
    </div>
  );
}
