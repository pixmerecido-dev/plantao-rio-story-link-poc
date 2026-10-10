import type { InstagramDriver } from './InstagramDriver.js';
import { saveScreenArtifacts } from './diagnostics.js';
import { extractInstagramElements } from './inspectElements.js';
import { detectInstagramState, isEditorState, resourceIdSelector, SHARE_SHORTCUT_ID, type InstagramState } from './instagramStateMachine.js';

type Driver = Pick<InstagramDriver, 'getSession'>;

export function assertRealPublishAllowed(): void {
  if (process.env.ALLOW_PUBLISH !== 'true' || process.env.CONFIRM_REAL_PUBLISH !== 'YES') {
    console.log('[SAFE] Publicação bloqueada');
    throw new Error('Publicação real exige ALLOW_PUBLISH=true e CONFIRM_REAL_PUBLISH=YES.');
  }
}

export type PublicationResult = {
  clickAttempted: boolean; clickCount: number; state: InstagramState;
  outcome: 'provável sucesso' | 'inconclusivo' | 'falha'; evidence: string[];
  clickError?: string; observationError?: string; captureError?: string; retryAllowed: boolean;
};

/** Publica somente o rascunho final existente. Não prepara ou altera o Story. */
export async function publishStoryOnce(driver: Driver, directory: string): Promise<PublicationResult> {
  assertRealPublishAllowed();
  const session = driver.getSession();
  const validate = async () => {
    if (await session.getCurrentPackage() !== 'com.instagram.android' ||
        await detectInstagramState(session) !== 'STATE_EDITOR_WITH_LINK') throw new Error('Publicação exige STATE_EDITOR_WITH_LINK ativo.');
    const matches = await session.$$(resourceIdSelector(SHARE_SHORTCUT_ID));
    if (matches.length !== 1) throw new Error('Your story ausente ou ambíguo; publicação cancelada.');
    const [button] = matches;
    if (!button || !button.elementId || !await button.isExisting() || !await button.isDisplayed() || !await button.isEnabled() ||
        await button.getAttribute('clickable') !== 'true' || await button.getAttribute('content-desc') !== 'Your story' ||
        await button.getAttribute('class') !== 'android.widget.Button' || await button.getAttribute('resource-id') !== SHARE_SHORTCUT_ID) {
      throw new Error('Your story não atende aos atributos confirmados; publicação cancelada.');
    }
    return button;
  };
  await validate();
  console.log('[PUBLISH] travas confirmadas');
  console.log('[PUBLISH] Your story encontrado');
  const { source: beforeSource } = await saveScreenArtifacts(driver, directory, 'pre-publish');
  // Revalidar após a captura, sem usar um handle antigo ou uma autorização revogada.
  const button = await validate();
  assertRealPublishAllowed();
  let state: InstagramState = 'STATE_EDITOR_WITH_LINK';
  let clickError: string | undefined;
  let observationError: string | undefined;
  let evidence: string[] = [];
  let outcome: 'provável sucesso' | 'inconclusivo' | 'falha' = 'inconclusivo';
  console.log('[PUBLISH] clicando uma única vez');
  // Uma única chamada. Falha no transporte também pode ter ocorrido após publicar.
  // Comando direto evita reconsulta/retry automático do wrapper em elemento stale.
  try { await session.elementClick(button.elementId); }
  catch (error: unknown) { clickError = String(error); console.error('[PUBLISH] erro no clique; não repetir:', error); }
  console.log('[PUBLISH] aguardando resultado');
  try {
    await session.waitUntil(async () => {
      if (await session.getCurrentPackage() !== 'com.instagram.android') return false;
      state = await detectInstagramState(session);
      const source = await session.getPageSource();
      evidence = extractInstagramElements(source).flatMap(element => [element.text, element['content-desc']])
        .filter(label => /story shared|shared to your story|upload failed|couldn't share|failed to upload|story publicado|não foi possível (compartilhar|enviar)|enviando|uploading/i.test(label));
      if (evidence.some(label => /failed|couldn't|não foi possível/i.test(label))) { outcome = 'falha'; return true; }
      if (state === 'STATE_HOME' || evidence.some(label => /story shared|shared to your story|story publicado/i.test(label))) {
        outcome = 'provável sucesso'; return true;
      }
      // Saída do editor é observável, mas sozinha não prova envio concluído.
      return !isEditorState(state) && source !== beforeSource;
    }, { timeout: 15_000, interval: 500, timeoutMsg: 'Resultado após publicação inconclusivo; não repetir o clique.' });
  } catch (error: unknown) { observationError = String(error); console.error('[PUBLISH] observação inconclusiva; não repetir:', error); }
  let captureError: string | undefined;
  try { await saveScreenArtifacts(driver, directory, 'post-publish'); }
  catch (error: unknown) { captureError = String(error); console.error('Falha na captura pós-publicação:', error); }
  console.log(`[PUBLISH] estado após clique: ${state}`);
  console.log(`[PUBLISH] ${outcome}`);
  return { clickAttempted: true, clickCount: 1, state, outcome, evidence, clickError, observationError, captureError, retryAllowed: false };
}
