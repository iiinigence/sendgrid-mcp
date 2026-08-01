#!/usr/bin/env node
/**
 * @iiinigence/sendgrid-mcp — open-source SendGrid MCP server by IIInigence (https://iiinigence.com)
 *
 * Lets Claude (and any MCP client) send emails, run list campaigns, manage
 * contacts, and read stats through the SendGrid v3 API.
 *
 * Env:
 *   SENDGRID_API_KEY     required — a RESTRICTED SendGrid API key
 *   SENDGRID_FROM_EMAIL  optional — default verified sender for send_email
 *   READ_ONLY            optional — "true" blocks all send/write tools (default "false")
 *   SENDGRID_BASE_URL    optional — e.g. EU endpoint
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { sg, isReadOnly, READ_ONLY_MESSAGE, SendGridError } from "./sendgrid.js";

const server = new McpServer({
  name: "iiinie-sendgrid",
  version: "0.1.10",
});

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function fail(err: unknown): ToolResult {
  const msg =
    err instanceof SendGridError
      ? `SendGrid API error (HTTP ${err.status}): ${err.body}`
      : err instanceof Error
        ? err.message
        : String(err);
  return { content: [{ type: "text", text: msg }], isError: true };
}

function guardWrite(): ToolResult | null {
  return isReadOnly()
    ? { content: [{ type: "text", text: READ_ONLY_MESSAGE }], isError: true }
    : null;
}

/** Configured HTML signature, appended verbatim to outgoing HTML email. */
function signatureHtml(): string {
  return (process.env.SENDGRID_SIGNATURE_HTML ?? "").trim();
}

