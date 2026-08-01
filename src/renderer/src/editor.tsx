import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/base.css';

export function EditorPlaceholder(): React.JSX.Element {
  return <main className="placeholder">Stream Panel 편집기</main>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <EditorPlaceholder />
  </React.StrictMode>,
);
