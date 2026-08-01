import React from 'react';
import ReactDOM from 'react-dom/client';
import { EditorApp } from './editor/EditorApp';
import './styles/base.css';
import './styles/theme.css';
import './styles/editor.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <EditorApp />
  </React.StrictMode>,
);
