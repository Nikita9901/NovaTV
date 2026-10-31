// Общие значки макетов: линейные, 24×24, как в приложении
window.ICONS = {
  home: '<path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1z"/>',
  play: '<rect x="2.5" y="5" width="19" height="14" rx="4.5"/><path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7.5 4v16M16.5 4v16M3 9h4.5M3 15h4.5M16.5 9H21M16.5 15H21"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3.2 3.2 3.2 14.8 0 18M12 3c-3.2 3.2-3.2 14.8 0 18"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  power: '<path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>',
  gamepad: '<path d="M7 8.5h10a4 4 0 0 1 3.9 4.9l-.6 2.6a2.3 2.3 0 0 1-4 1L15 15.5H9L7.7 17a2.3 2.3 0 0 1-4-1l-.6-2.6A4 4 0 0 1 7 8.5z"/><path d="M8.5 11v3M7 12.5h3"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2.5"/><path d="M8 20h8"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z" fill="currentColor" stroke="none"/>',
};
window.ic = (n) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${window.ICONS[n]}</svg>`;
