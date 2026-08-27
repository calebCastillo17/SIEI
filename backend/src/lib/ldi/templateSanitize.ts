import JSZip from 'jszip';

/**
 * Limpia, ANTES de que exceljs cargue el paquete, contenido heredado que
 * no tiene ninguna relación con el LDI: la plantilla oficial vigente
 * (reference_excel/Lista_instrumentos_plantilla.xlsx) fue armada copiando
 * las hojas Carátula/Hoja1 desde un libro maestro de ingeniería mucho más
 * grande — se confirmó inspeccionando el paquete real que arrastra ~1470
 * rangos con nombre (PERNO, VIGA, TUBERIA, SISTEMA, etc. — cálculos
 * estructurales/mecánicos ajenos) y 53 vínculos a libros externos
 * (`xl/externalLinks/externalLink1.xml`..`53.xml`), ninguno usado por
 * ninguna celda que el LDI escriba o lea.
 *
 * exceljs no reescribe ese contenido de forma completa al guardar el
 * paquete (dijimos esto ya en `normalizeNamespacedXlsx` para otro
 * problema de exceljs: no es la primera vez) — dependiendo del archivo
 * termina con vínculos externos huérfanos o nombres rotos, y Excel
 * responde con su diálogo "hemos encontrado un problema con el
 * contenido... Registros quitados: Rango con nombre" al abrir el .xlsx
 * generado (el archivo igual abre, pero no debería pedir reparación).
 *
 * SIEI nunca usa un rango con nombre ni un vínculo externo en ningún
 * punto del generador — todas las celdas se ubican por coordenada
 * absoluta o por texto de encabezado (ver `generateExcel.ts`) — así que
 * quitar esto no pierde ninguna funcionalidad real de este entregable.
 *
 * Es un no-op si el paquete no trae vínculos externos (el caso normal de
 * cualquier plantilla que no arrastre este historial, incluida la
 * plantilla anterior "Listado_formato_Macros - PLANTILLA 1.xlsm").
 */
export async function limpiarVinculosExternosYNombres(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);

  const externalLinkFiles = Object.keys(zip.files).filter((name) => /^xl\/externalLinks\//.test(name));
  if (externalLinkFiles.length === 0) return buffer;

  for (const name of externalLinkFiles) {
    zip.remove(name);
  }

  const workbookRelsFile = zip.file('xl/_rels/workbook.xml.rels');
  if (workbookRelsFile) {
    const xml = await workbookRelsFile.async('string');
    const rewritten = xml.replace(/<Relationship[^>]*\/relationships\/externalLink"[^>]*\/>/g, '');
    if (rewritten !== xml) zip.file('xl/_rels/workbook.xml.rels', rewritten);
  }

  const contentTypesFile = zip.file('[Content_Types].xml');
  if (contentTypesFile) {
    const xml = await contentTypesFile.async('string');
    const rewritten = xml.replace(/<Override PartName="\/xl\/externalLinks\/[^"]*"[^>]*\/>/g, '');
    if (rewritten !== xml) zip.file('[Content_Types].xml', rewritten);
  }

  const workbookFile = zip.file('xl/workbook.xml');
  if (workbookFile) {
    const xml = await workbookFile.async('string');
    const rewritten = xml.replace(/<definedNames>[\s\S]*?<\/definedNames>/, '');
    if (rewritten !== xml) zip.file('xl/workbook.xml', rewritten);
  }

  return zip.generateAsync({ type: 'nodebuffer' });
}

/**
 * exceljs también reserializa `xl/drawings/*.xml` cada vez que reescribe
 * el paquete, incluso si el generador nunca tocó ninguna celda del área
 * donde viven esos dibujos (en la plantilla oficial vigente: un logo y un
 * rectángulo decorativo en Carátula, un segundo logo en Hoja1, filas
 * 1-14, muy por encima de donde el generador escribe o duplica filas). Su
 * escritor de DrawingML no reproduce bit a bit una forma/imagen
 * preexistente con extensiones `extLst`/`mc:Ignorable` (confirmado
 * empíricamente: el tamaño de `drawing1.xml` cae de 17.5 KB a 7.6 KB en
 * un round-trip sin ningún cambio de contenido) — eso es lo otro que
 * dispara el diálogo de reparación de Excel ("Registros reparados: Dibujo
 * de ... Forma de dibujo").
 *
 * En vez de depender de que exceljs termine de soportar DrawingML, se
 * restauran directamente los bytes ORIGINALES de la plantilla para
 * `xl/drawings/**` y `xl/media/**` sobre el paquete ya escrito por
 * exceljs. Es seguro porque el generador nunca agrega, quita ni reancla
 * ningún dibujo propio — solo escribe valores/estilos de celda y duplica
 * filas de datos muy por debajo de donde estos dibujos están anclados.
 */
export async function restaurarDibujosOriginales(
  bufferGenerado: Buffer,
  bufferPlantillaOriginal: Buffer
): Promise<Buffer> {
  const zipOriginal = await JSZip.loadAsync(bufferPlantillaOriginal);
  const drawingPaths = Object.keys(zipOriginal.files).filter(
    (name) => /^xl\/(drawings|media)\//.test(name) && !zipOriginal.files[name].dir
  );
  if (drawingPaths.length === 0) return bufferGenerado;

  const zipGenerado = await JSZip.loadAsync(bufferGenerado);
  for (const filePath of drawingPaths) {
    const content = await zipOriginal.file(filePath)!.async('nodebuffer');
    zipGenerado.file(filePath, content);
  }

  return zipGenerado.generateAsync({ type: 'nodebuffer' });
}
