import { createHash } from 'node:crypto';
import { extractInstagramElements } from './inspectElements.js';
import type { InstagramState } from './instagramStateMachine.js';

export type PublicationObservation = { elapsed_ms: number; state: InstagramState; source: string; error?: string };
export type PublishOutcome = 'SUCCESS' | 'INCONCLUSIVE' | 'FAILURE';
const labels = (source: string) => extractInstagramElements(source).flatMap(element => [element.text, element['content-desc']]).filter(Boolean);

/** Só lê observações desta tentativa. Story existente e Home nunca comprovam envio. */
export function verifyPublishedStory(beforeSource: string, observations: PublicationObservation[]) {
  const before = new Set(labels(beforeSource));
  const beforeIds = new Set(extractInstagramElements(beforeSource).map(element => element['resource-id']));
  const seenIds = new Set<string>();
  const seen = new Set<string>();
  const evidence: { elapsed_ms: number; kind: string; value: string }[] = [];
  let acknowledged = false, failed = false;
  for (const observation of observations) {
    if (!observation.source || observation.error) continue;
    let elements: ReturnType<typeof extractInstagramElements>;
    try { elements = extractInstagramElements(observation.source); }
    catch { evidence.push({ elapsed_ms: observation.elapsed_ms, kind: 'invalid-hierarchy', value: 'Captura não interpretável; não prova sucesso.' }); continue; }
    for (const element of elements) {
      const id = element['resource-id'];
      if (id && !beforeIds.has(id) && !seenIds.has(id) && /story|reel|upload|publish|send|progress/i.test(id)) {
        seenIds.add(id); evidence.push({ elapsed_ms: observation.elapsed_ms, kind: 'unverified-new-ui-identifier', value: id });
      }
    }
    for (const value of elements.flatMap(element => [element.text, element['content-desc']]).filter(Boolean)) {
      if (before.has(value) || seen.has(value)) continue;
      seen.add(value);
      // Frases específicas de Story e envio, não qualquer toast de sucesso.
      const success = /^(?:your story (?:was |has been )?(?:shared|posted|published)|story (?:shared|posted|published)|shared to your story|story publicado|seu story (?:foi )?publicado)[.!]?$/i.test(value.trim());
      const failure = /upload failed|couldn't share|failed to upload|não foi possível (compartilhar|enviar)/i.test(value);
      const upload = /uploading|enviando|sending|processing/i.test(value);
      const ownStoryCandidate = /story.*(?:ago|agora|seconds|segundos)|'s story/i.test(value);
      if (success) { acknowledged = true; evidence.push({ elapsed_ms: observation.elapsed_ms, kind: 'new-story-send-acknowledgement', value }); }
      else if (failure) { failed = true; evidence.push({ elapsed_ms: observation.elapsed_ms, kind: 'send-failure', value }); }
      else if (upload) evidence.push({ elapsed_ms: observation.elapsed_ms, kind: 'upload-pending', value });
      else if (ownStoryCandidate) evidence.push({ elapsed_ms: observation.elapsed_ms, kind: 'unverified-story-candidate', value });
    }
  }
  // Contradição é inconclusiva; um Story antigo ou indicador de upload não é sucesso.
  const outcome: PublishOutcome = acknowledged && failed ? 'INCONCLUSIVE' : acknowledged ? 'SUCCESS' : failed ? 'FAILURE' : 'INCONCLUSIVE';
  return { outcome, evidence, confirmation_basis: acknowledged ? 'new-story-send-acknowledgement-during-this-attempt' : 'no-positive-confirmation',
    content_identity_verified: false, retryAllowed: false };
}

/** Hash do rascunho observado, não alegação de hash da imagem original. */
export function draftFingerprint(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}
