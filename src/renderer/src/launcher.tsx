import React from 'react';
import ReactDOM from 'react-dom/client';
import { LauncherApp } from './launcher/LauncherApp';
import './styles/theme.css';
import './styles/launcher.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LauncherApp />
  </React.StrictMode>,
);
