// Настройки интерфейса, которые хранятся в самом окне (localStorage), а не в settings.json

export const motionOn = () => localStorage.getItem('motion') !== '0';

// Выключенные анимации включают класс no-motion на корневом элементе (см. styles.css)
export function setMotion(on) {
  localStorage.setItem('motion', on ? '1' : '0');
  document.documentElement.classList.toggle('no-motion', !on);
}

export const applyPrefs = () => document.documentElement.classList.toggle('no-motion', !motionOn());