function signatureText(): string {
  // plain-text rendering of the signature: strip tags, decode common entities
  return signatureHtml()
    .replace(/<br\s*\/?>(?=.)/gi, "\n")
    .replace(/<\/(p|div|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Minimal HTML rendering of a plain-text body so HTML signatures render everywhere. */
function htmlFromText(text: string): string {
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<div style="font-family:inherit;white-space:pre-wrap;">${esc}</div>`;
}


function withSignature(html?: string, text?: string, include = true): { html?: string; text?: string } {
  const sig = signatureHtml();
  if (!sig || !include) return { html, text };
  return {
    html: html ? `${html}<br><br><!-- signature -->${sig}` : html,
    text: text ? `${text}\n\n${signatureText()}` : text,
  };
}

function signatureNote(): string {
  return signatureHtml()
    ? "IMPORTANT: the user's branded signature is appended automatically to every email by this server. NEVER write a sign-off, closing line, or signature in the email body (no 'Best,', 'Talk soon,', names, or team names) — end the body after the final content paragraph. "
    : "";
}

/* ------------------------------------------------------------------ */
/* Senders                                                             */
/* ------------------------------------------------------------------ */

server.registerTool(
  "list_senders",
  {
    annotations: { title: "List senders", readOnlyHint: true, openWorldHint: true },
    description:
      "List verified senders (for transactional email) and marketing senders (needed as sender_id for campaigns). " +
      "Run this first if a send fails with a sender/from error.",
    inputSchema: {},
  },
  async () => {
    try {
      const [verified, marketing] = await Promise.all([
        sg("GET", "/v3/verified_senders").catch((e) => ({ error: String(e) })),
        sg("GET", "/v3/marketing/senders").catch((e) => ({ error: String(e) })),
      ]);
      return ok({ verified_senders: verified, marketing_senders: marketing });
    } catch (e) {
      return fail(e);
    }
  }
);

/* ------------------------------------------------------------------ */
/* Transactional email                                                 */
/* ------------------------------------------------------------------ */

server.registerTool(
  "send_email",
  {
    annotations: { title: "Send email", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    description:
      signatureNote() +
      "Send a transactional email via SendGrid to one or more recipients. " +
      "ALWAYS show the user a preview of subject and body and get their approval before calling this tool. " +
      "The from address must be a verified sender (defaults to SENDGRID_FROM_EMAIL).",
    inputSchema: {
      to: z.array(z.string()).min(1).describe("Recipient email addresses"),
      subject: z.string().describe("Email subject line"),
      html: z.string().optional().describe("HTML body (provide html and/or text)"),
      text: z.string().optional().describe("Plain-text body"),
      from: z
        .string()
        .optional()
        .describe("Verified sender address; defaults to SENDGRID_FROM_EMAIL"),
      from_name: z.string().optional().describe("Sender display name"),
      reply_to: z.string().optional().describe("Reply-to address"),
      include_signature: z
        .boolean()
        .optional()
        .describe("Set false to skip the configured signature for this email (default true)"),
    },
  },
  async ({ to, subject, html, text, from, from_name, reply_to, include_signature }) => {
    const blocked = guardWrite();
    if (blocked) return blocked;
    try {
      const fromEmail = from ?? process.env.SENDGRID_FROM_EMAIL;
      if (!fromEmail) {
        return fail(
          new Error(
            "No from address: pass `from` or set SENDGRID_FROM_EMAIL. It must be a verified sender (use list_senders)."
          )
        );
      }
      if (!html && !text) {
        return fail(new Error("Provide `html` and/or `text` for the email body."));
      }
      const htmlBody = html ?? (text && signatureHtml() ? htmlFromText(text) : undefined);
      const signed = withSignature(htmlBody, text, include_signature !== false);
      const content: Array<{ type: string; value: string }> = [];
      if (signed.text) content.push({ type: "text/plain", value: signed.text });
      if (signed.html) content.push({ type: "text/html", value: signed.html });

      await sg("POST", "/v3/mail/send", {
        personalizations: [{ to: to.map((email) => ({ email })) }],
        from: { email: fromEmail, name: from_name },
        ...(reply_to ? { reply_to: { email: reply_to } } : {}),
        subject,
        content,
      });
      return ok(`Email "${subject}" sent to ${to.join(", ")} from ${fromEmail}.`);
    } catch (e) {
      return fail(e);
    }
  }
);

/* ------------------------------------------------------------------ */
/* Contacts & lists                                                    */
/* ------------------------------------------------------------------ */

server.registerTool(
  "list_contact_lists",
  {
    annotations: { title: "List contact lists", readOnlyHint: true, openWorldHint: true },
    description: "List all SendGrid marketing contact lists with their IDs and contact counts.",
    inputSchema: {},
  },
  async () => {
    try {
      return ok(await sg("GET", "/v3/marketing/lists?page_size=100"));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "list_contacts_in_list",
  {
    annotations: { title: "List contacts in a list", readOnlyHint: true, openWorldHint: true },
    description:
      "List the contacts in a specific marketing list (by list ID from list_contact_lists). " +
      "Returns emails plus first/last name and custom fields — useful for personalized sends.",
    inputSchema: {
      list_id: z.string().describe("The marketing list ID"),
    },
  },
  async ({ list_id }) => {
    try {
      const result = await sg("POST", "/v3/marketing/contacts/search", {
        query: `CONTAINS(list_ids, '${list_id.replace(/'/g, "")}')`,
      });
      return ok(result);
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "add_contact",
  {
    annotations: { title: "Add or update contact", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    description:
      "Add or update (upsert by email) a contact in SendGrid marketing contacts, optionally assigning to lists. " +
      "Note: SendGrid processes contact upserts asynchronously — the contact can take a minute to appear.",
    inputSchema: {
      email: z.string().describe("Contact email address"),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      list_ids: z.array(z.string()).optional().describe("List IDs to add the contact to"),
      custom_fields: z
        .record(z.union([z.string(), z.number()]))
        .optional()
        .describe("Custom field id → value map (field IDs, not display names)"),
    },
  },
  async ({ email, first_name, last_name, list_ids, custom_fields }) => {
    const blocked = guardWrite();
    if (blocked) return blocked;
    try {
      const result = await sg("PUT", "/v3/marketing/contacts", {
        ...(list_ids?.length ? { list_ids } : {}),
        contacts: [
          {
            email,
            ...(first_name ? { first_name } : {}),
            ...(last_name ? { last_name } : {}),
            ...(custom_fields ? { custom_fields } : {}),
          },
        ],
      });
      return ok({ message: `Contact ${email} queued for upsert.`, result });
    } catch (e) {
      return fail(e);
    }
  }
);

/* ------------------------------------------------------------------ */
/* Campaigns (Single Sends)                                            */
/* ------------------------------------------------------------------ */

server.registerTool(
  "send_campaign_to_list",
  {
    annotations: { title: "Send campaign to list", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    description:
      signatureNote() +
      "Create AND send a Single Send campaign to one or more marketing lists, immediately or scheduled. " +
      "ALWAYS show the user the subject and body and get explicit approval before calling this. " +
      "Requires a marketing sender_id (from list_senders). The unsubscribe group is handled automatically " +
      "(the account default is used) — only pass suppression_group_id or custom_unsubscribe_url to override.",
    inputSchema: {
      name: z.string().describe("Internal campaign name, e.g. 'July newsletter'"),
      list_ids: z.array(z.string()).min(1).describe("Marketing list IDs to send to"),
      subject: z.string().describe("Email subject line"),
      html: z.string().describe("HTML body of the campaign"),
      sender_id: z.number().describe("Marketing sender ID (integer, from list_senders)"),
      suppression_group_id: z
        .number()
        .optional()
        .describe("Unsubscribe group ID. Usually omit this — the server auto-uses the account's default unsubscribe group."),
      custom_unsubscribe_url: z.string().optional(),
      send_at: z
        .string()
        .optional()
        .describe('ISO-8601 time to schedule, or omit to send now'),
    },
  },
  async ({
    name,
    list_ids,
    subject,
    html,
    sender_id,
    suppression_group_id,
    custom_unsubscribe_url,
    send_at,
  }) => {
    const blocked = guardWrite();
    if (blocked) return blocked;
    try {
      if (!suppression_group_id && !custom_unsubscribe_url) {
        // Auto-resolve: use the account's default unsubscribe group, or the only one that exists.
        const groups = (await sg<Array<{ id: number; name: string; is_default: boolean }>>(
          "GET",
          "/v3/asm/groups"
        )) ?? [];
        const pick = groups.find((g) => g.is_default) ?? (groups.length === 1 ? groups[0] : undefined);
        if (!pick) {
          return fail(
            new Error(
              "Compliance requirement: no unsubscribe group could be auto-selected. Create one in SendGrid (Settings → Unsubscribe Groups) or pass suppression_group_id / custom_unsubscribe_url. Use list_unsubscribe_groups to see what exists."
            )
          );
        }
        suppression_group_id = pick.id;
      }
      const created = await sg<{ id: string }>("POST", "/v3/marketing/singlesends", {
        name,
        send_to: { list_ids },
        email_config: {
          subject,
          html_content: withSignature(html, undefined, true).html ?? html,
          sender_id,
          ...(suppression_group_id ? { suppression_group_id } : {}),
          ...(custom_unsubscribe_url ? { custom_unsubscribe_url } : {}),
        },
      });
      const scheduled = await sg("PUT", `/v3/marketing/singlesends/${created.id}/schedule`, {
        send_at: send_at ?? "now",
      });
      return ok({
        message: send_at
          ? `Campaign "${name}" scheduled for ${send_at} to list(s) ${list_ids.join(", ")}.`
          : `Campaign "${name}" is sending now to list(s) ${list_ids.join(", ")}.`,
        singlesend_id: created.id,
        schedule: scheduled,
      });
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "list_campaigns",
  {
    annotations: { title: "List campaigns", readOnlyHint: true, openWorldHint: true },
    description: "List recent Single Send campaigns with their IDs and status.",
    inputSchema: {},
  },
  async () => {
    try {
      return ok(await sg("GET", "/v3/marketing/singlesends?page_size=100"));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "list_unsubscribe_groups",
  {
    annotations: { title: "List unsubscribe groups", readOnlyHint: true, openWorldHint: true },
    description:
      "List the account's unsubscribe (suppression) groups with IDs and which one is the default. " +
      "Campaign sends use the default group automatically when none is specified.",
    inputSchema: {},
  },
  async () => {
    try {
      return ok(await sg("GET", "/v3/asm/groups"));
    } catch (e) {
      return fail(e);
    }
  }
);

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

server.registerTool(
  "get_email_stats",
  {
    annotations: { title: "Get email stats", readOnlyHint: true, openWorldHint: true },
    description:
      "Get global email stats (requests, delivered, opens, clicks, bounces, spam reports) for a date range, aggregated by day.",
    inputSchema: {
      start_date: z.string().describe("YYYY-MM-DD"),
      end_date: z.string().optional().describe("YYYY-MM-DD, defaults to today"),
    },
  },
  async ({ start_date, end_date }) => {
    try {
      const params = new URLSearchParams({ start_date, aggregated_by: "day" });
      if (end_date) params.set("end_date", end_date);
      return ok(await sg("GET", `/v3/stats?${params.toString()}`));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "get_campaign_stats",
  {
    annotations: { title: "Get campaign stats", readOnlyHint: true, openWorldHint: true },
    description:
      "Get stats for Single Send campaigns (delivered, opens, clicks, bounces, unsubscribes). " +
      "Pass a singlesend_id from list_campaigns, or omit it for stats across all campaigns.",
    inputSchema: {
      singlesend_id: z.string().optional().describe("A specific Single Send campaign ID"),
    },
  },
  async ({ singlesend_id }) => {
    try {
      const path = singlesend_id
        ? `/v3/marketing/stats/singlesends/${singlesend_id}`
        : "/v3/marketing/stats/singlesends?page_size=50";
      return ok(await sg("GET", path));
    } catch (e) {
      return fail(e);
    }
  }
);

/* ------------------------------------------------------------------ */

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `IIInigence SendGrid MCP server running (read-only: ${isReadOnly()}). https://iiinigence.com`
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
