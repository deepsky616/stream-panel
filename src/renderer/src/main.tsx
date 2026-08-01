import React from 'react';
import ReactDOM from 'react-dom/client';
import { PanelApp } from './panel/PanelApp';
import './styles/base.css';
import './styles/theme.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PanelApp />
  </React.StrictMode>,
);
