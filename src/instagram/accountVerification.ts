import { inspectResetScreen } from "./normalizeInstagramToHome.js";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { InstagramDriver } from "./InstagramDriver.js";
import { detectInstagramState } from "./instagramStateMachine.js";
import { saveScreenArtifacts } from "./diagnostics.js";
import { resolve } from "node:path";
export const PROFILE_TAB_ID = "com.instagram.android:id/profile_tab"; // Observed in user's post-publish.xml.
export interface AccountCandidate {
  resource_id: string;
  text: string;
  content_desc: string;
  class: string;
  bounds: string;
}
export interface AccountDetection {
  username: string | null;
  status: "OK" | "LOGGED_OUT" | "UNAVAILABLE" | "UNKNOWN";
  evidence?: {
    profile_selected: boolean;
    username_resource_id: string;
    captured_at: string;
  };
  candidates?: AccountCandidate[];
  message?: string;
}
function hierarchyNodes(source: string): Record<string, string>[] {
  if (
    /<!DOCTYPE|<!ENTITY/i.test(source) ||
    XMLValidator.validate(source) !== true
  )
    throw Error("Hierarchy inválida.");
  const nodes: Record<string, string>[] = [];
  const visit = (node: any) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const attrs = Object.fromEntries(
      Object.entries(node)
        .filter(([k]) => k.startsWith("@_"))
        .map(([k, v]) => [k.slice(2), String(v)]),
    );
    if (attrs["class"]) nodes.push(attrs);
    Object.entries(node)
      .filter(([k]) => !k.startsWith("@_"))
      .forEach(([, v]) => visit(v));
  };
  visit(
    new XMLParser({
      ignoreAttributes: false,
      parseAttributeValue: false,
      trimValues: false,
    }).parse(source),
  );
  return nodes;
}
/** Candidate discovery uses only the observed own-profile hierarchy; no guessed username IDs. */
export function accountCandidates(source: string, screenHeight: number) {
  const nodes = hierarchyNodes(source);
  const blockedIds = new Set([
    "asset_button",
    "com.instagram.android:id/your_story_share_shortcut_button",
    "com.instagram.android:id/gallery_grid_container",
    "com.instagram.android:id/cam_dest_story",
    "com.instagram.android:id/link_sticker_list_web_url_edit_text",
    "com.instagram.android:id/sticker_sheet_redesign_item",
  ]);
  if (
    nodes.some(
      (n) =>
        n.displayed === "true" &&
        (blockedIds.has(n["resource-id"] ?? "") ||
          /Dialog$/.test(n.class ?? "")),
    )
  )
    return { profile_selected: false, candidates: [] as AccountCandidate[] };
  const profile = nodes.filter(
    (n) =>
      n["resource-id"] === PROFILE_TAB_ID &&
      n.selected === "true" &&
      n.displayed === "true",
  );
  if (profile.length !== 1)
    return { profile_selected: false, candidates: [] as AccountCandidate[] };
  const candidates = nodes
    .filter((n) => {
      const bounds = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(n.bounds ?? "");
      const text = n.text ?? "";
      return (
        n.package === "com.instagram.android" &&
        n.displayed === "true" &&
        ["android.widget.TextView", "android.widget.Button"].includes(
          n.class ?? "",
        ) &&
        !!n["resource-id"] &&
        /^[A-Za-z0-9._]{1,30}$/.test(text) &&
        /[A-Za-z_]/.test(text) &&
        ![
          "profile",
          "instagram",
          "posts",
          "followers",
          "following",
          "edit",
          "professional",
          "dashboard",
          "menu",
        ].includes(text.toLowerCase()) &&
        !!bounds &&
        Number(bounds[2]) >= 0 &&
        Number(bounds[4]) <= screenHeight * 0.18 &&
        Number(bounds[3]) > Number(bounds[1])
      );
    })
    .map((n) => ({
      resource_id: n["resource-id"]!,
      text: n.text!,
      content_desc: n["content-desc"] ?? "",
      class: n.class!,
      bounds: n.bounds!,
    }));
  return { profile_selected: true, candidates };
}
export async function readAccountFromOwnProfile(
  session: ReturnType<InstagramDriver["getSession"]>,
  usernameResourceId?: string,
): Promise<AccountDetection> {
  if ((await session.getCurrentPackage()) !== "com.instagram.android")
    return {
      username: null,
      status: "UNKNOWN",
      message: "Instagram não está em primeiro plano.",
    };
  const { height } = await session.getWindowSize();
  const observation = accountCandidates(await session.getPageSource(), height);
  if (!observation.profile_selected)
    return {
      username: null,
      status: "UNKNOWN",
      message: "O próprio perfil não foi comprovado.",
    };
  const selected = usernameResourceId
    ? observation.candidates.filter((c) => c.resource_id === usernameResourceId)
    : observation.candidates.filter((c) =>
        /(?:user.?name|account.?name|action_bar_title|profile.?title)/i.test(
          c.resource_id,
        ),
      );
  if (selected.length !== 1)
    return {
      username: null,
      status: "UNKNOWN",
      candidates: observation.candidates,
      message: "Escolha o nome exibido no cabeçalho do seu perfil.",
    };
  const candidate = selected.find(() => true)!;
  const collection = await session.$$(
    `android=new UiSelector().resourceId(${JSON.stringify(candidate.resource_id)})`,
  );
  const visible = [];
  for (const element of collection)
    if (await element.isDisplayed()) visible.push(element);
  if (visible.length !== 1)
    return {
      username: null,
      status: "UNKNOWN",
      candidates: observation.candidates,
      message: "Nome do perfil ambíguo.",
    };
  const element = visible.find(() => true)!;
  const live = await element.getText();
  if (live !== candidate.text)
    return {
      username: null,
      status: "UNKNOWN",
      message: "A tela mudou durante a verificação.",
    };
  // Re-read after live Appium value: stale/hidden nodes do not prove identity.
  const confirmed = accountCandidates(await session.getPageSource(), height);
  if (
    !confirmed.profile_selected ||
    confirmed.candidates.filter(
      (c) => c.resource_id === candidate.resource_id && c.text === live,
    ).length !== 1
  )
    return {
      username: null,
      status: "UNKNOWN",
      message: "Perfil não se manteve disponível.",
    };
  return {
    username: live,
    status: "OK",
    candidates: confirmed.candidates,
    evidence: {
      profile_selected: true,
      username_resource_id: candidate.resource_id,
      captured_at: new Date().toISOString(),
    },
  };
}
/** Runs locally only on explicit Verify; no reset, logout, storage cleanup or publication. */
export type AccountDetector = (
  usernameResourceId?: string,
) => Promise<AccountDetection>;
/** Shared observation for local UI and a real job's existing Appium session. */
export async function observeOwnInstagramAccount(
  driver: Pick<InstagramDriver, "getSession">,
  directory: string,
  usernameResourceId?: string,
): Promise<AccountDetection> {
  const session = driver.getSession();
  let own = accountCandidates(
    await session.getPageSource(),
    (await session.getWindowSize()).height,
  );
  if (!own.profile_selected) {
    const state = await detectInstagramState(session);
    if (state !== "STATE_HOME")
      return {
        username: null,
        status: "UNKNOWN",
        message:
          "Volte ao início do Instagram para confirmar a conta. Sua edição não foi alterada.",
      };
    const items = await session.$$(
      `android=new UiSelector().resourceId(${JSON.stringify(PROFILE_TAB_ID)})`,
    );
    const visible = [];
    for (const e of items)
      if ((await e.isDisplayed()) && (await e.isEnabled())) visible.push(e);
    if (visible.length !== 1)
      return {
        username: null,
        status: "UNKNOWN",
        message: "A aba do próprio perfil não pôde ser identificada.",
      };
    await visible.find(() => true)!.click();
    await session.waitUntil(
      async () =>
        accountCandidates(
          await session.getPageSource(),
          (await session.getWindowSize()).height,
        ).profile_selected,
      {
        timeout: 5000,
        interval: 500,
        timeoutMsg: "Perfil não confirmado.",
      },
    );
  }
  await saveScreenArtifacts(driver, directory, "own-profile");
  return await readAccountFromOwnProfile(session, usernameResourceId);
}
export function localAccountDetector(): AccountDetector {
  let running = false;
  return async (usernameResourceId?: string): Promise<AccountDetection> => {
    if (running)
      return {
        username: null,
        status: "UNKNOWN",
        message: "Verificação em andamento.",
      };
    running = true;
    const driver = new InstagramDriver();
    let connected = false;
    const directory = resolve(
      "artifacts",
      `account-verification-${Date.now()}`,
    );
    try {
      await driver.checkAppium();
      await driver.connect();
      connected = true;
      await driver.openAndConfirmInstagram();
      return await observeOwnInstagramAccount(
        driver,
        directory,
        usernameResourceId,
      );
    } catch (error) {
      if (connected)
        await saveScreenArtifacts(driver, directory, "error").catch(() => {});
      return { username: null, status: "UNAVAILABLE", message: String(error) };
    } finally {
      await driver.disconnect().catch(() => {});
      running = false;
    }
  };
}
