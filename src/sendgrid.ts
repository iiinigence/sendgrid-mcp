/**
 * Thin typed wrapper around the SendGrid v3 REST API.
 * Uses global fetch (Node >= 18). No SDK dependency — every call is visible.
 */

const BASE_URL = process.env.SENDGRID_BASE_URL ?? "https://api.sendgrid.com";

export class SendGridError extends Error {
  constructor(
    public status: number,
    public body: string,
    message?: string
  ) {
    super(message ?? `SendGrid API error ${status}: ${body}`);
    this.name = "SendGridError";
  }
}

function apiKey(): string {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) {
    throw new Error(
      "SENDGRID_API_KEY environment variable is not set. " +
        "Create a restricted API key in SendGrid (Settings → API Keys) and add it to your MCP config."
    );
  }
  return key;
}

export async function sg<T = unknown>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new SendGridError(res.status, text);
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/** True when the server should block mutating operations. Defaults to false. */
export function isReadOnly(): boolean {
  const v = (process.env.READ_ONLY ?? "false").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export const READ_ONLY_MESSAGE =
  "Blocked: this iiinie SendGrid MCP server is running in READ_ONLY mode, so sending and writing are disabled. " +
  "Set READ_ONLY=false in the MCP server config to enable send/write operations.";
