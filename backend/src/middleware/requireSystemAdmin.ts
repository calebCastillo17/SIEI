import type { NextFunction, Request, Response } from 'express';

/*
 * Para recursos que NO son por-proyecto (catálogos globales en el schema
 * `cat`): aquí no aplica seguridad.vw_acceso_proyecto, así que la única
 * autorización posible es es_admin_sistema — el administrador global del
 * sistema (ver CLAUDE.md, sección "Security model"). No existe un "ADMIN de
 * catálogo" por proyecto: estos datos son compartidos por todos los
 * proyectos.
 */
export function requireSystemAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const user = req.authUser;

  if (!user) {
    res.status(401).json({
      error: 'unauthorized',
      message: 'Authentication is required.'
    });
    return;
  }

  if (!user.esAdminSistema) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Only a system administrator can manage system-wide catalogs.'
    });
    return;
  }

  next();
}
