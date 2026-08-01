import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/base.css';

export function PanelPlaceholder(): React.JSX.Element {
  return <main className="placeholder">Stream Panel</main>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PanelPlaceholder />
  </React.StrictMode>,
);
