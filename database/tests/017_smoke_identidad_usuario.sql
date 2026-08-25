SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

PRINT '=========================================';
PRINT 'TEST 017 - IDENTIDAD DE USUARIO';
PRINT '=========================================';


/* ============================================================
   CASO 1
   DOS USUARIOS ACTIVOS CON EL MISMO EMAIL
   DEBE SER RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO seguridad.usuario
        (email, nombre)
    VALUES
        (N'test017.email@siei.local', N'Usuario Email A');

    INSERT INTO seguridad.usuario
        (email, nombre)
    VALUES
        (N'test017.email@siei.local', N'Usuario Email B');

    PRINT 'FAIL 1: SQL Server permitio dos usuarios activos con el mismo email.';

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    DECLARE @error1 NVARCHAR(4000) = ERROR_MESSAGE();

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    IF @error1 LIKE N'%UX_seg_usuario_email_activo%'
    BEGIN
        PRINT 'PASS 1: SQL Server rechazo dos usuarios activos con el mismo email.';
        PRINT 'Error esperado:';
        PRINT @error1;
    END
    ELSE
    BEGIN
        PRINT 'FAIL 1: se produjo un error distinto al esperado.';
        PRINT @error1;
    END

END CATCH;


/* ============================================================
   CASO 2
   EMAIL HISTORICO INACTIVO PUEDE REUTILIZARSE

   Esto permite conservar el usuario viejo sin bloquear
   una nueva cuenta activa.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO seguridad.usuario
    (
        email,
        nombre,
        activo
    )
    VALUES
    (
        N'test017.reuse@siei.local',
        N'Usuario Histórico',
        0
    );


    INSERT INTO seguridad.usuario
    (
        email,
        nombre,
        activo
    )
    VALUES
    (
        N'test017.reuse@siei.local',
        N'Usuario Nuevo',
        1
    );


    IF (
        SELECT COUNT(*)
        FROM seguridad.usuario
        WHERE email = N'test017.reuse@siei.local'
    ) <> 2
        THROW 53201,
        'FAIL: no se conservaron ambos registros de usuario.',
        1;


    IF (
        SELECT COUNT(*)
        FROM seguridad.usuario
        WHERE email = N'test017.reuse@siei.local'
          AND activo = 1
    ) <> 1
        THROW 53202,
        'FAIL: debe existir exactamente un usuario activo con ese email.',
        1;


    PRINT 'PASS 2: un email historico inactivo puede reutilizarse en un nuevo usuario activo.';

    ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL CASO 2.';
    PRINT ERROR_MESSAGE();

END CATCH;


/* ============================================================
   CASO 3
   MISMA IDENTIDAD EXTERNA EN DOS USUARIOS ACTIVOS
   DEBE SER RECHAZADO

   auth_issuer + auth_subject = identidad OIDC.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO seguridad.usuario
    (
        email,
        nombre,
        auth_issuer,
        auth_subject
    )
    VALUES
    (
        N'test017.auth1@siei.local',
        N'Usuario Auth A',
        N'https://login.test.siei.local',
        N'subject-017-001'
    );


    INSERT INTO seguridad.usuario
    (
        email,
        nombre,
        auth_issuer,
        auth_subject
    )
    VALUES
    (
        N'test017.auth2@siei.local',
        N'Usuario Auth B',
        N'https://login.test.siei.local',
        N'subject-017-001'
    );


    PRINT 'FAIL 3: SQL Server permitio duplicar una identidad externa activa.';

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    DECLARE @error3 NVARCHAR(4000) = ERROR_MESSAGE();

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    IF @error3 LIKE N'%UX_seg_usuario_auth_activo%'
    BEGIN
        PRINT 'PASS 3: SQL Server rechazo una identidad externa duplicada.';
        PRINT 'Error esperado:';
        PRINT @error3;
    END
    ELSE
    BEGIN
        PRINT 'FAIL 3: se produjo un error distinto al esperado.';
        PRINT @error3;
    END

END CATCH;


/* ============================================================
   CASO 4
   IDENTIDAD EXTERNA INCOMPLETA

   auth_issuer y auth_subject deben venir:
       ambos NULL
       o ambos informados.

   DEBE SER RECHAZADO.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO seguridad.usuario
    (
        email,
        nombre,
        auth_issuer,
        auth_subject
    )
    VALUES
    (
        N'test017.partial@siei.local',
        N'Usuario Auth Incompleto',
        N'https://login.test.siei.local',
        NULL
    );


    PRINT 'FAIL 4: SQL Server permitio una identidad externa incompleta.';

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    DECLARE @error4 NVARCHAR(4000) = ERROR_MESSAGE();

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    IF @error4 LIKE N'%CK_seg_usuario_auth_identity%'
    BEGIN
        PRINT 'PASS 4: SQL Server rechazo una identidad externa incompleta.';
        PRINT 'Error esperado:';
        PRINT @error4;
    END
    ELSE
    BEGIN
        PRINT 'FAIL 4: se produjo un error distinto al esperado.';
        PRINT @error4;
    END

END CATCH;


/* ============================================================
   CASO 5
   IDENTIDAD EXTERNA HISTORICA INACTIVA
   PUEDE REUTILIZARSE

   La cuenta antigua conserva historial.
   La nueva se convierte en la identidad activa.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO seguridad.usuario
    (
        email,
        nombre,
        auth_issuer,
        auth_subject,
        activo
    )
    VALUES
    (
        N'test017.oldauth@siei.local',
        N'Usuario Auth Histórico',
        N'https://login.test.siei.local',
        N'subject-017-002',
        0
    );


    INSERT INTO seguridad.usuario
    (
        email,
        nombre,
        auth_issuer,
        auth_subject,
        activo
    )
    VALUES
    (
        N'test017.newauth@siei.local',
        N'Usuario Auth Nuevo',
        N'https://login.test.siei.local',
        N'subject-017-002',
        1
    );


    IF (
        SELECT COUNT(*)
        FROM seguridad.usuario
        WHERE auth_issuer = N'https://login.test.siei.local'
          AND auth_subject = N'subject-017-002'
    ) <> 2
        THROW 53205,
        'FAIL: no quedaron los dos registros historico+nuevo.',
        1;


    IF (
        SELECT COUNT(*)
        FROM seguridad.usuario
        WHERE auth_issuer = N'https://login.test.siei.local'
          AND auth_subject = N'subject-017-002'
          AND activo = 1
    ) <> 1
        THROW 53206,
        'FAIL: debe existir una sola identidad externa activa.',
        1;


    PRINT 'PASS 5: una identidad externa historica inactiva puede reutilizarse.';

    ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL CASO 5.';
    PRINT ERROR_MESSAGE();

END CATCH;


PRINT '=========================================';
PRINT 'FIN TEST 017';
PRINT '=========================================';
