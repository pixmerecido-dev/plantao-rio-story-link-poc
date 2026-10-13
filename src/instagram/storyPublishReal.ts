import { assertNotInTestMode } from '../local/publicationMode.js';
import { requireApprovedStickerLayout } from './approvedStickerLayout.js';
import { inspectFacebookStorySharingPrompt, findAlwaysShareControl, hasUnknownPublicationDialog } from './facebookStorySharingPrompt.js';
import type { InstagramDriver } from './InstagramDriver.js';
import { saveScreenArtifacts } from './diagnostics.js';
import { requireCurrentLinkTransaction } from './appliedLinkSticker.js';
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
  assertNotInTestMode();
}

export type PublicationResult = ReturnType<typeof verifyPublishedStory> & {
  job_id: string; media_id: string; media_identity_source: string;
  clickAttempted: boolean; clickCount: number; state: InstagramState;
  unknown_dialog_observed: boolean; facebook_prompt_detected: boolean; facebook_prompt_click_attempted: boolean; facebook_crosspost_enabled: boolean | null;
  link_transaction_at_publish: { job_id: string; transaction_confirmed: true; current_job_match: true };
  clickError?: string; observationErrors: string[]; captureErrors: string[];
  observations: { elapsed_ms: number; state: InstagramState; source_hash: string; error?: string }[];
};
type ObservationClock = { now: () => number; pause: (milliseconds: number) => Promise<void> };

