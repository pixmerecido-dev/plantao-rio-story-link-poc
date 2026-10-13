import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import {
  canViewRoute,
  UI_STATUS_LABELS,
  articleLabel,
} from "../dist/admin/editorialUi.js";
import {
  accountCandidates,
  readAccountFromOwnProfile,
  PROFILE_TAB_ID,
} from "../dist/instagram/accountVerification.js";
import { InstagramAccountService } from "../dist/admin/instagramAccountService.js";
import { OperationsStorage } from "../dist/admin/operationsStorage.js";
const id = "com.instagram.android:id/TEST_ONLY_observed_username";
const profile = (selected = true, extra = "", name = "pixmerecido") =>
  `<hierarchy><node package="com.instagram.android" class="android.widget.FrameLayout" resource-id="${PROFILE_TAB_ID}" selected="${selected}" displayed="true" bounds="[864,2211][1080,2337]"/><node package="com.instagram.android" class="android.widget.TextView" resource-id="${id}" text="${name}" displayed="true" bounds="[40,60][600,140]"/>${extra}</hierarchy>`;
function session(source, live = "pixmerecido") {
  let reads = 0;
  return {
    getCurrentPackage: async () => "com.instagram.android",
    getWindowSize: async () => ({ width: 1080, height: 2400 }),
    getPageSource: async () =>
      typeof source === "function" ? source(++reads) : source,
    $$: async () => [
      { isDisplayed: async () => true, getText: async () => live },
    ],
  };
}
test("editorial labels preserve internal codes and role routes keep technical screens out of operation", () => {
  for (const [code, label] of Object.entries({
    READY: "Pronto",
    QUEUED: "Na fila",
    SCHEDULED: "Agendado",
    PUBLISHING: "Publicando",
    SUCCESS: "Publicado",
    FAILED: "Erro",
    PAUSED: "Pausado",
    CANCELLED: "Cancelado",
  }))
    assert.equal(UI_STATUS_LABELS[code], label);
  assert.equal(canViewRoute("OPERATOR", "queue"), true);
  assert.equal(canViewRoute("OPERATOR", "logs"), false);
  assert.equal(canViewRoute("OPERATOR", "configuration"), false);
  assert.equal(canViewRoute("ADMIN", "logs"), true);
  assert.equal(canViewRoute("OPERATOR", "settings", false), false);
  assert.equal(canViewRoute("OPERATOR", "bogus"), false);
  assert.equal(articleLabel("https://example.com/materia-abc123"), "Materia");
  assert.equal(
    articleLabel("https://example.com/x", "Título fornecido"),
    "Título fornecido",
  );
});
test("real live own-profile observations confirm account; expected manual username never supplies detection", async () => {
  const result = await readAccountFromOwnProfile(session(profile()));
  assert.equal(result.status, "OK");
  assert.equal(result.username, "pixmerecido");
  assert.equal(result.evidence.profile_selected, true);
  assert.equal(result.evidence.username_resource_id, id);
  const file = join(await mkdtemp("/tmp/account-ux-"), "ops.json");
  const store = new OperationsStorage(file);
  const service = new InstagramAccountService(store, async () => result);
  await service.configure("instagram-default", {
    expected_username: "plantaorio",
    display_name: "Plantão Rio",
    enabled: true,
  });
  assert.equal(
    (await service.detectCurrentAccount("instagram-default")).status,
    "MISMATCH",
  );
  assert.equal(
    (await service.validateActiveAccount("instagram-default")).match,
    false,
  );
  await service.configure("instagram-default", {
    expected_username: "@pixmerecido",
    display_name: "Minha conta",
    enabled: true,
  });
  const verified = await service.detectCurrentAccount("instagram-default");
  assert.equal(verified.status, "OK");
  assert.equal(verified.account_match, true);
  assert.equal(verified.account_detected, "pixmerecido");
  assert.ok(verified.account_verified_at);
  assert.ok(
    (await store.read()).events.some((e) => e.event === "ACCOUNT_CHECKED"),
  );
});
test("profile-only detection refuses absent/hidden/stale/ambiguous username and another package", async () => {
  assert.equal(
    (await readAccountFromOwnProfile(session(profile(false)))).status,
    "UNKNOWN",
  );
  assert.equal(
    (
      await readAccountFromOwnProfile(
        session(
          profile(
            true,
            '<node class="android.view.ViewGroup" resource-id="asset_button" displayed="true"/>',
          ),
        ),
      )
    ).status,
    "UNKNOWN",
  );
  assert.equal(
    (
      await readAccountFromOwnProfile(
        session(
          profile().replace(
            'text="pixmerecido" displayed="true"',
            'text="pixmerecido" displayed="false"',
          ),
        ),
      )
    ).status,
    "UNKNOWN",
  );
  assert.equal(
    (await readAccountFromOwnProfile(session(profile(), "other"))).status,
    "UNKNOWN",
  );
  const extra =
    '<node package="com.instagram.android" class="android.widget.TextView" resource-id="com.instagram.android:id/TEST_ONLY_second_username" text="otheraccount" displayed="true" bounds="[40,160][600,240]"/>';
  assert.equal(
    accountCandidates(profile(true, extra), 2400).candidates.length,
    2,
  );
  assert.equal(
    (await readAccountFromOwnProfile(session(profile(true, extra)))).status,
    "UNKNOWN",
  );
  assert.equal(
    (await readAccountFromOwnProfile(session(profile(true, extra)), id)).status,
    "OK",
  );
  assert.equal(
    (
      await readAccountFromOwnProfile({
        ...session(profile()),
        getCurrentPackage: async () => "com.other.app",
      })
    ).status,
    "UNKNOWN",
  );
  assert.equal(
    (
      await readAccountFromOwnProfile(
        session((n) => (n === 1 ? profile() : profile(false))),
      )
    ).status,
    "UNKNOWN",
  );
  await assert.rejects(async () =>
    accountCandidates("<!DOCTYPE foo><hierarchy/>", 2400),
  );
});
test("username field configuration accepts only observed candidates and invalidates old confirmation", async () => {
  const store = new OperationsStorage(
    join(await mkdtemp("/tmp/account-selector-"), "ops.json"),
  );
  const detected = await readAccountFromOwnProfile(session(profile()));
  const service = new InstagramAccountService(store, async () => detected);
  await service.configure("instagram-default", {
    expected_username: "pixmerecido",
    display_name: "Minha conta",
    enabled: true,
  });
  await service.detectCurrentAccount("instagram-default");
  await assert.rejects(
    service.chooseUsernameField("instagram-default", "invented"),
  );
  const changed = await service.chooseUsernameField("instagram-default", id);
  assert.equal(changed.status, "UNKNOWN");
  assert.equal(changed.account_match, false);
  assert.equal(changed.verification_evidence, null);
});
test("publication account guard refreshes live identity and refuses cached confirmation after account changes", async () => {
  const store = new OperationsStorage(
    join(await mkdtemp("/tmp/account-fresh-"), "ops.json"),
  );
  let username = "pixmerecido",
    calls = 0;
  const service = new InstagramAccountService(store, async () => {
    calls++;
    return { status: "OK", username };
  });
  await service.configure("instagram-default", {
    expected_username: "pixmerecido",
    display_name: "Conta",
    enabled: true,
  });
  await service.requireFreshAccountForPublication("instagram-default");
  assert.equal(calls, 1);
  username = "outraconta";
  await assert.rejects(
    service.requireFreshAccountForPublication("instagram-default"),
    /Outra conta/,
  );
  assert.equal(calls, 2);
  assert.equal(
    (await service.validateActiveAccount("instagram-default")).match,
    false,
  );
});
test("real end-to-end outer gate verifies account in the current driver before Story work, mismatch aborts without returning or publishing", async () => {
  const { verifyPublicationAccount } = await import(
    "../dist/instagram/publicationAccountGuard.js"
  );
  const store = new OperationsStorage(
    join(await mkdtemp("/tmp/real-account-gate-"), "ops.json"),
  );
  const service = new InstagramAccountService(store);
  await service.configure("instagram-default", {
    expected_username: "pixmerecido",
    display_name: "Conta",
    enabled: true,
  });
  const calls = [];
  const driver = { getSession: () => session(profile()) };
  const dependencies = {
    store,
    normalize: async (d) => {
      assert.equal(d, driver);
      calls.push("home-before");
    },
    observe: async (d) => {
      assert.equal(d, driver);
      calls.push("live-profile");
      return readAccountFromOwnProfile(session(profile()));
    },
    home: async () => calls.push("home-after"),
  };
  const result = await verifyPublicationAccount(
    driver,
    "/tmp/mock-account-check",
    dependencies,
  );
  assert.equal(result.account_match, true);
  assert.deepEqual(calls, ["home-before", "live-profile", "home-after"]);
  calls.length = 0;
  await service.configure("instagram-default", {
    expected_username: "plantaorio",
    display_name: "Conta",
    enabled: true,
  });
  await assert.rejects(
    verifyPublicationAccount(driver, "/tmp/mock-account-check", dependencies),
    /Outra conta/,
  );
  assert.deepEqual(calls, ["home-before", "live-profile"]);
  await assert.rejects(
    verifyPublicationAccount(driver, "/tmp/mock-account-check", {
      ...dependencies,
      observe: async () => ({ username: "plantaorio", status: "OK" }),
    }),
    /Publicação bloqueada/,
  );
});
