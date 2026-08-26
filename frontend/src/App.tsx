import { Navigate, Route, Routes } from 'react-router-dom';

import { AppLayout } from './components/AppLayout';
import { ProjectsPage } from './pages/ProjectsPage';
import { InstrumentsListPage } from './pages/InstrumentsListPage';
import { InstrumentFormPage } from './pages/InstrumentFormPage';
import { InstrumentDetailPage } from './pages/InstrumentDetailPage';

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route
          path="/projects/:projectId/instruments"
          element={<InstrumentsListPage />}
        />
        <Route
          path="/projects/:projectId/instruments/new"
          element={<InstrumentFormPage />}
        />
        <Route
          path="/projects/:projectId/instruments/:instrumentId"
          element={<InstrumentDetailPage />}
        />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
