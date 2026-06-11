import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Server function failed";
}

function renderServerFnError(error: unknown): Response {
  const message = getErrorMessage(error);
  return new Response(
    JSON.stringify({
      t: 10,
      i: 0,
      p: {
        k: ["result", "error", "context"],
        v: [
          { t: 2, s: 1 },
          { t: 25, i: 1, s: { message: { t: 1, s: message } }, c: "$TSR/Error" },
          { t: 10, i: 2, p: { k: [], v: [] }, o: 0 },
        ],
      },
      o: 0,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-tss-serialized": "true",
      },
    },
  );
}

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(
  response: Response,
  isServerFnRequest: boolean,
): Promise<Response> {
  if (response.status < 500) return response;
  if (isServerFnRequest) {
    if (response.headers.get("x-tss-serialized") === "true") return response;
    return renderServerFnError(new Error("Server function failed"));
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const isServerFnRequest = new URL(request.url).pathname.startsWith("/_serverFn/");
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response, isServerFnRequest);
    } catch (error) {
      if (isServerFnRequest) return renderServerFnError(error);
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
