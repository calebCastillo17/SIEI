import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams } from 'react-router-dom';

import { useDevUser } from '../auth/DevUserContext';
import { useProjects } from '../projects/ProjectsContext';
import { getSitio, createSitio, updateSitio } from '../api/sitios';
import { useAsyncData } from '../lib/useAsyncData';
import type { Sitio, SitioInput } from '../api/types';
import { ErrorMessage } from '../components/ErrorMessage';

const CAMPOS_NUMERICOS: Array<[keyof SitioInput, string]> = [
  ['altitudMsnm', 'Altitud (m.s.n.m.)'],
  ['tempMinC', 'Temp. mínima (°C)'],
  ['tempMaxC', 'Temp. máxima (°C)'],
  ['humedadRelativaPct', 'Humedad relativa (%)']
];
const CAMPOS_TEXTO: Array<[keyof SitioInput, string]> = [
  ['medioAmbiente', 'Medio ambiente'],
  ['cicloTrabajo', 'Ciclo de trabajo'],
  ['clasificacionArea', 'Clasificación de área']
];

/** nucleo.sitio (migración 030) — 1:1 con el proyecto, sin `activo`
 * (mismo criterio que proyecto_documentacion): siempre hay a lo sumo un
 * formulario, nunca una lista. */
export function SitioPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { devUser } = useDevUser();
  const { findProject } = useProjects();

  const project = findProject(projectId);
  const canWrite = project?.access.permissions.write ?? false;

  const fetchSitio = useCallback(() => {
    if (!projectId) return Promise.resolve<Sitio | null>(null);
    return getSitio(projectId, devUser.email).then((r) => r.sitio);
  }, [projectId, devUser.email]);
  const { data: sitio, loading, error: loadError, refresh } = useAsyncData<Sitio | null>(fetchSitio);

  const [valores, setValores] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<Error | null>(null);

  useEffect(() => {
    if (sitio) {
      setValores({
        altitudMsnm: sitio.altitudMsnm?.toString() ?? '',
        tempMinC: sitio.tempMinC?.toString() ?? '',
        tempMaxC: sitio.tempMaxC?.toString() ?? '',
        humedadRelativaPct: sitio.humedadRelativaPct?.toString() ?? '',
        medioAmbiente: sitio.medioAmbiente ?? '',
        cicloTrabajo: sitio.cicloTrabajo ?? '',
        clasificacionArea: sitio.clasificacionArea ?? ''
      });
    }
  }, [sitio]);

  if (!projectId) return <p>Falta el proyecto en la URL.</p>;

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    const body: Partial<SitioInput> = {
      altitudMsnm: valores.altitudMsnm ? Number(valores.altitudMsnm) : null,
      tempMinC: valores.tempMinC ? Number(valores.tempMinC) : null,
      tempMaxC: valores.tempMaxC ? Number(valores.tempMaxC) : null,
      humedadRelativaPct: valores.humedadRelativaPct ? Number(valores.humedadRelativaPct) : null,
      medioAmbiente: valores.medioAmbiente?.trim() || null,
      cicloTrabajo: valores.cicloTrabajo?.trim() || null,
      clasificacionArea: valores.clasificacionArea?.trim() || null
    };
    try {
      if (sitio) {
        await updateSitio(projectId!, body, devUser.email);
      } else {
        await createSitio(projectId!, body, devUser.email);
      }
      refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err : new Error('Error desconocido.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Sitio</h1>
          {project && <p className="page-subtitle">Proyecto {project.code} — {project.name} · condiciones ambientales, únicas por proyecto</p>}
        </div>
      </div>

      <ErrorMessage error={loadError ?? saveError} />
      {loading && <p>Cargando…</p>}

      {!loading && (
        <form className="form" onSubmit={handleSave}>
          {CAMPOS_NUMERICOS.map(([key, label]) => (
            <label key={key} className="form__field">
              <span>{label}</span>
              <input
                type="number"
                step="any"
                disabled={!canWrite || saving}
                value={valores[key] ?? ''}
                onChange={(e) => setValores((prev) => ({ ...prev, [key]: e.target.value }))}
              />
            </label>
          ))}
          {CAMPOS_TEXTO.map(([key, label]) => (
            <label key={key} className="form__field form__field--wide">
              <span>{label}</span>
              <input
                type="text"
                maxLength={key === 'medioAmbiente' ? 300 : key === 'cicloTrabajo' ? 200 : 100}
                disabled={!canWrite || saving}
                value={valores[key] ?? ''}
                onChange={(e) => setValores((prev) => ({ ...prev, [key]: e.target.value }))}
              />
            </label>
          ))}
          <div className="form__actions">
            <button type="submit" className="button" disabled={!canWrite || saving}>
              {saving ? 'Guardando…' : sitio ? 'Guardar cambios' : 'Crear sitio'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
