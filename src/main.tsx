import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, createServices } from './ui/App';
import './ui/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('No se encontró el elemento #root');

const services = createServices();

createRoot(root).render(
  <StrictMode>
    <App services={services} />
  </StrictMode>,
);
