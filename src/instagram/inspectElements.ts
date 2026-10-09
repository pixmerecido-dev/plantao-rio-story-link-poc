import { XMLParser, XMLValidator } from 'fast-xml-parser';

export type InstagramElement = {
  text: string;
  'content-desc': string;
  'resource-id': string;
  class: string;
};

/** Extrai somente atributos presentes na hierarquia, sem gerar seletores. */
export function extractInstagramElements(source: string): InstagramElement[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw new Error('A hierarquia não deve conter DTD ou declarações de entidades.');
  }
  const validation = XMLValidator.validate(source);
  if (validation !== true) {
    throw new Error(`Hierarquia XML inválida: ${validation.err.msg} (linha ${validation.err.line}).`);
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: false,
  });
  const elements: InstagramElement[] = [];
  function visit(node: unknown): void {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const attribute = (name: string): string => {
      const value = record[`@_${name}`];
      return typeof value === 'string' ? value : '';
    };
    const element: InstagramElement = {
      text: attribute('text'),
      'content-desc': attribute('content-desc'),
      'resource-id': attribute('resource-id'),
      class: attribute('class'),
    };
    if (Object.values(element).some(value => value.trim() !== '')) elements.push(element);
    for (const [key, child] of Object.entries(record)) {
      if (!key.startsWith('@_')) visit(child);
    }
  }
  visit(parser.parse(source) as unknown);
  return elements;
}
