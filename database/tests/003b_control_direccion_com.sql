SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

DECLARE @proyecto_id BIGINT;
DECLARE @control_id BIGINT;
DECLARE @direccion_in_id BIGINT;
DECLARE @instrumento_id BIGINT;

SELECT @proyecto_id = id
FROM nucleo.proyecto
WHERE codigo_proyecto = N'TEST-001'
  AND activo = 1;

SELECT @control_id = id
FROM cat.cat_clase_senal
WHERE codigo = N'CONTROL';

SELECT @direccion_in_id = id
FROM cat.cat_direccion_com
WHERE codigo = N'IN';

PRINT '=========================================';
PRINT 'TEST 003B - CONTROL + DIRECCION COM';
PRINT '=========================================';

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-TEST-003B', N'Prueba trigger CONTROL');

    SET @instrumento_id = SCOPE_IDENTITY();

    /*
      Dejamos tipo_io_id = NULL y canal_id = NULL
      intencionalmente para no activar
      CK_senal_tipo_io_direccion_excl.

      Queremos comprobar específicamente que
      TR_senal_validar_clase rechace direccion_com_id
      para una señal CONTROL.
    */

    INSERT INTO nucleo.senal
    (
        proyecto_id,
        instrumento_id,
        clase_senal_id,
        direccion_com_id,
        tag_senal,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        @instrumento_id,
        @control_id,
        @direccion_in_id,
        N'PIT-TEST-003B.TEST',
        N'CONTROL con direccion COM'
    );

    PRINT 'FAIL: CONTROL + DIRECCION_COM fue permitido.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS: CONTROL + DIRECCION_COM fue rechazado.';
    PRINT 'Error esperado:';
    PRINT ERROR_MESSAGE();

END CATCH;
