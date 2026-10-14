import type { IncomingMessage, ServerResponse } from "node:http";
import type { RuntimeManager } from "./runtimeManager.js";
export function runtimeHttp(manager: RuntimeManager) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    body: () => Promise<unknown>,
    send: (res: ServerResponse, value: unknown, status?: number) => void,
  ) => {
    if (!url.pathname.startsWith("/api/runtime")) return false;
    if (req.method === "GET" && url.pathname === "/api/runtime") {
      const s = await manager.status();
      send(res, {
        application: "plantao-rio-stories",
        protocol_version: 1,
        panel_available: true,
        engine_prepared: s.ready,
        preparing: s.preparing,
        busy: s.busy,
        account_confirmed: s.account_confirmed,
        can_publish: false,
        test_mode: true,
        automation_paused: s.config.automation_paused,
        services: s.services,
        test: s.test
          ? {
              id: s.test.id,
              status: s.test.status,
              message: s.test.message,
              published: false,
            }
          : null,
        events: s.events.map((e) => ({ at: e.at, message: e.message })),
      });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/runtime/avds") {
      send(res, { avds: await manager.listAvds() });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/runtime/technical") {
      send(res, await manager.status());
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/runtime/refresh") {
      await body();
      await manager.refresh();
      send(res, { updated: true });
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/runtime/prepare") {
      await body();
      send(res, await manager.prepare());
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/runtime/test") {
      const input = await body() as {mode?: string};
      if (input.mode !== undefined && input.mode !== "layout" && input.mode !== "move") throw Error("Modo de teste inválido.");
      await manager.startTest(input.mode as "layout" | "move" | undefined);
      send(res, { started: true, published: false }, 202);
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/runtime/test/end") {
      await body();
      await manager.endTest();
      send(res, { started: true, published: false }, 202);
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/runtime/shutdown") {
      await body();
      await manager.stopApplication();
      send(res, { stopped: true });
      return true;
    }
    if (req.method === "PUT" && url.pathname === "/api/runtime/config") {
      await manager.configure((await body()) as Record<string, unknown>);
      send(res, { saved: true, test_mode: true });
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/runtime/control") {
      const input = (await body()) as { action?: string };
      await manager.control(input.action ?? "");
      send(res, { accepted: true });
      return true;
    }
    send(res, { error: "Ação indisponível." }, 404);
    return true;
  };
}
