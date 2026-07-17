import type { Config, Context } from "@netlify/edge-functions";

export default async (_request: Request, context: Context) => {
  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;
  const html = await response.text();
  const body = html.includes("/online.js") ? html : html.replace("</body>", '<script src="/online.js" defer></script></body>');
  return new Response(body, { status: response.status, headers: response.headers });
};

export const config: Config = { path: "/" };
