import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import {
  requireProjectPermission,
  type ProjectPermission
} from '../middleware/requireProjectPermission.js';

export const devAuthzRouter = Router();

devAuthzRouter.use(authenticate);


function response(permission: ProjectPermission) {
  return (req: Parameters<typeof devAuthzRouter.get>[1] extends never
    ? never
    : any, res: any) => {
    res.status(200).json({
      allowed: true,
      requestedPermission: permission,
      user: req.authUser,
      project: req.projectAccess
    });
  };
}


devAuthzRouter.get(
  '/projects/:projectId/read',
  requireProjectPermission('read'),
  response('read')
);

devAuthzRouter.post(
  '/projects/:projectId/write',
  requireProjectPermission('write'),
  response('write')
);

devAuthzRouter.post(
  '/projects/:projectId/deactivate',
  requireProjectPermission('deactivate'),
  response('deactivate')
);

devAuthzRouter.post(
  '/projects/:projectId/administer',
  requireProjectPermission('administer'),
  response('administer')
);
