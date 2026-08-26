import { Navigate, Route, Routes } from 'react-router-dom';

import { AppLayout } from './components/AppLayout';
import { ProjectsPage } from './pages/ProjectsPage';
import { InstrumentsListPage } from './pages/InstrumentsListPage';
import { InstrumentFormPage } from './pages/InstrumentFormPage';
import { InstrumentDetailPage } from './pages/InstrumentDetailPage';
import { SignalsListPage } from './pages/SignalsListPage';
import { SignalFormPage } from './pages/SignalFormPage';
import { SignalDetailPage } from './pages/SignalDetailPage';

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
        <Route path="/projects/:projectId/signals" element={<SignalsListPage />} />
        <Route path="/projects/:projectId/signals/new" element={<SignalFormPage />} />
        <Route
          path="/projects/:projectId/signals/:signalId"
          element={<SignalDetailPage />}
        />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
