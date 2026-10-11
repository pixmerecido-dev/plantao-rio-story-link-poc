import { XMLParser } from 'fast-xml-parser';
import type { InstagramDriver } from './InstagramDriver.js';
import { extractInstagramElements } from './inspectElements.js';

type Session = ReturnType<InstagramDriver['getSession']>;
type Node = Record<string, unknown>;
const CANVAS_IDS = new Set(['com.instagram.android:id/capture_interactive_drawable_container', 'com.instagram.android:id/post_capture_interactive_contents_container']);
const HOLDER_ID = 'com.instagram.android:id/video_sticker_ltr_holder';
const attr = (node: Node, key: string) => String(node[`@_${key}`] ?? '');
function rectangle(bounds: string) {
  const match = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(bounds);
  if (!match) return undefined;
  const [, left, top, right, bottom] = match;
  const box = { left: Number(left), top: Number(top), right: Number(right), bottom: Number(bottom) };
  return box.right > box.left && box.bottom > box.top ? box : undefined;
}
function linkLabel(value: string) {
  return /\blink sticker\b/i.test(value) || /https?:\/\/[^\s]+/i.test(value) || /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?\b/i.test(value);
}

type LinkTransaction = { jobId: string; url: string; stickerText: string; baseline: Set<string>; confirmed: boolean; visual?: string };
// Sem arquivo, variável de ambiente ou armazenamento entre jobs/processos.
const transactions = new WeakMap<Session, LinkTransaction>();
const visualKey = (candidate: { contentDesc: string; bounds: string; text: string }) => JSON.stringify([candidate.contentDesc, candidate.bounds, candidate.text]);
export function clearCurrentLinkTransaction(session: Session): void { transactions.delete(session); }
export async function beginCurrentLinkTransaction(session: Session, jobId: string, url: string, stickerText: string): Promise<void> {
  transactions.delete(session);
  if (!jobId || !url || !stickerText) throw new Error('Transação Link exige dados do job atual.');
  const baseline = analyzeAppliedLinkCanvas(await session.getPageSource());
  if (!baseline.editorActive || baseline.candidates.length) throw new Error('Transação Link exige editor limpo sem sticker anterior.');
  transactions.set(session, { jobId, url, stickerText, baseline: new Set(baseline.candidates.map(visualKey)), confirmed: false });
}
/** Chamado apenas após valores lidos/confirmados, Done e retorno ao editor. */
export async function confirmCurrentLinkTransaction(session: Session, verified: { jobId: string; url: string; stickerText: string }): Promise<boolean> {
  const transaction = transactions.get(session);
  if (!transaction || transaction.jobId !== verified.jobId || transaction.url !== verified.url || transaction.stickerText !== verified.stickerText) return false;
  const report = await inspectAppliedLinkSticker(session);
  const live = report.liveVisualCandidates;
  if (!report.editorActive || report.candidates.length !== 1 || live.length !== 1) return false;
  for (const candidate of live) {
    const key = visualKey(candidate);
    if (transaction.baseline.has(key)) return false;
    transaction.visual = key;
    transaction.confirmed = true;
  }
  return true;
}

/** Publicação exige a transação viva desta sessão; evidência estrutural sozinha não autoriza. */
export async function requireCurrentLinkTransaction(session: Session, expectedJobId?: string): Promise<string> {
  const transaction = transactions.get(session);
  if (!transaction?.confirmed || (expectedJobId !== undefined && transaction.jobId !== expectedJobId)) {
    throw new Error('Publicação exige transaction confirmed/current job match do job atual no mesmo processo.');
  }
  const report = await inspectAppliedLinkSticker(session);
  if (transactions.get(session) !== transaction || !transaction.confirmed || !report.applied || report.liveVisualCandidates.length !== 1 ||
      !report.liveVisualCandidates.some(candidate => visualKey(candidate) === transaction.visual)) {
    throw new Error('Publicação exige Link aplicado e transação viva do job atual.');
  }
  return transaction.jobId;
}

