import { Navigate, Route, Routes } from 'react-router-dom';

import { AppLayout } from './components/AppLayout';
import { ProjectsPage } from './pages/ProjectsPage';
import { InstrumentsListPage } from './pages/InstrumentsListPage';
import { InstrumentFormPage } from './pages/InstrumentFormPage';
import { InstrumentDetailPage } from './pages/InstrumentDetailPage';
import { PnidImportsPage } from './pages/PnidImportsPage';
import { PnidImportDetailPage } from './pages/PnidImportDetailPage';
import { SignalsListPage } from './pages/SignalsListPage';
import { SignalFormPage } from './pages/SignalFormPage';
import { SignalDetailPage } from './pages/SignalDetailPage';
import { EquipmentListPage } from './pages/EquipmentListPage';
import { EquipmentFormPage } from './pages/EquipmentFormPage';
import { EquipmentDetailPage } from './pages/EquipmentDetailPage';
import { RiosListPage } from './pages/RiosListPage';
import { RioDetailPage } from './pages/RioDetailPage';
import { SwitchesListPage } from './pages/SwitchesListPage';
import { SwitchDetailPage } from './pages/SwitchDetailPage';
import { BoxesListPage } from './pages/BoxesListPage';
import { BoxDetailPage } from './pages/BoxDetailPage';
import { CablesListPage } from './pages/CablesListPage';
import { CableDetailPage } from './pages/CableDetailPage';
import { ConnectionPointsListPage } from './pages/ConnectionPointsListPage';
import { RoutesListPage } from './pages/RoutesListPage';
import { RouteFormPage } from './pages/RouteFormPage';
import { RouteDetailPage } from './pages/RouteDetailPage';
import { LoopsListPage } from './pages/LoopsListPage';
import { ProjectMembersPage } from './pages/ProjectMembersPage';
import { ClientsPage } from './pages/ClientsPage';
import { UsersPage } from './pages/UsersPage';
import { OpenCatalogsPage } from './pages/OpenCatalogsPage';

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
          path="/projects/:projectId/instruments/pnid-imports"
          element={<PnidImportsPage />}
        />
        <Route
          path="/projects/:projectId/instruments/pnid-imports/:importId"
          element={<PnidImportDetailPage />}
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
        <Route path="/projects/:projectId/equipment" element={<EquipmentListPage />} />
        <Route path="/projects/:projectId/equipment/new" element={<EquipmentFormPage />} />
        <Route
          path="/projects/:projectId/equipment/:equipmentId"
          element={<EquipmentDetailPage />}
        />
        <Route path="/projects/:projectId/rios" element={<RiosListPage />} />
        <Route path="/projects/:projectId/rios/:rioId" element={<RioDetailPage />} />
        <Route path="/projects/:projectId/switches" element={<SwitchesListPage />} />
        <Route path="/projects/:projectId/switches/:switchId" element={<SwitchDetailPage />} />
        <Route path="/projects/:projectId/boxes" element={<BoxesListPage />} />
        <Route path="/projects/:projectId/boxes/:boxId" element={<BoxDetailPage />} />
        <Route path="/projects/:projectId/cables" element={<CablesListPage />} />
        <Route path="/projects/:projectId/cables/:cableId" element={<CableDetailPage />} />
        <Route
          path="/projects/:projectId/connection-points"
          element={<ConnectionPointsListPage />}
        />
        <Route path="/projects/:projectId/routes" element={<RoutesListPage />} />
        <Route path="/projects/:projectId/routes/new" element={<RouteFormPage />} />
        <Route path="/projects/:projectId/routes/:routeId" element={<RouteDetailPage />} />
        <Route path="/projects/:projectId/loops" element={<LoopsListPage />} />
        <Route path="/projects/:projectId/members" element={<ProjectMembersPage />} />
        <Route path="/admin/clients" element={<ClientsPage />} />
        <Route path="/admin/users" element={<UsersPage />} />
        <Route path="/admin/catalogs" element={<OpenCatalogsPage />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
