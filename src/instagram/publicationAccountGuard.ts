import { resolve, join } from "node:path";
import type { InstagramDriver } from "./InstagramDriver.js";
import { observeOwnInstagramAccount } from "./accountVerification.js";
import { normalizeInstagramToHome } from "./normalizeInstagramToHome.js";
import { detectInstagramState } from "./instagramStateMachine.js";
import { OperationsStorage } from "../admin/operationsStorage.js";
import type { OperationsRepository } from "../admin/operationsStorage.js";
import { InstagramAccountService } from "../admin/instagramAccountService.js";
import { DEFAULT_ACCOUNT_ID } from "../admin/operationsDomain.js";
async function returnToHome(driver: Pick<InstagramDriver, "getSession">) {
  const session = driver.getSession();
  const items = await session.$$(
    'android=new UiSelector().resourceId("com.instagram.android:id/feed_tab")',
  );
  const visible = [];
  for (const element of items)
    if ((await element.isDisplayed()) && (await element.isEnabled()))
      visible.push(element);
  if (visible.length !== 1)
    throw Error("Não foi possível retornar ao início após confirmar a conta.");
  const feed = visible.find(() => true)!;
  await feed.click();
  await session.waitUntil(
    async () =>
      (await feed.isSelected()) &&
      (await detectInstagramState(session)) === "STATE_HOME",
    {
      timeout: 5000,
      interval: 500,
      timeoutMsg: "Início não confirmado após verificação da conta.",
    },
  );
}
/** Outer safety gate only: core Story/link/layout/publication gestures remain unchanged. */
export async function verifyPublicationAccount(
  driver: Pick<InstagramDriver, "getSession">,
  directory: string,
  options: {
    store?: OperationsRepository;
    normalize?: typeof normalizeInstagramToHome;
    observe?: typeof observeOwnInstagramAccount;
    home?: typeof returnToHome;
  } = {},
) {
  const store =
    options.store ??
    new OperationsStorage(
      resolve(process.env.ADMIN_DATA_DIR ?? "data/admin", "operations.json"),
    );
  const existing = new InstagramAccountService(store);
  const expected = await existing.getExpectedAccount(DEFAULT_ACCOUNT_ID);
  if (!expected?.enabled || !expected.expected_username)
    throw Error(
      "Cadastre e habilite a conta esperada no painel antes de publicar.",
    );
  await (options.normalize ?? normalizeInstagramToHome)(
    driver,
    join(directory, "reset"),
  );
  const live = new InstagramAccountService(store, async (selector) => {
    const result = await (options.observe ?? observeOwnInstagramAccount)(
      driver,
      directory,
      selector,
    );
    const evidence = result.evidence;
    if (
      result.status === "OK" &&
      (!evidence?.profile_selected ||
        !evidence.username_resource_id ||
        !Number.isFinite(Date.parse(evidence.captured_at)) ||
        Math.abs(Date.now() - Date.parse(evidence.captured_at)) > 60000)
    )
      return {
        username: null,
        status: "UNKNOWN",
        message: "Identidade atual não comprovada.",
      };
    return result;
  });
  const result =
    await live.requireFreshAccountForPublication(DEFAULT_ACCOUNT_ID);
  await (options.home ?? returnToHome)(driver);
  console.log(
    `[ACCOUNT] conta confirmada para esta execução: @${result.detected}`,
  );
  return {
    account_id: DEFAULT_ACCOUNT_ID,
    account_expected: result.expected,
    account_detected: result.detected,
    account_verified_at: (await live.getExpectedAccount(DEFAULT_ACCOUNT_ID))
      ?.account_verified_at,
    account_match: true,
  };
}