/** Holder vazio não é sticker. Somente um objeto aplicado dentro do canvas real. */
export function analyzeAppliedLinkCanvas(source: string) {
  extractInstagramElements(source);
  const candidates: { resourceId: string; contentDesc: string; text: string; class: string; bounds: string; displayed: boolean; linkEvidence: boolean; selector?: string }[] = [];
  let editorActive = false, panelActive = false, holders = 0;
  const visit = (value: unknown, canvasBounds?: ReturnType<typeof rectangle>) => {
    if (Array.isArray(value)) { for (const child of value) visit(child, canvasBounds); return; }
    if (!value || typeof value !== 'object') return;
    const node = value as Node;
    if (attr(node, 'displayed') === 'false') return;
    const id = attr(node, 'resource-id'), desc = attr(node, 'content-desc'), text = attr(node, 'text');
    if (attr(node, 'displayed') === 'true' && (id === 'asset_button' || id === 'com.instagram.android:id/your_story_share_shortcut_button')) editorActive = true;
    if (id === HOLDER_ID) holders++;
    if (id === 'com.instagram.android:id/sticker_sheet_redesign_item' || /:id\/link_sticker_list_(web_url_edit_text|done_button|title)$/.test(id)) panelActive = true;
    const box = rectangle(attr(node, 'bounds'));
    const canvas = CANVAS_IDS.has(id) ? box : canvasBounds;
    const inside = box && canvas && box.left >= canvas.left && box.top >= canvas.top && box.right <= canvas.right && box.bottom <= canvas.bottom;
    // A descrição de objeto reposicionável foi observada no XML real enviado.
    const appliedObject = /^Sticker\. Touch and hold to reposition\./i.test(desc) || /^Link sticker(?:\b|\.)/i.test(desc);
    if (inside && appliedObject && !CANVAS_IDS.has(id) && id !== HOLDER_ID) {
      candidates.push({ resourceId: id, contentDesc: desc, text, class: attr(node, 'class'), bounds: attr(node, 'bounds'),
        displayed: attr(node, 'displayed') === 'true', linkEvidence: linkLabel(desc) || linkLabel(text),
        selector: id ? `android=new UiSelector().resourceId(${JSON.stringify(id)})` : desc ? `~${desc}` : undefined });
    }
    for (const [key, child] of Object.entries(node)) if (!key.startsWith('@_')) visit(child, canvas);
  };
  visit(new XMLParser({ ignoreAttributes: false, parseAttributeValue: false, trimValues: false }).parse(source));
  return { candidates, holders, editorActive: editorActive && !panelActive };
}

export async function inspectAppliedLinkSticker(session: Session) {
  console.log('[LINK-DETECT] verificando sticker aplicado');
  const analysis = analyzeAppliedLinkCanvas(await session.getPageSource());
  console.log(`[LINK-DETECT] candidatos encontrados: ${analysis.candidates.length}`);
  let applied = false, unconfirmedAppliedSticker = false;
  const liveVisualCandidates: typeof analysis.candidates = [];
  for (const candidate of analysis.candidates) {
    let displayed = false, liveLinkEvidence = false;
    if (candidate.displayed && candidate.selector) {
      const matching = [];
      for (const element of await session.$$(candidate.selector)) {
        try {
          if (!await element.isExisting() || !await element.isDisplayed() || await element.getAttribute('bounds') !== candidate.bounds ||
            await element.getAttribute('content-desc') !== candidate.contentDesc) continue;
          matching.push(element);
        } catch (error) {
          if (!(error instanceof Error) || !/stale element reference|no such element/i.test(error.message)) throw error;
        }
      }
      if (matching.length === 1) {
        for (const element of matching) {
          displayed = true;
          liveLinkEvidence = linkLabel(await element.getAttribute('content-desc') ?? '') || linkLabel(await element.getText());
        }
      }
    }
    console.log(`[LINK-DETECT] candidato: resource-id=${candidate.resourceId} content-desc=${candidate.contentDesc} displayed=${displayed} bounds=${candidate.bounds}`);
    if (analysis.editorActive && candidate.displayed) {
      if (displayed) liveVisualCandidates.push(candidate);
      if (displayed && candidate.linkEvidence && liveLinkEvidence) applied = true;
      else unconfirmedAppliedSticker = true;
    }
  }
  const transaction = transactions.get(session);
  const currentJobMatch = Boolean(transaction?.confirmed && liveVisualCandidates.length === 1 && liveVisualCandidates.some(candidate => visualKey(candidate) === transaction.visual));
  if (analysis.editorActive && currentJobMatch) { applied = true; unconfirmedAppliedSticker = false; }
  if (transaction?.confirmed && (!analysis.editorActive || !liveVisualCandidates.length)) transactions.delete(session);
  if (await session.getCurrentPackage() !== 'com.instagram.android') { applied = false; transactions.delete(session); }
  console.log(`[LINK-DETECT] visual sticker found=${liveVisualCandidates.length > 0}`);
  console.log(`[LINK-DETECT] transaction confirmed=${Boolean(transaction?.confirmed)}`);
  console.log(`[LINK-DETECT] current job match=${currentJobMatch}`);
  console.log(`[LINK-DETECT] evidência de sticker aplicado: ${applied}`);
  console.log(`[LINK-DETECT] applied=${applied}`);
  return { ...analysis, applied, unconfirmedAppliedSticker, liveVisualCandidates };
}

export async function hasAppliedLinkSticker(driver: Pick<InstagramDriver, 'getSession'>): Promise<boolean> {
  return (await inspectAppliedLinkSticker(driver.getSession())).applied;
}

/** Sticker visível sem tipo verificável: não reaplicar sobre rascunho desconhecido. */
export async function assertNoUnconfirmedAppliedSticker(session: Session) {
  const report = await inspectAppliedLinkSticker(session);
  if (report.unconfirmedAppliedSticker) throw new Error('Sticker já aplicado no canvas, mas tipo Link não verificável; reaplicação bloqueada. Inspecione o diagnóstico local.');
}
