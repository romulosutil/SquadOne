---
name: personal-workspace-integration
description: "Use when connecting personal work systems or SaaS accounts. OAuth first, read-only, verify."
---

# Personal Workspace Integration

Use for connecting the user's accounts and tools to the hub: Gmail, Calendar, Tasks, GitHub, Notion, Cloudflare, project tools, hosting platforms and remote workers. (Absorbs the former `personal-workspace-integrations` and `oauth-first-integrations`.)

## Always-on policy

- Prefer OAuth over passwords. Use the Hermes credential vault only when OAuth is unavailable or cannot perform the required action; never request or accept passwords in chat.
- Default to read-only. E-mail sending, calendar writes, repository writes, posting and sharing are separate approvals.
- Notify this user through their configured WhatsApp target before any state-changing integration step (authorization, credential creation, scope expansion, API enablement, cleanup); scope and expected external effect must be explicit in the notice.
- Treat each browser account, agent host and remote device as a separate trust boundary. Never copy browser cookies or credentials across a host boundary.

## Procedure

1. Map each requested source before configuring it: account, host/device, available CLI/API, required OAuth scopes, read-only or write-capable, and the exact verification call.
2. Inspect the exact scopes the executable flow requests before consent; do not trust a skill description or client label as proof of least privilege. If a connector has a static broad bundle, disclose it fully, and refuse a bundle that exceeds the approved scope.
3. For browser OAuth, inspect the cloud project's existing consent-screen identity and clients first. Use a dedicated project when the existing app identity is unrelated. If a dedicated project cannot be created, stop before consent and remove any unused client, downloaded secret and pending OAuth state. Do not delete projects, clients or integrations just to clear quota or reorganize without explicit approval.
4. Keep authorization codes and client secrets out of chat and tool output. Store token material only in the active agent home with owner-only permissions (`600`; recheck after any refresh) and remove downloaded client-secret files and temporary callbacks after exchange.
5. Self-hosted OAuth client: verify the target instance (browser origin, live runtime base URL, persisted workflow/credential store) before entering a client ID or secret. Instances sharing a hostname on different ports share cookies, so use a fresh private browser session. See `references/local-selfhosted-oauth.md`.
6. Verify every completed connection with a minimal live read from the exact source; an authentication success message alone is insufficient. Distinguish an API-disabled error from a valid empty result or a valid not-found. Before claiming a remote write succeeded, read back the target or state the verification boundary.
7. Record scope, host, policy, verification result and known boundary in the hub's connection ledger, without tokens, passwords, raw callbacks or private content. See `references/verification.md` for minimal checks.

## Google read-only bundle

Use only these scopes when the user wants personal work visibility without write authority:

- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/calendar.readonly`
- `https://www.googleapis.com/auth/tasks.readonly`

Do not accept a connector that bundles send, modify or calendar-write scopes. After OAuth, verify the three APIs separately: Gmail profile, Calendar list, Tasks list. An authenticated account does not grant permission to send mail or create events.

## GitHub read policy

1. Require both `gh auth status` and `gh api user`; validate repository visibility with `gh repo list`.
2. Device OAuth may grant `repo`, which can technically write to private repositories; say so plainly.
3. For strict read-only isolation use a GitHub App or fine-grained credential limited to read. If the user keeps broad OAuth, record an operational read-only policy and require explicit authorization for every write.
4. Never claim a device-flow login succeeded just because the user finished the browser step; the token endpoint and `gh` must confirm it.

## Remote worker bridge

When the Linux worker must operate a separate Windows or macOS host:

1. Treat the hosts as separate trust boundaries. Install the overlay-network client on both, then verify membership and reachability from the worker with the overlay status command and an overlay ping.
2. Generate a dedicated SSH key on the worker. Install only its public key for a dedicated, non-admin account on the remote host; never copy a private key to the host or show it in chat.
3. Verify the full path before configuring an SSH backend: overlay ping, TCP port 22, then a non-interactive SSH command with strict host-key handling. An online peer is not remote access.
4. Make boot persistence an acceptance criterion: read back the overlay client and SSH server services and require `StartMode=Auto` and `State=Running`.
5. Restrict the remote SSH firewall rule to overlay-network ranges. If overlay ping works but port 22 times out, investigate the remote OpenSSH service and firewall rather than the topology.
6. Install a bridge or export on the other device before promising unified traceability; do not infer activity from missing local configuration on the hub host, and do not claim visibility into another host's files or sessions without a verified bridge.
7. Do not enable autonomous repository or project monitoring until the user accepts the project map, cadence, delivery target and write policy; persistent monitoring needs a cron job, not a memory note.

## Hub

The task orchestrator is the future write boundary for tasks and agenda, only after its API/authentication model is validated; keep task creation and agenda writes approval-gated until the user explicitly broadens permissions. Centralize only minimal events: timestamp, source agent, project/repository, task identifier, action type, result and a stable URL/commit/PR reference. Exclude tokens, passwords, raw OAuth callbacks, private message bodies, clinical data and full transcripts by default.
