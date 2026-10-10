import { XMLParser } from 'fast-xml-parser';
import type { InstagramDriver } from './InstagramDriver.js';
import { extractInstagramElements, type InstagramElement } from './inspectElements.js';
import { detectInstagramState, resourceIdSelector, type InstagramState } from './instagramStateMachine.js';
import { saveScreenArtifacts } from './diagnostics.js';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

type Driver = Pick<InstagramDriver, 'getSession'>;
type ResetState = InstagramState | 'STATE_SHARE' | 'STATE_DRAFT_DIALOG' | 'STATE_UNSAFE_DIALOG';
const intermediate = new Set<ResetState>(['STATE_EDITOR', 'STATE_EDITOR_WITH_LINK', 'STATE_STICKERS', 'STATE_LINK_EDITOR', 'STATE_GALLERY', 'STATE_CREATE', 'STATE_SHARE']);

/** Só considera controles e texto do mesmo diálogo observado no XML. */
export function inspectResetScreen(source: string) {
  const elements = extractInstagramElements(source);
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

/** Entrada reutilizável de jobs novos; no máximo cinco Back e cinco descartes. */
export async function normalizeInstagramToHome(driver: Driver, directory: string): Promise<void> {
  const session = driver.getSession();
  let backs = 0, discards = 0;
  const trace: { state: ResetState; action: string }[] = [];
  const read = async () => {
    if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram não está em primeiro plano; normalização cancelada.');
    const screen = inspectResetScreen(await session.getPageSource());
    const base = screen.state === 'STATE_DRAFT_DIALOG' || screen.state === 'STATE_UNSAFE_DIALOG' ? undefined : await detectInstagramState(session);
    const state: ResetState = screen.state === 'STATE_DRAFT_DIALOG' || screen.state === 'STATE_UNSAFE_DIALOG'
      ? screen.state : base && base !== 'STATE_UNKNOWN' ? base : screen.state ?? 'STATE_UNKNOWN';
    return { ...screen, state };
  };
  try {
    let screen = await read();
    console.log(`[RESET] estado inicial: ${screen.state}`);
    console.log('[RESET] normalizando Instagram para Home');
    // Há um limite total além do limite de Back para diálogos intermediários.
    for (let step = 0; step < 11; step++) {
      if (screen.state === 'STATE_HOME') {
        console.log('[RESET] STATE_HOME confirmado');
        await session.pause(500);
        screen = await read();
        if (screen.state !== 'STATE_HOME') throw new Error('Home não estabilizou; job cancelado.');
        console.log('[RESET] Home estabilizada');
        await saveScreenArtifacts(driver, directory, 'normalized-home');
        await writeFile(join(directory, 'normalization.json'), `${JSON.stringify({ backs, discards, trace, finalState: screen.state }, null, 2)}\n`, 'utf8');
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
        await session.pause(300);
        screen = await read();
        if (screen.state === 'STATE_DRAFT_DIALOG') throw new Error('Descarte não fechou o diálogo; não repetir clique.');
        console.log('[RESET] draft descartado');
      } else {
        if (!intermediate.has(screen.state)) throw new Error(`${screen.state}: não navegar em tela/diálogo desconhecido ou ambíguo.`);
        if (backs >= 5) throw new Error('Limite de cinco retornos atingido; job cancelado.');
        console.log(`[RESET] voltando de ${screen.state}`);
        trace.push({ state: screen.state, action: 'back' }); backs++;
        await session.back();
        await session.pause(300);
        screen = await read();
      }
    }
    throw new Error('Limite total da normalização atingido; job cancelado.');
  } catch (error: unknown) {
    try { await saveScreenArtifacts(driver, directory, 'normalize-error'); }
    catch (captureError: unknown) { console.error('Falha na captura da normalização:', captureError); }
    throw error;
  }
}
