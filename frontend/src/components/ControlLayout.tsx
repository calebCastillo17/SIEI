import { NavLink, Outlet, useParams } from 'react-router-dom';

/**
 * Sub-navegación compartida de la sección CONTROL — reemplaza los 5-7
 * botones de "Ver X" / "Diseñar Y" que cada página de Control repetía en
 * su propia cabecera (crecieron uno por uno según se iba armando cada
 * pieza, hasta quedar imposibles de leer). Pedido explícito del usuario:
 * "no se entiende bien la separación entre cajas y gabinetes".
 *
 * La agrupación visual (Señales / Gabinetes / Cajas / Planos) es la
 * misma "ruta" de Control ya establecida en el resto de la sesión:
 * Gabinete/RIO -> Cajas -> Instrumento, con las dos caras (Hardware /
 * Conexionado) repetidas para Gabinetes y para Cajas — separarlas en dos
 * grupos con su propio rótulo es justo lo que responde a la confusión.
 *
 * Cada página hija (`<Outlet/>`) ya NO repite esta navegación en su
 * propia cabecera — solo conserva su botón "Actualizar" y lo que sea
 * específico de esa pantalla.
 */
export function ControlLayout() {
  const { projectId } = useParams<{ projectId: string }>();

  if (!projectId) return <p>Falta el proyecto en la URL.</p>;

  const base = `/projects/${projectId}/control`;

  return (
    <div className="control-shell">
      <nav className="control-nav">
        <div className="control-nav__group">
          <span className="control-nav__group-label">Señales</span>
          <NavLink to={`${base}/signals`} className="control-nav__link">
            Lista
          </NavLink>
          <NavLink to={`${base}/groups`} className="control-nav__link">
            Agrupaciones
          </NavLink>
        </div>

        <div className="control-nav__group control-nav__group--gabinetes">
          <span className="control-nav__group-label">Gabinetes</span>
          <NavLink to={base} end className="control-nav__link">
            Hardware
          </NavLink>
          <NavLink to={`${base}/conexionado`} className="control-nav__link">
            Conexionado
          </NavLink>
        </div>

        <div className="control-nav__group control-nav__group--cajas">
          <span className="control-nav__group-label">Paneles</span>
          <NavLink to={`${base}/cajas`} className="control-nav__link">
            Hardware
          </NavLink>
          <NavLink to={`${base}/conexionado-cajas`} className="control-nav__link">
            Conexionado
          </NavLink>
        </div>

        <div className="control-nav__group">
          <NavLink to={`${base}/ruteo`} className="control-nav__link control-nav__link--standalone">
            Ruteo
          </NavLink>
          <NavLink to={`${base}/planos`} className="control-nav__link control-nav__link--standalone">
            Planos
          </NavLink>
        </div>
      </nav>

      <div className="control-content">
        <Outlet />
      </div>
    </div>
  );
}
