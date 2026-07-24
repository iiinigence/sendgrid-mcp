# @iiinie/sendgrid-mcp

**Send emails, run campaigns, manage contacts, and read stats — by just asking your AI.**

An open-source [MCP](https://modelcontextprotocol.io) server for [SendGrid](https://sendgrid.com), built by [iiinie](https://iiinie.com). Works with Claude Desktop, Claude Code, and any MCP-compatible client.

> 🎥 Watch the full setup tutorial: *How to Connect Claude with SendGrid* — [link]

## Quick start

**1. Get a SendGrid API key** — Settings → API Keys → Create API Key → **Restricted Access** with only: Mail Send (Full), Marketing (Full), Template Engine (Read), Stats (Read).

**2. Verify your sender** — Settings → Sender Authentication. SendGrid won't send without this.

**3. Add to Claude Desktop** — Settings → Developer → Edit Config:

```json
{
  "mcpServers": {
    "sendgrid": {
      "command": "npx",
      "args": ["-y", "@iiinie/sendgrid-mcp"],
      "env": {
        "SENDGRID_API_KEY": "SG.your_key_here",
        "SENDGRID_FROM_EMAIL": "you@yourdomain.com",
        "READ_ONLY": "false"
      }
    }
  }
}
```

Restart Claude Desktop, then try: *"Send a test email to myself with the subject 'Hello from Claude'."*

## Tools

| Tool | What it does |
|------|--------------|
| `send_email` | Send a transactional email to one or more recipients |
| `send_campaign_to_list` | Create + send (or schedule) a Single Send campaign to marketing lists |
| `list_campaigns` | List recent campaigns and their status |
| `list_contact_lists` | List your marketing lists with contact counts |
| `list_contacts_in_list` | Contacts in a list, incl. names & custom fields (for personalization) |
| `add_contact` | Add/update a contact, optionally assigning lists |
| `list_senders` | Verified + marketing senders (needed for campaign `sender_id`) |
| `get_email_stats` | Global stats by day: delivered, opens, clicks, bounces |
| `get_campaign_stats` | Per-campaign performance |

## Configuration

| Env var | Required | Description |
|---------|----------|-------------|
| `SENDGRID_API_KEY` | ✅ | Restricted SendGrid API key |
| `SENDGRID_FROM_EMAIL` | — | Default verified sender for `send_email` |
| `READ_ONLY` | — | `true` = stats/contacts readable, all sending & writing blocked (default `false`) |
| `SENDGRID_BASE_URL` | — | Override for EU regional endpoint |

**Nervous about giving an AI send powers?** Start with `READ_ONLY: "true"` — your assistant can analyze stats and lists but can't send a thing until you flip it.

## Safety notes

- Use a **restricted** API key, never full access. Rotate it if it may have leaked.
- Keep yourself as the approval step: ask your assistant to preview before sending.
- Campaign sends require an unsubscribe group or custom unsubscribe URL (CAN-SPAM/GDPR compliance) — the tool enforces this.
- Free SendGrid tier caps at 100 emails/day.

## Who built this

[**iiinie**](https://iiinie.com) — email campaigns, outreach sequences, social posts, ads, and analytics in one AI-connected platform. This connector is what we use to teach *connecting Claude to one tool at a time*; iiinie is what we built for people who want the whole stack already wired together.

Need something custom? We also [build bespoke AI automations](https://iiinie.com) for businesses.

## Development

```bash
git clone https://github.com/iiinigence/sendgrid-mcp.git
cd sendgrid-mcp
npm install
npm run build
SENDGRID_API_KEY=SG.xxx node dist/index.js
```

MIT licensed. PRs welcome.
