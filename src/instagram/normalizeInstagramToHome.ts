import { XMLParser } from 'fast-xml-parser';
import type { InstagramDriver } from './InstagramDriver.js';
import { extractInstagramElements, type InstagramElement } from './inspectElements.js';
import { detectInstagramState, resourceIdSelector, LINK_STICKER_HOLDER_ID, SHARE_SHORTCUT_ID, STICKERS_ID, GALLERY_ID, STORY_ID, HOME_CREATE_ID, HOME_STORY_ID, type InstagramState } from './instagramStateMachine.js';
import { saveScreenArtifacts } from './diagnostics.js';
import { LINK_EDITOR_MARKERS } from './linkEditorSelectors.js';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

type Driver = Pick<InstagramDriver, 'getSession'>;
type ResetState = InstagramState | 'STATE_SHARE' | 'STATE_DRAFT_DIALOG' | 'STATE_UNSAFE_DIALOG';
const intermediate = new Set<ResetState>(['STATE_EDITOR', 'STATE_EDITOR_WITH_LINK', 'STATE_STICKERS', 'STATE_LINK_EDITOR', 'STATE_GALLERY', 'STATE_CREATE', 'STATE_SHARE']);

function visibleResetElements(source: string): InstagramElement[] {
  extractInstagramElements(source); // Validação segura antes do segundo parse.
  const elements: InstagramElement[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { for (const child of value) visit(child); return; }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (node['@_displayed'] === 'false') return;
    if (Object.keys(node).some(key => key.startsWith('@_'))) {
      const read = (name: string) => String(node[`@_${name}`] ?? '');
      elements.push({ text: read('text'), 'content-desc': read('content-desc'), 'resource-id': read('resource-id'), class: read('class') });
    }
    for (const [key, child] of Object.entries(node)) if (!key.startsWith('@_')) visit(child);
  };
  visit(new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseAttributeValue: false, trimValues: false }).parse(source));
  return elements;
}

/** Só considera controles e texto do mesmo diálogo observado no XML. */
export function inspectResetScreen(source: string) {
  const elements = visibleResetElements(source);
  const dialogScopes: InstagramElement[][] = [];
  function visit(value: unknown): void {
    if (Array.isArray(value)) { for (const child of value) visit(child); return; }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (node['@_displayed'] === 'false') return;
    const cls = String(node['@_class'] ?? ''), id = String(node['@_resource-id'] ?? '');
    if (/Dialog$/.test(cls) || /(?:dialog|alert|:id\/parentPanel$)/i.test(id)) {
      // Serialização para coletar somente os atributos desse ramo, não da tela atrás.
      const scoped: InstagramElement[] = [];
      const collect = (record: unknown): void => {
        if (Array.isArray(record)) { for (const child of record) collect(child); return; }
        if (!record || typeof record !== 'object') return;
        const attrs = record as Record<string, unknown>;
        if (attrs['@_displayed'] === 'false') return;
        const read = (name: string) => String(attrs[`@_${name}`] ?? '');
        if (Object.keys(attrs).some(key => key.startsWith('@_'))) scoped.push({ text: read('text'), 'content-desc': read('content-desc'), 'resource-id': read('resource-id'), class: read('class') });
        for (const [key, child] of Object.entries(attrs)) if (!key.startsWith('@_')) collect(child);
      };
      collect(node); dialogScopes.push(scoped); return;
    }
    for (const [key, child] of Object.entries(node)) if (!key.startsWith('@_')) visit(child);
  }
  visit(new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseAttributeValue: false }).parse(source));
  for (const scope of dialogScopes) {
    const labels = scope.flatMap(element => [element.text, element['content-desc']]).filter(Boolean);
    const localDraft = labels.some(label => /save (?:as )?draft|salvar (?:como )?rascunho|discard (?:this )?(?:story|draft)|descartar (?:o )?(?:story|rascunho)/i.test(label));
    const publishedContent = labels.some(label => /delete|remove|excluir|apagar|already published|já publicado/i.test(label));
    const discard = scope.filter(element => [element.text, element['content-desc']].some(label => /^(?:discard|discard (?:story|draft)|descartar|descartar (?:story|rascunho))$/i.test(label.trim())));
    if (localDraft && !publishedContent && discard.length === 1) {
      const [target] = discard;
      if (target) {
        const selector = target['resource-id'] ? resourceIdSelector(target['resource-id']) : target['content-desc'] ? `~${target['content-desc']}` : `android=new UiSelector().text(${JSON.stringify(target.text)})`;
        return { state: 'STATE_DRAFT_DIALOG' as const, discardSelector: selector, evidence: scope };
      }
    }
  }
  const isShare = (scope: InstagramElement[]) => scope.some(element => /^(share to|share|compartilhar em|compartilhar)$/i.test(element.text.trim())) &&
    scope.some(element => [element.text, element['content-desc']].some(label => /^(your story|seu story)$/i.test(label.trim()))) &&
    scope.some(element => [element.text, element['content-desc']].some(label => /^(close friends|amigos próximos)$/i.test(label.trim())));
  // Em overlay, a prova deve pertencer ao próprio diálogo, não à tela atrás.
  if ((dialogScopes.length ? dialogScopes : [elements]).some(isShare)) {
    return { state: 'STATE_SHARE' as const, evidence: elements };
  }
  if (dialogScopes.length) return { state: 'STATE_UNSAFE_DIALOG' as const, evidence: elements };
  return { state: undefined, evidence: elements };
}

