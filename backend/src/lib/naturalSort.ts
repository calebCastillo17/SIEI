/*
 * Orden "natural" para códigos alfanuméricos libres (bloque_terminal.codigo
 * tipo "TB-1".."TB-10", terminal.numero tipo "1".."18") — un
 * localeCompare/ORDER BY SQL puro sobre texto libre deja "TB-10" antes
 * que "TB-2" (compara carácter por carácter: '1' < '2'). Se parte el
 * código en tramos de dígitos/no-dígitos y cada tramo numérico se compara
 * como número, nunca como texto — así "TB-2" < "TB-10" como se espera.
 * Encontrado en vivo: el usuario notó el orden roto en la vista de Cajas
 * de Control (TB-1, TB-10, TB-11, ..., TB-2, ...).
 */
export function compararCodigoNatural(a: string, b: string): number {
  const partesA = a.match(/\d+|\D+/g) ?? [a];
  const partesB = b.match(/\d+|\D+/g) ?? [b];
  const largo = Math.max(partesA.length, partesB.length);
  for (let i = 0; i < largo; i++) {
    const pa = partesA[i] ?? '';
    const pb = partesB[i] ?? '';
    if (/^\d+$/.test(pa) && /^\d+$/.test(pb)) {
      const diff = Number(pa) - Number(pb);
      if (diff !== 0) return diff;
    } else {
      const cmp = pa.localeCompare(pb, 'es');
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}
