import { XMLParser } from 'fast-xml-parser';
import { join } from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import type { InstagramDriver } from './InstagramDriver.js';
import { extractInstagramElements } from './inspectElements.js';
import { analyzeResetHierarchy } from './normalizeInstagramToHome.js';
import { detectInstagramState, HOME_CREATE_ID, STORY_ID, resourceIdSelector } from './instagramStateMachine.js';
import { saveScreenArtifacts } from './diagnostics.js';

type Driver = Pick<InstagramDriver, 'getSession'>;
type Node = Record<string, unknown>;
const attr = (node: Node, key: string) => String(node[`@_${key}`] ?? '');
export const HOME_LEFT_CONTAINER_ID = 'com.instagram.android:id/action_bar_buttons_container_left';
export const HOME_PLUS_SELECTOR = `${resourceIdSelector(HOME_LEFT_CONTAINER_ID)}.childSelector(new UiSelector().className("android.widget.ImageView").clickable(true))`;

type Candidate = { selector: string; resourceId: string; contentDesc: string; text: string; class: string; bounds: string };
function visibleNodes(source: string) {
  extractInstagramElements(source);
  const nodes: { node: Node; parents: Node[] }[] = [];
  const visit = (value: unknown, parents: Node[]) => {
    if (Array.isArray(value)) { for (const child of value) visit(child, parents); return; }
    if (!value || typeof value !== 'object') return;
    const node = value as Node;
    if (attr(node, 'displayed') === 'false') return;
    if (Object.keys(node).some(key => key.startsWith('@_'))) nodes.push({ node, parents });
    for (const [key, child] of Object.entries(node)) if (!key.startsWith('@_')) visit(child, [...parents, node]);
  };
  visit(new XMLParser({ ignoreAttributes: false, parseAttributeValue: false, trimValues: false }).parse(source), []);
  return nodes;
}
function candidate(node: Node, selector?: string): Candidate | undefined {
  const resourceId = attr(node, 'resource-id'), contentDesc = attr(node, 'content-desc'), text = attr(node, 'text');
  const native = selector ?? (resourceId ? resourceIdSelector(resourceId) : contentDesc ? `~${contentDesc}` : text ? `android=new UiSelector().text(${JSON.stringify(text)})` : undefined);
  if (!native) return undefined;
  return { selector: native, resourceId, contentDesc, text, class: attr(node, 'class'), bounds: attr(node, 'bounds') };
}

/** Seletores derivados do XML atual, incluindo a combinação observada do + sem label. */
export function discoverHomeCreate(source: string): Candidate {
  const nodes = visibleNodes(source);
  const labelled = nodes.filter(({ node }) => attr(node, 'resource-id') === HOME_CREATE_ID ||
    /^(?:Create|\+|Create a post, story, reel or live video\.)$/i.test(attr(node, 'content-desc')) ||
    /^(?:Create|\+)$/.test(attr(node, 'text')))
    .filter(({ node }) => attr(node, 'clickable') === 'true' && attr(node, 'enabled') !== 'false');
  if (labelled.length === 1) {
    for (const { node } of labelled) { const found = candidate(node); if (found) return found; }
  }
  if (labelled.length > 1) throw new Error('Controles Create/+ ambíguos; nenhum clique.');
  const contextual = nodes.filter(({ node, parents }) => attr(node, 'class') === 'android.widget.ImageView' &&
    attr(node, 'clickable') === 'true' && attr(node, 'enabled') !== 'false' &&
    parents.some(parent => attr(parent, 'resource-id') === 'com.instagram.android:id/main_feed_action_bar') &&
    attr(parents.at(-1) ?? {}, 'resource-id') === HOME_LEFT_CONTAINER_ID);
  if (contextual.length === 1) {
    for (const { node } of contextual) { const found = candidate(node, HOME_PLUS_SELECTOR); if (found) return found; }
  }
  throw new Error(`Botão Create/+ não identificado inequivocamente: ${contextual.length} candidatos contextuais.`);
}