/** Home é inferida somente do snapshot; tabs e containers não contam como sinais. */
export function analyzeResetHierarchy(source: string) {
  const elements = visibleResetElements(source);
  const hasId = (id: string) => elements.some(element => element['resource-id'] === id);
  const label = (value: string) => elements.some(element => element.text.trim() === value || element['content-desc'].trim() === value);
  const buttonLabel = (value: string) => elements.some(element =>
    element['content-desc'].trim() === value || /Button$/.test(element.class) && element.text.trim() === value);
  const homeSignals: string[] = [];
  if (label('For you')) homeSignals.push('home-feed-header');
  if (hasId(HOME_CREATE_ID) || hasId(HOME_STORY_ID) && buttonLabel('Add to story')) homeSignals.push('home-create-or-own-story-shortcut');
  if (elements.some(element => element['resource-id'] === 'com.instagram.android:id/username' && element.text === 'Your story') && hasId(HOME_STORY_ID)) homeSignals.push('own-story-tray');
  const blockers: string[] = [];
  for (const id of [...LINK_EDITOR_MARKERS, STICKERS_ID, LINK_STICKER_HOLDER_ID, SHARE_SHORTCUT_ID, GALLERY_ID, STORY_ID,
    'com.instagram.android:id/post_capture_button_share_container', 'com.instagram.android:id/story_share_controls_action_bar']) {
    if (hasId(id)) blockers.push(id);
  }
  for (const name of ['Your story', 'Close Friends', 'Share to', 'Next', 'Aa', 'Stickers', 'Music', 'Link Sticker']) {
    if (buttonLabel(name) || ['Close Friends', 'Aa', 'Stickers', 'Music'].includes(name) && label(name)) blockers.push(`editor/share:${name}`);
  }
  for (const element of elements) {
    if (/story.*(?:editor|controls)|post_capture|editor_overlay/i.test(element['resource-id']) && !blockers.includes(element['resource-id'])) blockers.push(element['resource-id']);
  }
  let state: ResetState = 'STATE_UNKNOWN';
  if (LINK_EDITOR_MARKERS.some(hasId)) state = 'STATE_LINK_EDITOR';
  else if (hasId('com.instagram.android:id/sticker_sheet_redesign_item') || buttonLabel('Link Sticker')) state = 'STATE_STICKERS';
  else if ((buttonLabel('Your story') || hasId(SHARE_SHORTCUT_ID)) && label('Close Friends') || buttonLabel('Share to') && label('Close Friends')) state = 'STATE_SHARE';
  else if (hasId(STICKERS_ID) || hasId(SHARE_SHORTCUT_ID) || hasId(LINK_STICKER_HOLDER_ID) || blockers.some(value => value.startsWith('editor/share:') || /story.*(?:editor|controls)|post_capture|editor_overlay/i.test(value)) || hasId('com.instagram.android:id/post_capture_button_share_container') || hasId('com.instagram.android:id/story_share_controls_action_bar')) state = 'STATE_EDITOR';
  else if (hasId(GALLERY_ID)) state = 'STATE_GALLERY';
  else if (hasId(STORY_ID)) state = 'STATE_CREATE';
  else if (homeSignals.length >= 2 && blockers.length === 0) state = 'STATE_HOME';
  return { state, homeSignals, blockers };
}

