import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { bootstrapAppearance } from './appearance';
import './styles.css';

bootstrapAppearance();

const container = document.getElementById('root');
if (!container) throw new Error('Renderer 缺少 #root 挂载节点');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
