import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import './index.css';
import App from './App.tsx';
import { DevUserProvider } from './auth/DevUserProvider';
import { ProjectsProvider } from './projects/ProjectsProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <DevUserProvider>
        <ProjectsProvider>
          <App />
        </ProjectsProvider>
      </DevUserProvider>
    </BrowserRouter>
  </StrictMode>
);