/** Entrada reutilizável de jobs novos; no máximo cinco Back e cinco descartes. */
export async function normalizeInstagramToHome(driver: Driver, directory: string): Promise<void> {
  const session = driver.getSession();
  let backs = 0, discards = 0, captures = 0;
  const trace: { state: ResetState; action: string }[] = [];
  const read = async () => {
    if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram não está em primeiro plano; normalização cancelada.');
    const source = await session.getPageSource();
    const screen = inspectResetScreen(source);
    const snapshot = analyzeResetHierarchy(source);
    let state: ResetState = snapshot.state;
    if (screen.state === 'STATE_DRAFT_DIALOG' || screen.state === 'STATE_UNSAFE_DIALOG') state = screen.state;
    else if (snapshot.state !== 'STATE_LINK_EDITOR' && snapshot.state !== 'STATE_STICKERS' && screen.state === 'STATE_SHARE') state = 'STATE_SHARE';
    else if (state === 'STATE_EDITOR') {
      // Preserva os critérios existentes do link; Home não usa probes genéricos.
      const base = await detectInstagramState(session);
      if (base === 'STATE_EDITOR_WITH_LINK') state = base;
    }
    return { ...screen, ...snapshot, state };
  };
  try {
    await saveScreenArtifacts(driver, directory, 'reset-before');
    let screen = await read();
    console.log(`[RESET] estado inicial: ${screen.state}`);
    console.log('[RESET] normalizando Instagram para Home');
    // Há um limite total além do limite de Back para diálogos intermediários.
    for (let step = 0; step < 11; step++) {
      if (screen.state === 'STATE_HOME') {
        console.log('[RESET] STATE_HOME confirmado');
        await session.pause(2_000);
        await saveScreenArtifacts(driver, directory, 'reset-home-confirmation');
        screen = await read();
        if (screen.state !== 'STATE_HOME') {
          trace.push({ state: screen.state, action: 'home-not-stable-continue' });
          continue;
        }
        await saveScreenArtifacts(driver, directory, 'reset-final');
        const final = await read();
        if (final.state !== 'STATE_HOME') { screen = final; continue; }
        console.log('[RESET] Home estabilizada');
        console.log('[RESET] estado visual final confirmado: STATE_HOME');
        await writeFile(join(directory, 'normalization.json'), `${JSON.stringify({ backs, discards, trace, finalState: screen.state, homeSignals: final.homeSignals, blockers: final.blockers }, null, 2)}\n`, 'utf8');
        return;
      }
      if (screen.state === 'STATE_DRAFT_DIALOG') {
        if (++discards > 5 || !screen.discardSelector) throw new Error('Limite de descarte local atingido.');
        console.log('[RESET] diálogo de descarte detectado');
        await saveScreenArtifacts(driver, directory, `discard-dialog-${discards}`);
        // Releitura: o seletor só é usado se o mesmo diálogo seguro permanece.
        const fresh = await read();
        if (fresh.state !== 'STATE_DRAFT_DIALOG' || fresh.discardSelector !== screen.discardSelector) throw new Error('Diálogo mudou; descarte cancelado.');
        const controls = await session.$$(screen.discardSelector);
        if (controls.length !== 1) throw new Error('Descarte ausente ou ambíguo; job cancelado.');
        for (const control of controls) {
          if (!control.elementId || !await control.isDisplayed() || !await control.isEnabled() || await control.getAttribute('clickable') !== 'true') throw new Error('Descarte não está visível/habilitado/clicável.');
          await session.elementClick(control.elementId);
        }
        trace.push({ state: screen.state, action: 'discard-local-draft' });
        await session.pause(500);
        await saveScreenArtifacts(driver, directory, `reset-step-${++captures}`);
        screen = await read();
        if (screen.state === 'STATE_DRAFT_DIALOG') throw new Error('Descarte não fechou o diálogo; não repetir clique.');
        console.log('[RESET] draft descartado');
      } else {
        if (!intermediate.has(screen.state)) throw new Error(`${screen.state}: não navegar em tela/diálogo desconhecido ou ambíguo.`);
        if (backs >= 5) throw new Error('Limite de cinco retornos atingido; job cancelado.');
        console.log(`[RESET] voltando de ${screen.state}`);
        trace.push({ state: screen.state, action: 'back' }); backs++;
        const previousState = screen.state;
        await session.back();
        for (let probe = 0; probe < 4; probe++) {
          await session.pause(500);
          screen = await read();
          if (screen.state !== previousState) break;
        }
        await saveScreenArtifacts(driver, directory, `reset-step-${++captures}`);
        screen = await read();
      }
    }
    throw new Error('Limite total da normalização atingido; job cancelado.');
  } catch (error: unknown) {
    for (const name of ['reset-final', 'normalize-error']) {
      try { await saveScreenArtifacts(driver, directory, name); }
      catch (captureError: unknown) { console.error(`Falha na captura ${name}:`, captureError); }
    }
    throw error;
  }
}