export function discoverStoryOption(source: string): Candidate {
  const nodes = visibleNodes(source);
  const known = nodes.filter(({ node }) => attr(node, 'resource-id') === STORY_ID);
  let candidates = known;
  if (!known.length) {
    // Não confundir Story de perfil/thumbnail com um menu de criação.
    const menuEvidence = nodes.some(({ node }) => [attr(node, 'text'), attr(node, 'content-desc')].some(label => /^(?:Post|Reel|Live)$/i.test(label)));
    if (!menuEvidence) throw new Error('Menu de criação não comprovado; não clicar em Story desconhecido.');
    candidates = nodes.filter(({ node }) => [attr(node, 'text'), attr(node, 'content-desc')].some(label => /^Story$/i.test(label)) && attr(node, 'clickable') === 'true');
  }
  if (candidates.length !== 1) throw new Error(`Opção Story ausente/ambígua: ${candidates.length}; nenhum clique.`);
  for (const { node } of candidates) { const found = candidate(node); if (found) return found; }
  throw new Error('Story sem seletor nativo observável.');
}

export async function openStoryViaCreate(driver: Driver, directory: string): Promise<'STATE_GALLERY'> {
  if (process.env.DRY_RUN !== 'true') throw new Error('Rota Create exige DRY_RUN=true.');
  const session = driver.getSession();
  const trace: unknown[] = [];
  const click = async (found: Candidate) => {
    const matches = [];
    for (const element of await session.$$(found.selector)) {
      if (!await element.isExisting() || !await element.isDisplayed() || !await element.isEnabled() || await element.getAttribute('clickable') !== 'true') continue;
      if (found.bounds && await element.getAttribute('bounds') !== found.bounds) continue;
      if (found.contentDesc && await element.getAttribute('content-desc') !== found.contentDesc) continue;
      if (found.class && await element.getAttribute('class') !== found.class) continue;
      if (found.text && await element.getAttribute('text') !== found.text) continue;
      matches.push(element);
    }
    if (matches.length !== 1) throw new Error(`Controle visível/habilitado/clicável ausente ou ambíguo: ${matches.length}.`);
    if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram fora de primeiro plano; clique cancelado.');
    for (const element of matches) await element.click(); // Um único alvo comprovado.
  };
  try {
    const home = await saveScreenArtifacts(driver, directory, 'create-route-home');
    if (analyzeResetHierarchy(home.source).state !== 'STATE_HOME') throw new Error('Fallback Create exige Home real.');
    const button = discoverHomeCreate(home.source);
    console.log('[CREATE] botão encontrado:', JSON.stringify(button));
    console.log('[CREATE] clicando');
    await click(button);
    // A nova hierarquia deve mostrar uma mudança real: galeria, cam_dest_story ou menu reconhecível.
    let queryError: unknown;
    try {
      await session.waitUntil(async () => {
        try {
          if (await detectInstagramState(session) === 'STATE_GALLERY') return true;
          try { discoverStoryOption(await session.getPageSource()); return true; } catch { return false; }
        } catch (error) { queryError = error; throw error; }
      }, { timeout: 5_000, interval: 400, timeoutMsg: 'Menu Story não apareceu após Create/+.' });
    } catch (error) { throw queryError ?? error; }
    finally { await saveScreenArtifacts(driver, directory, 'create-route-after-plus'); }
    const menuSource = await readFile(join(directory, 'create-route-after-plus.xml'), 'utf8');
    let state = await detectInstagramState(session);
    console.log(`[CREATE] estado/menu detectado: ${state}`);
    trace.push({ button, state });
    if (state !== 'STATE_GALLERY') {
      const story = discoverStoryOption(menuSource);
      console.log('[CREATE] opção Story encontrada:', JSON.stringify(story));
      console.log('[CREATE] clicando Story');
      await click(story);
      await session.waitUntil(async () => await detectInstagramState(session) === 'STATE_GALLERY',
        { timeout: 5_000, interval: 400, timeoutMsg: 'Galeria não apareceu após Story; não repetir clique.' });
      trace.push({ story });
      state = await detectInstagramState(session);
    }
    await saveScreenArtifacts(driver, directory, 'create-route-gallery');
    if (state !== 'STATE_GALLERY') throw new Error('Rota Create não confirmou galeria.');
    console.log(`[CREATE] estado final: ${state}`);
    return 'STATE_GALLERY';
  } catch (error) {
    try { await saveScreenArtifacts(driver, directory, 'create-route-error'); } catch (captureError) { console.error('Falha na captura Create:', captureError); }
    throw error;
  } finally {
    await writeFile(join(directory, 'create-route.json'), `${JSON.stringify({ trace }, null, 2)}\n`, 'utf8');
  }
}
