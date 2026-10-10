import type { InstagramDriver } from './InstagramDriver.js';
import { saveScreenArtifacts } from './diagnostics.js';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyPublishedStory, draftFingerprint, type PublicationObservation } from './verifyPublishedStory.js';
import { detectInstagramState, isEditorState, resourceIdSelector, SHARE_SHORTCUT_ID, type InstagramState } from './instagramStateMachine.js';

type Driver = Pick<InstagramDriver, 'getSession'>;

export function assertRealPublishAllowed(): void {
  if (process.env.ALLOW_PUBLISH !== 'true' || process.env.CONFIRM_REAL_PUBLISH !== 'YES') {
    console.log('[SAFE] Publicação bloqueada');
    throw new Error('Publicação real exige ALLOW_PUBLISH=true e CONFIRM_REAL_PUBLISH=YES.');
  }
}

export type PublicationResult = ReturnType<typeof verifyPublishedStory> & {
  job_id: string; media_id: string; media_identity_source: string;
  clickAttempted: boolean; clickCount: number; state: InstagramState;
  clickError?: string; observationErrors: string[]; captureErrors: string[];
  observations: { elapsed_ms: number; state: InstagramState; source_hash: string; error?: string }[];
};
type ObservationClock = { now: () => number; pause: (milliseconds: number) => Promise<void> };

/** Publica somente o rascunho final existente. Não prepara ou altera o Story. */
export async function publishStoryOnce(driver: Driver, directory: string, clock?: ObservationClock): Promise<PublicationResult> {
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
  const job_id = randomUUID();
  const media_id = `${job_id}:draft-sha256:${draftFingerprint(beforeSource)}`;
  await mkdir(directory, { recursive: true });
  const pending = { job_id, media_id, media_identity_source: 'editor-hierarchy-snapshot', status: 'PUBLISH_PENDING_CONFIRMATION', clickAttempted: true, retryAllowed: false };
  // Persistir antes do envio: mesmo uma interrupção conserva tarefa e proibição de retry.
  await writeFile(join(directory, 'pending-publication.json'), `${JSON.stringify(pending, null, 2)}\n`, 'utf8');
  assertRealPublishAllowed();
  let state: InstagramState = 'STATE_EDITOR_WITH_LINK';
  let clickError: string | undefined;
  const observationErrors: string[] = [], captureErrors: string[] = [];
  const observations: PublicationObservation[] = [];
  const timing = clock ?? { now: Date.now, pause: (milliseconds: number) => session.pause(milliseconds) };
  const started = timing.now();
  console.log(`[PUBLISH] job_id=${job_id} media_id=${media_id}`);
  console.log('[PUBLISH] clicando uma única vez');
  try { await session.elementClick(button.elementId); }
  catch (error: unknown) { clickError = String(error); console.error('[PUBLISH] erro no clique; não repetir:', error); }
  console.log('[PUBLISH] PUBLISH_PENDING_CONFIRMATION');
  console.log('[PUBLISH] aguardando evidências por até 15 segundos');
  const observe = async () => {
    let source = '';
    try {
      if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram não está em primeiro plano.');
      state = await detectInstagramState(session);
      source = await session.getPageSource();
      observations.push({ elapsed_ms: timing.now() - started, state, source });
    } catch (error: unknown) {
      const message = String(error); observationErrors.push(message);
      observations.push({ elapsed_ms: timing.now() - started, state, source, error: message });
    }
  };
  const capture = async (name: string) => {
    try {
      const { source } = await saveScreenArtifacts(driver, directory, name);
      observations.push({ elapsed_ms: timing.now() - started, state, source });
    } catch (error: unknown) { captureErrors.push(`${name}: ${String(error)}`); }
  };
  await observe();
  await capture('immediate-post-click');
  for (const seconds of [5, 10, 15]) {
    while (timing.now() - started < seconds * 1_000) {
      await timing.pause(Math.min(500, seconds * 1_000 - (timing.now() - started)));
      await observe(); // coleta também mensagens transitórias entre screenshots.
    }
    await capture(`post-publish-${seconds}s`);
  }
  const verification = verifyPublishedStory(beforeSource, observations);
  console.log(`[PUBLISH] estado após clique: ${state}`);
  console.log(`[PUBLISH] ${verification.outcome}`);
  const result: PublicationResult = { ...verification, job_id, media_id, media_identity_source: 'editor-hierarchy-snapshot',
    clickAttempted: true, clickCount: 1, state, clickError, observationErrors, captureErrors,
    observations: observations.map(({ source, ...rest }) => ({ ...rest, source_hash: draftFingerprint(source) })) };
  await writeFile(join(directory, 'publication-observations.json'), `${JSON.stringify(observations, null, 2)}\n`, 'utf8');
  return result;
}
