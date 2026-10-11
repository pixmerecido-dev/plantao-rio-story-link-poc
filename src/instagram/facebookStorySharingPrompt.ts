import { XMLParser } from 'fast-xml-parser';
import { extractInstagramElements } from './inspectElements.js';
import type { InstagramDriver } from './InstagramDriver.js';

export const FACEBOOK_PROMPT_TITLE = 'Share your stories to Facebook too';
export const ALWAYS_SHARE_LABEL = 'Always share stories';
const exactText = (value: string) => `android=new UiSelector().text(${JSON.stringify(value)})`;

/** Labels exatos e únicos no mesmo ramo visível; não presume resource-ids. */
export function inspectFacebookStorySharingPrompt(source: string) {
  if (!source.includes(FACEBOOK_PROMPT_TITLE)) return undefined;
  extractInstagramElements(source);
  type Attributes = Record<string, string>;
  const scopes: Attributes[][] = [];
  const dialogs: Attributes[][] = [];
  function visit(value: unknown): Attributes[] {
    if (Array.isArray(value)) return value.flatMap(visit);
    if (!value || typeof value !== 'object') return [];
    const node = value as Record<string, unknown>;
    if (node['@_displayed'] === 'false') return [];
    const own: Attributes = {};
    for (const [key, val] of Object.entries(node)) if (key.startsWith('@_')) own[key.slice(2)] = String(val);
    const children = Object.entries(node).filter(([key]) => !key.startsWith('@_')).flatMap(([, val]) => visit(val));
    const nodes = Object.keys(own).length ? [own, ...children] : children;
    const match = (label: string) => nodes.filter(item => item.text === label || item['content-desc'] === label);
    if (/Dialog$/.test(own.class ?? '') || /dialog|alert|:id\/parentPanel$/i.test(own['resource-id'] ?? '')) dialogs.push(nodes);
    if (Object.keys(own).length && match(FACEBOOK_PROMPT_TITLE).length === 1 && match(ALWAYS_SHARE_LABEL).length === 1 && match('Not now').length === 1) scopes.push(nodes);
    return nodes;
  }
  const all = visit(new XMLParser({ ignoreAttributes: false, parseAttributeValue: false, trimValues: false }).parse(source));
  for (const label of [FACEBOOK_PROMPT_TITLE, ALWAYS_SHARE_LABEL, 'Not now']) {
    if (all.filter(node => node.text === label || node['content-desc'] === label).length !== 1) return undefined;
  }
  // Primeiro ramo encontrado é o menor ancestral comum, e deve ser um controle/container real.
  for (const scope of dialogs.length ? scopes.filter(scope => dialogs.includes(scope)) : scopes) {
    for (const node of scope) if (node.text === ALWAYS_SHARE_LABEL || node['content-desc'] === ALWAYS_SHARE_LABEL) {
      const id = node['resource-id'] ?? '', desc = node['content-desc'] ?? '';
      return { state: 'STATE_FACEBOOK_STORY_SHARING_PROMPT' as const,
        selector: id ? `android=new UiSelector().resourceId(${JSON.stringify(id)})` : desc ? `~${desc}` : exactText(ALWAYS_SHARE_LABEL),
        attributes: node };
    }
  }
  return undefined;
}

/** Apenas seleção do controle exato; autorização pertence à tentativa de publicação. */
export async function findAlwaysShareControl(session: ReturnType<InstagramDriver['getSession']>, selector: string) {
  const matches = await session.$$(selector);
  if (matches.length !== 1) throw new Error('Always share stories ausente ou ambíguo; clique cancelado.');
  for (const element of matches) {
    if (!element.elementId || !await element.isExisting() || !await element.isDisplayed() || !await element.isEnabled() ||
      await element.getAttribute('clickable') !== 'true' ||
      (await element.getText() !== ALWAYS_SHARE_LABEL && await element.getAttribute('content-desc') !== ALWAYS_SHARE_LABEL)) throw new Error('Always share stories não confirma atributos vivos; clique cancelado.');
    return element;
  }
  throw new Error('Always share stories ausente.');
}

/** Overlay desconhecido visível não autoriza ação nem confirmação otimista. */
export function hasUnknownPublicationDialog(source: string): boolean {
  if (inspectFacebookStorySharingPrompt(source) || !/Dialog|dialog|alert|parentPanel/.test(source)) return false;
  extractInstagramElements(source);
  function visit(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(visit);
    if (!value || typeof value !== 'object') return false;
    const node = value as Record<string, unknown>;
    if (node['@_displayed'] === 'false') return false;
    if (/Dialog$/.test(String(node['@_class'] ?? '')) || /dialog|alert|:id\/parentPanel$/i.test(String(node['@_resource-id'] ?? ''))) return true;
    return Object.entries(node).some(([key, child]) => !key.startsWith('@_') && visit(child));
  }
  return visit(new XMLParser({ ignoreAttributes: false, parseAttributeValue: false }).parse(source));
}
