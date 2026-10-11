import { XMLParser } from 'fast-xml-parser';
import { extractInstagramElements } from './inspectElements.js';

/** Somente nós visíveis da hierarquia atual; não inclui filhos de overlays ocultos. */
export function visibleCameraNodes(source: string): Record<string, string>[] {
  extractInstagramElements(source);
  const result: Record<string, string>[] = [];
  function visit(value: unknown): void {
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (node['@_displayed'] === 'false') return;
    const attrs: Record<string, string> = {};
    for (const [key, item] of Object.entries(node)) if (key.startsWith('@_')) attrs[key.slice(2)] = String(item);
    if (Object.keys(attrs).length) result.push(attrs);
    for (const [key, item] of Object.entries(node)) if (!key.startsWith('@_')) visit(item);
  }
  visit(new XMLParser({ ignoreAttributes: false, parseAttributeValue: false }).parse(source));
  return result;
}
export function isStoryCameraHierarchy(source: string): boolean {
  const nodes = visibleCameraNodes(source);
  const labels = (node: Record<string, string>) => [node.text ?? '', node['content-desc'] ?? ''];
  const story = nodes.some(node => (node['resource-id'] === 'com.instagram.android:id/cam_dest_story' || labels(node).some(label => /^STORY$/i.test(label))) && node.selected === 'true');
  const permissionPrompt = nodes.some(node => labels(node).some(label => /Allow Instagram to access your camera and microphone/i.test(label))) &&
    nodes.some(node => labels(node).some(label => /^Open Settings$/i.test(label)));
  const capture = nodes.some(node => labels(node).some(label => /^(?:Capture|Take photo|Take a photo|Shutter)$/i.test(label)));
  return story && (permissionPrompt || capture);
}
