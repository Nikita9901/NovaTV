import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import './browser.css';
import { applyPrefs } from './prefs.js';

applyPrefs();

createRoot(document.getElementById('root')).render(<App />);