/** Publica somente o rascunho final existente. Não prepara ou altera o Story. */
export async function publishStoryOnce(driver: Driver, directory: string, clock?: ObservationClock, job?: { job_id: string; media_sha256: string }): Promise<PublicationResult> {
  assertRealPublishAllowed();
  const session = driver.getSession();
  const currentJobId = await requireCurrentLinkTransaction(session, job?.job_id);
  const validate = async () => {
    await requireCurrentLinkTransaction(session, currentJobId);
    await requireApprovedStickerLayout(session,currentJobId);
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
  const job_id = currentJobId;
  const media_id = job ? `${job_id}:media-sha256:${job.media_sha256}` : `${job_id}:draft-sha256:${draftFingerprint(beforeSource)}`;
  const media_identity_source = job ? 'job-media-sha256' : 'editor-hierarchy-snapshot';
  await mkdir(directory, { recursive: true });
  const link_transaction_at_publish = { job_id, transaction_confirmed: true as const, current_job_match: true as const };
  const pending = { link_transaction_at_publish, job_id, media_id, media_identity_source, status: 'PUBLISH_PENDING_CONFIRMATION', clickAttempted: true, retryAllowed: false };
  // Persistir antes do envio: mesmo uma interrupção conserva tarefa e proibição de retry.
  await writeFile(join(directory, 'pending-publication.json'), `${JSON.stringify(pending, null, 2)}\n`, 'utf8');
  assertRealPublishAllowed();
  await requireApprovedStickerLayout(session,currentJobId); // Última revalidação antes do clique único.
  let state: InstagramState = 'STATE_EDITOR_WITH_LINK';
  let clickError: string | undefined;
  const observationErrors: string[] = [], captureErrors: string[] = [];
  const observations: PublicationObservation[] = [];
  const timing = clock ?? { now: Date.now, pause: (milliseconds: number) => session.pause(milliseconds) };
  let facebook_prompt_detected = false, facebook_prompt_click_attempted = false, promptBlocked = false;
  let unknown_dialog_observed = false;
  let facebook_crosspost_enabled: boolean | null = null;
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
      if (hasUnknownPublicationDialog(source)) unknown_dialog_observed = true;
      if (inspectFacebookStorySharingPrompt(source)) await continueFacebookPrompt();
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
  const continueFacebookPrompt = async () => {
    facebook_prompt_detected = true;
    if (facebook_prompt_click_attempted || promptBlocked) return;
    console.log('[PUBLISH] Facebook sharing prompt detected');
    try {
      // Só esta tentativa já autorizada e com vínculo confirmado pode continuar.
      assertRealPublishAllowed();
      await saveScreenArtifacts(driver, directory, 'facebook-sharing-prompt-before');
      const fresh = inspectFacebookStorySharingPrompt(await session.getPageSource());
      if (!fresh || await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Facebook prompt mudou; continuação cancelada.');
      const control = await findAlwaysShareControl(session, fresh.selector);
      console.log(`[PUBLISH] Always share stories selector=${fresh.selector}`);
      assertRealPublishAllowed();
      facebook_prompt_click_attempted = true; // Marcar antes do comando; timeout não autoriza retry.
      console.log('[PUBLISH] enabling Instagram -> Facebook Story sharing');
      await writeFile(join(directory, 'facebook-sharing-continuation.json'), `${JSON.stringify({ job_id, media_id, link_transaction_at_publish, status: 'PUBLISH_PENDING_CONFIRMATION', selector: fresh.selector, clickAttempted: true, retryAllowed: false }, null, 2)}\n`, 'utf8');
      await session.elementClick(control.elementId);
      const deadline = Math.min(started + 15_000, timing.now() + 5_000);
      let changed = false;
      while (timing.now() < deadline) {
        await timing.pause(Math.min(500, deadline - timing.now()));
        if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram fora de primeiro plano após Facebook prompt.');
        const after = await session.getPageSource();
        if (!inspectFacebookStorySharingPrompt(after)) {
          changed = true;
          state = await detectInstagramState(session);
          if (hasUnknownPublicationDialog(after)) unknown_dialog_observed = true;
          observations.push({ elapsed_ms: timing.now() - started, state, source: after });
          break;
        }
      }
      if (!changed) throw new Error('Always share stories não fechou o diálogo; não repetir clique.');
      // Evidência da escolha aceita pela UI; não prova entrega no Facebook.
      facebook_crosspost_enabled = true;
      console.log(`[PUBLISH] estado após Facebook prompt: ${state}`);
      console.log('[PUBLISH] facebook_crosspost_enabled=true');
    } catch (error) {
      promptBlocked = true;
      observationErrors.push(`Facebook sharing prompt: ${String(error)}`);
      console.error('[PUBLISH] continuação Facebook inconclusiva; nenhum clique será repetido:', error);
    } finally {
      try { await saveScreenArtifacts(driver, directory, 'facebook-sharing-prompt-after'); }
      catch (error) { captureErrors.push(`facebook-sharing-prompt-after: ${String(error)}`); promptBlocked = true; }
    }
  };
  await capture('immediate-post-click');
  await observe();
  for (const seconds of [5, 10, 15]) {
    while (timing.now() - started < seconds * 1_000) {
      await timing.pause(Math.min(500, seconds * 1_000 - (timing.now() - started)));
      await observe(); // coleta também mensagens transitórias entre screenshots.
    }
    await capture(`post-publish-${seconds}s`);
  }
  const verification = verifyPublishedStory(beforeSource, observations);
  if (unknown_dialog_observed || promptBlocked || String(state) === 'STATE_FACEBOOK_STORY_SHARING_PROMPT') { verification.outcome = 'INCONCLUSIVE'; verification.confirmation_basis = 'facebook-sharing-prompt-not-confirmed'; }
  console.log(`[PUBLISH] estado após clique: ${state}`);
  console.log(`[PUBLISH] ${verification.outcome}`);
  const result: PublicationResult = { ...verification, job_id, media_id, media_identity_source,
    unknown_dialog_observed, facebook_prompt_detected, facebook_prompt_click_attempted, facebook_crosspost_enabled, link_transaction_at_publish,
    clickAttempted: true, clickCount: 1, state, clickError, observationErrors, captureErrors,
    observations: observations.map(({ source, ...rest }) => ({ ...rest, source_hash: draftFingerprint(source) })) };
  await writeFile(join(directory, 'publication-observations.json'), `${JSON.stringify(observations, null, 2)}\n`, 'utf8');
  return result;
}
