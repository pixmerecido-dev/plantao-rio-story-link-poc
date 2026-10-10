/** Confirma o caminho exato no MediaStore; fim do broadcast sozinho não prova scan. */
export async function waitForIndexedMedia(destination: string, query: () => Promise<string>, pause: () => Promise<void>) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const output = await query();
    // Um Story anterior ou outro arquivo não confirma esta injeção.
    if (output.split(/\r?\n/).some(line => /\b_id=\d+\b/.test(line) && line.includes(`_data=${destination}`) &&
      line.split('_data=')[1]?.split(',')[0]?.trim() === destination)) {
      console.log('[MEDIA] scan concluído');
      return;
    }
    if (attempt < 19) await pause();
  }
  throw new Error('MediaStore não confirmou a imagem deste job; abertura de Story cancelada.');
}
