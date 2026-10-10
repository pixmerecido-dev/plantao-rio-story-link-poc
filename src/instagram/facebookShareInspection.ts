import { XMLParser } from 'fast-xml-parser';
import { extractInstagramElements } from './inspectElements.js';

export type ShareElement = {
  'resource-id': string; 'content-desc': string; text: string; class: string;
  checked: string | null; selected: string | null; enabled: string | null;
  clickable: string | null; displayed: string | null;
};
type Node = { element: ShareElement; children: Node[]; parent?: Node };
const facebookLabel = (element: ShareElement) => [element.text, element['content-desc']].some(value => /\b(?:and\s+)?facebook story\b/i.test(value));
const yourStoryLabel = (element: ShareElement) => [element.text, element['content-desc']].some(value => /\byour story\b/i.test(value));
const stateControl = (element: ShareElement) => /(?:Switch|CheckBox|RadioButton|ToggleButton|Button)$/.test(element.class);

/** Leitura somente; texto identifica disponibilidade, não prova configuração ativa. */
export function inspectFacebookShare(source: string) {
  extractInstagramElements(source); // valida XML e recusa DTD/entidades antes de parsear.
  const all: Node[] = [];
  function visit(value: unknown, parent?: Node): void {
    if (Array.isArray(value)) { for (const child of value) visit(child, parent); return; }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    let owner = parent;
    if (Object.keys(record).some(key => key.startsWith('@_'))) {
      const attr = (name: string): string | null => typeof record[`@_${name}`] === 'string' ? record[`@_${name}`] as string : null;
      const element: ShareElement = {
        'resource-id': attr('resource-id') ?? '', 'content-desc': attr('content-desc') ?? '', text: attr('text') ?? '', class: attr('class') ?? '',
        checked: attr('checked'), selected: attr('selected'), enabled: attr('enabled'), clickable: attr('clickable'), displayed: attr('displayed'),
      };
      owner = { element, children: [], parent }; all.push(owner); parent?.children.push(owner);
    }
    for (const [key, child] of Object.entries(record)) if (!key.startsWith('@_')) visit(child, owner);
  }
  visit(new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseAttributeValue: false, trimValues: false }).parse(source));
  const visible = (node: Node): boolean => node.element.displayed !== 'false' && (!node.parent || visible(node.parent));
  const relevant = all.filter(node => visible(node) && (facebookLabel(node.element) || yourStoryLabel(node.element)));
  const facebook = relevant.filter(node => facebookLabel(node.element));
  const associated = new Set<Node>();
  const descendants = (node: Node): Node[] => node.children.flatMap(child => [child, ...descendants(child)]);
  for (const node of facebook) {
    associated.add(node);
    // Filhos do bloco Facebook são associados pela hierarquia, sem IDs inventados.
    for (const child of descendants(node)) if (visible(child) && stateControl(child.element)) associated.add(child);
    // Uma linha exclusivamente Facebook pode expor o toggle como irmão do texto.
    const parent = node.parent;
    if (parent && parent.children.length === 2 &&
        parent.children.every(child => child === node || stateControl(child.element) && !yourStoryLabel(child.element) && !child.children.length) &&
        !yourStoryLabel(node.element)) {
      for (const sibling of parent.children) if (visible(sibling) && stateControl(sibling.element)) associated.add(sibling);
    }
  }
  const states = [...associated].filter(node => stateControl(node.element) && !yourStoryLabel(node.element)).map(node => {
    const element = node.element;
    // checked tem precedência; selected só para controle real, nunca label genérico.
    const checkable = /(?:Switch|CheckBox|RadioButton|ToggleButton)$/.test(element.class);
    const value = checkable && (element.checked === 'true' || element.checked === 'false') ? element.checked : element.selected;
    return value === 'true' ? true : value === 'false' ? false : undefined;
  }).filter((value): value is boolean => value !== undefined);
  const uniqueStates = new Set(states);
  const stateKnown = uniqueStates.size === 1;
  const observed = [...new Set([...relevant, ...associated])].map(node => ({
    ...node.element,
    selector: node.element['resource-id'] ? `android=new UiSelector().resourceId(${JSON.stringify(node.element['resource-id'])})`
      : node.element['content-desc'] ? `~${node.element['content-desc']}`
      : node.element.text ? `android=new UiSelector().text(${JSON.stringify(node.element.text)})` : null,
  }));
  return {
    facebook_story_available: facebook.length > 0,
    facebook_story_enabled: stateKnown && uniqueStates.has(true),
    facebook_story_state_known: stateKnown,
    facebook_story_status: stateKnown ? uniqueStates.has(true) ? 'enabled' : 'disabled' : uniqueStates.size > 1 ? 'ambiguous' : 'unknown',
    observed,
    note: stateKnown ? 'Estado observado em controle associado ao Facebook Story.' : 'Texto sozinho não confirma ativação; enabled=false não comprova desativação quando state_known=false.',
  };
}
