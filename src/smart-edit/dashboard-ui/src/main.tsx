import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Chart as ChartJS,
  ArcElement,
  BarElement,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Legend,
  Tooltip,
  Title,
  Filler
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';

import { App } from './App';
import './styles/dashboard.css';
import './styles/layout.css';
import './styles/forms.css';

ChartJS.register(
  ArcElement,
  BarElement,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Legend,
  Tooltip,
  Title,
  Filler,
  ChartDataLabels
);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
