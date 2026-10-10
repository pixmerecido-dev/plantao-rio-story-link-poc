import { XMLParser } from 'fast-xml-parser';
import { resolve } from 'node:path';
import type { InstagramDriver } from './InstagramDriver.js';
import { extractInstagramElements } from './inspectElements.js';
import { saveScreenArtifacts } from './diagnostics.js';
import { detectInstagramState, isEditorState, resourceIdSelector, type InstagramState } from './instagramStateMachine.js';

type Session = ReturnType<InstagramDriver['getSession']>;
type Node = Record<string, unknown>;
const attr = (node: Node, name: string) => String(node[`@_${name}`] ?? '');

/** Somente um controle exato na hierarquia atual e seus próprios descendentes. */
export function inspectAddStoryControl(source: string) {
  extractInstagramElements(source);
  const matches: Node[] = [];
  const walk = (value: unknown, result: Node[]): void => {
    if (Array.isArray(value)) { for (const child of value) walk(child, result); return; }
    if (!value || typeof value !== 'object') return;
    const node = value as Node;
    if (attr(node, 'displayed') === 'false') return;
    if (Object.keys(node).some(key => key.startsWith('@_'))) result.push(node);
    for (const [key, child] of Object.entries(node)) if (!key.startsWith('@_')) walk(child, result);
  };
  walk(new XMLParser({ ignoreAttributes: false, parseAttributeValue: false }).parse(source), matches);
  const controls = matches.filter(node => attr(node, 'content-desc') === 'Add to story' && attr(node, 'class') === 'android.widget.Button');
  if (controls.length !== 1) throw new Error('Add to story não é inequívoco na hierarquia atual.');
  const [control] = controls;
  if (!control) throw new Error('Controle Add to story ausente.');
  const descendants: Node[] = [];
  for (const [key, value] of Object.entries(control)) if (!key.startsWith('@_')) walk(value, descendants);
  const candidates = descendants.filter(node => (attr(node, 'clickable') === 'true' || /ImageView$/.test(attr(node, 'class'))) &&
    attr(node, 'enabled') !== 'false' && (attr(node, 'resource-id') || attr(node, 'content-desc')) && attr(node, 'content-desc') !== 'Add to story');
  const [child] = candidates.length === 1 ? candidates : [];
  const descendantSelector = child ? attr(child, 'resource-id') ? resourceIdSelector(attr(child, 'resource-id')) : `~${attr(child, 'content-desc')}` : undefined;
  const bounds = attr(control, 'bounds');
  const match = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(bounds);
  let center: { x: number; y: number } | undefined;
  if (match) {
    const [, left, top, right, bottom] = match;
    const x1 = Number(left), y1 = Number(top), x2 = Number(right), y2 = Number(bottom);
    if (x2 > x1 && y2 > y1) center = { x: Math.floor((x1 + x2) / 2), y: Math.floor((y1 + y2) / 2) };
  }
  return { descendantSelector, center, bounds, resourceId: attr(control, 'resource-id') };
}

export async function openAddStory(session: Session, directory = resolve('artifacts', `add-story-${Date.now()}`)): Promise<InstagramState> {
  const capture = (name: string) => saveScreenArtifacts({ getSession: () => session }, directory, name);
  const find = async () => {
    const buttons = [];
    for (const element of await session.$$('~Add to story')) {
      if (await element.isExisting() && await element.isDisplayed() && await element.getAttribute('class') === 'android.widget.Button' &&
        await element.getAttribute('content-desc') === 'Add to story') buttons.push(element);
    }
    if (buttons.length !== 1) throw new Error(`Add to story ausente ou ambíguo: ${buttons.length} botões visíveis.`);
    const [element] = buttons;
    if (!element) throw new Error('Add to story ausente.');
    const clickable = await element.getAttribute('clickable');
    if (!await element.isEnabled() || clickable && clickable !== 'true') throw new Error('Add to story não está habilitado/clicável.');
    if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram não está em primeiro plano.');
    return element;
  };
  const logAttributes = async (element: Awaited<ReturnType<typeof find>>) => {
    const attributes: Record<string, unknown> = { elementId: element.elementId ?? null, displayed: await element.isDisplayed(), enabled: await element.isEnabled() };
    for (const name of ['resource-id', 'content-desc', 'text', 'class', 'clickable', 'bounds']) attributes[name] = await element.getAttribute(name);
    console.log('[HOME] Add to story encontrado:', JSON.stringify(attributes));
  };
  const wait = async (attempt: number) => {
    let state: InstagramState = 'STATE_HOME';
    let probeError: unknown;
    try {
      await session.waitUntil(async () => {
        try { state = await detectInstagramState(session); }
        catch (error) { probeError = error; throw error; }
        return state === 'STATE_CREATE' || state === 'STATE_GALLERY' || isEditorState(state);
      }, { timeout: 3_000, interval: 400, timeoutMsg: 'Aguardando transição de Add to story.' });
    } catch (error: unknown) {
      if (probeError) throw probeError;
      if (!(error instanceof Error) || !/Aguardando transição|waitUntil.*timed out|^timeout$/i.test(error.message)) throw error;
    }
    await capture(`add-story-click-${attempt}`);
    console.log(`[HOME] estado após tentativa ${attempt}: ${state}`);
    if (state !== 'STATE_HOME' && state !== 'STATE_CREATE' && state !== 'STATE_GALLERY' && !isEditorState(state)) throw new Error(`Estado não comprovado após clique: ${state}; novas tentativas canceladas.`);
    return state;
  };
  await capture('add-story-before');
  let target = await find();
  await logAttributes(target);
  console.log('[HOME] tentativa 1: element.click()');
  await target.click();
  let state = await wait(1);
  if (state !== 'STATE_HOME') return state;

  let evidence;
  try { evidence = inspectAddStoryControl(await session.getPageSource()); }
  catch (error) { throw new Error('[HOME] Add to story clicado, mas permaneceu na Home; fallback sem hierarquia inequívoca cancelado.', { cause: error }); }
  if (evidence.descendantSelector) {
    const children = await session.$$(evidence.descendantSelector);
    if (children.length === 1) {
      for (const child of children) {
        if (await child.isDisplayed() && await child.isEnabled()) {
          console.log(`[HOME] tentativa 2: descendente ${evidence.descendantSelector}`);
          await child.click();
          state = await wait(2);
          if (state !== 'STATE_HOME') return state;
        }
      }
    }
  } else console.log('[HOME] tentativa 2: sem descendente inequívoco; clique omitido');
  // A hierarquia é lida novamente imediatamente antes do único gesto por bounds.
  target = await find();
  evidence = inspectAddStoryControl(await session.getPageSource());
  if (!evidence.center || await target.getAttribute('bounds') !== evidence.bounds || await target.getAttribute('resource-id') !== evidence.resourceId) {
    throw new Error('[HOME] Add to story clicado, mas permaneceu na Home; bounds atuais não comprovados.');
  }
  await logAttributes(target);
  console.log(`[HOME] tentativa 3: gesture bounds center ${JSON.stringify(evidence.center)}`);
  await session.execute('mobile: clickGesture', evidence.center);
  state = await wait(3);
  if (state === 'STATE_HOME') throw new Error('[HOME] Add to story clicado, mas permaneceu na Home');
  return state;
}
