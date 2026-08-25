declare global {
  namespace Express {
    interface Request {
      authUser?: {
        id: string;
        email: string;
        nombre: string;
        esAdminSistema: boolean;
      };

      projectAccess?: {
        projectId: string;
        codigoProyecto: string;
        role: 'ADMIN' | 'EDITOR' | 'VIEWER';

        permissions: {
          write: boolean;
          deactivate: boolean;
          administer: boolean;
        };
      };
    }
  }
}

export {};
