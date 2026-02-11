// Seed default tools into the Tool library for one user (by email) or for all users.
//
// Usage:
//   source .env && node scripts/seed_default_tools.mjs
//   source .env && node scripts/seed_default_tools.mjs --email 1037959324@qq.com

import { prisma } from "../packages/db/dist/index.js";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--email") out.email = argv[++i];
  }
  return out;
}

const TOOL_DEFS = [
  {
    name: "read_file_lines",
    description:
      "Incrementally read a text file by line range. Reads [offset, offset+limit) (1-based offset). Rejects paths outside repo root.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        filepath: { type: "string", description: "Workspace-relative filepath." },
        offset: { type: "integer", minimum: 1, description: "1-based start line number." },
        limit: { type: "integer", minimum: 1, maximum: 500, description: "Number of lines to read." }
      },
      required: ["filepath", "offset", "limit"]
    }
  },
  {
    name: "create_file",
    description:
      "Create a new file at filepath with content. Fails if file already exists. Rejects paths outside repo root.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        filepath: { type: "string", description: "Workspace-relative filepath." },
        content: { type: "string", description: "File content to write." }
      },
      required: ["filepath", "content"]
    }
  },
  {
    name: "linux_command",
    description:
      "Run a Linux command by argv (no shell). For safety, destructive/network commands may be rejected; prefer readonly_command when possible.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        argv: { type: "array", items: { type: "string" }, minItems: 1, description: "Command argv array, e.g. ['ls','-la']." },
        cwd: { type: "string", description: "Workspace-relative working directory (default '.')." }
      },
      required: ["argv"]
    }
  },
  {
    name: "readonly_command",
    description:
      "Run a read-only Linux command by argv (no shell). Writes are rejected. Useful for inspection (ls, cat, rg, sed without -i, etc.).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        argv: { type: "array", items: { type: "string" }, minItems: 1 },
        cwd: { type: "string" }
      },
      required: ["argv"]
    }
  },
  {
    name: "github_command",
    description:
      "Run GitHub-related commands via argv (no shell). Only allows git/gh read-only operations; mutating commands are rejected.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        argv: { type: "array", items: { type: "string" }, minItems: 1, description: "Must start with 'git' or 'gh'." },
        cwd: { type: "string" }
      },
      required: ["argv"]
    }
  },
  {
    name: "db_query",
    description:
      "Query database with a single SELECT/WITH/EXPLAIN statement. Writes/DDL are rejected. If LIMIT is absent, LIMIT 200 is applied.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        sql: { type: "string", description: "Single SQL SELECT/WITH/EXPLAIN statement (no semicolons)." }
      },
      required: ["sql"]
    }
  },
  {
    name: "redis_read",
    description:
      "Read data from Redis using a limited set of read-only commands (GET/MGET/HGETALL/LRANGE/SMEMBERS/ZRANGE/SCAN/TTL/PTTL/EXISTS).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        command: { type: "string", description: "Redis command name." },
        args: { type: "array", items: { type: "string" }, description: "Command arguments (strings)." }
      },
      required: ["command"]
    }
  },
  {
    name: "search_text",
    description: "Search text in workspace using ripgrep (rg). Returns matching lines with file paths and line numbers.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", description: "Ripgrep pattern." },
        glob: { type: "string", description: "Optional glob filter (e.g. '*.ts')." },
        caseSensitive: { type: "boolean", description: "Case sensitive search (default false)." },
        maxResults: { type: "integer", minimum: 1, maximum: 2000, description: "Max matches to return (default 200)." }
      },
      required: ["query"]
    }
  },
  {
    name: "list_dir",
    description: "List files/directories under a path (workspace-relative). Optionally recursive with a max entry limit.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string", description: "Workspace-relative directory path." },
        recursive: { type: "boolean", description: "Recursive listing (default false)." },
        maxEntries: { type: "integer", minimum: 1, maximum: 5000, description: "Max entries (default 500)." }
      },
      required: ["path"]
    }
  },
  {
    name: "stat_path",
    description: "Get metadata for a file or directory (exists, isFile, isDirectory, size, mtime).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string", description: "Workspace-relative path." }
      },
      required: ["path"]
    }
  },
  {
    name: "read_file_bytes",
    description: "Read a file by byte range (offsetBytes/lengthBytes). Useful for logs or binary-ish files.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        filepath: { type: "string", description: "Workspace-relative filepath." },
        offsetBytes: { type: "integer", minimum: 0, description: "Start offset in bytes." },
        lengthBytes: { type: "integer", minimum: 1, maximum: 200000, description: "Number of bytes to read." }
      },
      required: ["filepath", "offsetBytes", "lengthBytes"]
    }
  },
  {
    name: "append_file",
    description: "Append content to a file. For safety, path must be under ./notes or ./tmp (workspace-relative).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        filepath: { type: "string", description: "Workspace-relative filepath under notes/ or tmp/." },
        content: { type: "string", description: "Text to append." }
      },
      required: ["filepath", "content"]
    }
  },
  {
    name: "apply_patch",
    description: "Apply a unified patch text to workspace files. For safety, path changes are restricted to workspace.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        patchText: { type: "string", description: "Patch text (unified diff) to apply." }
      },
      required: ["patchText"]
    }
  },
  {
    name: "http_get",
    description: "Fetch a URL via HTTP GET. Disabled by default in this environment; may be rejected.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: { type: "string", description: "URL to fetch." },
        maxBytes: { type: "integer", minimum: 1, maximum: 500000, description: "Max bytes to read (default 200000)." }
      },
      required: ["url"]
    }
  },
  {
    name: "db_schema",
    description: "Inspect database schema (tables or columns). Read-only helper that queries information_schema.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        table: { type: "string", description: "Optional table name (exact, case-sensitive as stored)." }
      }
    }
  },
  {
    name: "redis_keys",
    description: "Scan Redis keys by pattern (read-only). Uses SCAN and returns up to maxKeys.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        pattern: { type: "string", description: "SCAN match pattern, e.g. 'run:*'." },
        count: { type: "integer", minimum: 1, maximum: 1000, description: "SCAN COUNT hint (default 200)." },
        maxKeys: { type: "integer", minimum: 1, maximum: 5000, description: "Max keys to return (default 500)." }
      },
      required: ["pattern"]
    }
  },
  {
    name: "time_now",
    description: "Return the current server time (ISO string).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        timezone: { type: "string", description: "Optional IANA timezone name for formatting (best-effort)." }
      }
    }
  },
  {
    name: "json_validate",
    description: "Validate JSON data against a JSON Schema (draft-07-ish). Returns errors if invalid.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        json: { description: "JSON value to validate." },
        schema: { type: "object", description: "JSON Schema object." }
      },
      required: ["json", "schema"]
    }
  },
  {
    name: "group_get_info",
    description: "Get group basic info (name/description/notice/memberCount). Only allowed if the agent is a member of the group.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        groupId: { type: "string", description: "Group id." }
      },
      required: ["groupId"]
    }
  },
  {
    name: "group_get_members",
    description: "List group members (agentId, agent name, role). Only allowed if the agent is a member of the group.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        groupId: { type: "string", description: "Group id." }
      },
      required: ["groupId"]
    }
  },
  {
    name: "group_get_messages",
    description:
      "Incrementally fetch group messages. If beforeMessageId is omitted, returns the most recent messages. If provided, returns older messages before that id. Only allowed if the agent is a member of the group.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        groupId: { type: "string", description: "Group id." },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Number of messages to fetch (default 30)." },
        beforeMessageId: { type: "string", description: "Cursor id. Fetch messages older than this message id." }
      },
      required: ["groupId"]
    }
  },
  {
    name: "agent_get_state",
    description: "Get current agent state (sleeping flags, context reset timestamp).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: []
    }
  },
  {
    name: "agent_sleep",
    description:
      "Put the agent into sleep mode. Optionally clears conversation context by setting contextResetAt=now (messages remain in DB).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        clearContext: { type: "boolean", description: "If true, clears context for future chats (default true)." }
      }
    }
  },
  {
    name: "agent_wake",
    description: "Wake the agent up (exit sleep mode).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: []
    }
  },
  {
    name: "agent_clear_context",
    description: "Clear agent conversation context for future chats by setting contextResetAt=now (messages remain in DB).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: []
    }
  },
  {
    name: "agent_list_routines",
    description: "List the agent's routines (schedule entries).",
    jsonSchema: { type: "object", additionalProperties: false, properties: {} }
  },
  {
    name: "agent_upsert_routine",
    description:
      "Create or update a routine (作息表条目) by name. Supports cron + timezone + action. Payload is action-specific JSON.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1, maxLength: 200 },
        action: {
          type: "string",
          enum: [
            "sleep",
            "wake",
            "web_surf",
            "check_email",
            "check_stocks",
            "search_install_skills",
            "equip_skills",
            "daily_generate_skill",
            "cleanup_low_score_skills"
          ]
        },
        cron: { type: "string", minLength: 1, maxLength: 200, description: "Cron expression (5 fields)." },
        timezone: { type: "string", description: "IANA timezone (default UTC)." },
        enabled: { type: "boolean", description: "Enabled flag (default true)." },
        payload: { description: "Optional JSON payload for the action." }
      },
      required: ["name", "action", "cron"]
    }
  },
  {
    name: "agent_delete_routine",
    description: "Delete a routine by name.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: { name: { type: "string", minLength: 1, maxLength: 200 } },
      required: ["name"]
    }
  },
  {
    name: "agent_toggle_routine",
    description: "Enable/disable a routine by name.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: { name: { type: "string", minLength: 1, maxLength: 200 }, enabled: { type: "boolean" } },
      required: ["name", "enabled"]
    }
  },
  {
    name: "agent_run_routine_now",
    description:
      "Run one routine immediately (best-effort). Logs a routine execution record. Note: network-dependent actions may be rejected in this environment.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: { name: { type: "string", minLength: 1, maxLength: 200 } },
      required: ["name"]
    }
  },
  {
    name: "agent_list_routine_logs",
    description: "List recent routine execution logs.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Max logs to return (default 50)." }
      }
    }
  },
  {
    name: "agent_equip_skills",
    description:
      "Equip (attach) skills to the agent by adding skillPaths. Skills are server-provided; agent cannot edit skill contents.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        skillPaths: { type: "array", items: { type: "string" }, minItems: 1, description: "Skill hyperlinks (SKILL.md ref links)." }
      },
      required: ["skillPaths"]
    }
  },
  {
    name: "agent_unequip_skills",
    description: "Unequip (detach) skills from the agent by removing skillPaths.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: { skillPaths: { type: "array", items: { type: "string" }, minItems: 1 } },
      required: ["skillPaths"]
    }
  },
  {
    name: "agent_list_sessions",
    description: "List the agent's sessions (across all sessions for this agent). Supports incremental pagination by updatedAt.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Max sessions to return (default 20)." },
        beforeUpdatedAt: { type: "string", description: "ISO datetime. Return sessions with updatedAt < this." },
        query: { type: "string", description: "Optional substring filter on title." }
      }
    }
  },
  {
    name: "agent_get_session_messages",
    description:
      "Incrementally fetch messages from a specific session belonging to this agent. If beforeMessageId is omitted, returns the most recent messages.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        sessionId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Max messages to return (default 30)." },
        beforeMessageId: { type: "string", description: "Cursor id. Fetch messages older than this message id." }
      },
      required: ["sessionId"]
    }
  },
  {
    name: "agent_search_messages",
    description:
      "Search messages across ALL sessions for this agent. Useful for cross-session memory retrieval. Returns snippets with session context.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", minLength: 1, description: "Substring query (case-insensitive)." },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Max matches to return (default 20)." },
        includeSystem: { type: "boolean", description: "Include system messages (default false)." },
        includeTool: { type: "boolean", description: "Include tool messages (default false)." }
      },
      required: ["query"]
    }
  },
  {
    name: "skill_create_generated",
    description:
      "Create a generated skill (SKILL.md) for this agent under the generated skills library, and optionally auto-equip it.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1, maxLength: 200, description: "Skill frontmatter name." },
        description: { type: "string", minLength: 1, maxLength: 500, description: "Skill frontmatter description." },
        bodyMarkdown: { type: "string", minLength: 1, description: "Skill markdown body (no frontmatter)." },
        autoEquip: { type: "boolean", description: "If true, equips this skill on the agent (default true)." },
        folderHint: { type: "string", description: "Optional slug/folder hint for storage." }
      },
      required: ["name", "description", "bodyMarkdown"]
    }
  },
  {
    name: "skill_rate",
    description:
      "Rate a skill after using it. Stores a score (1-5) and optional note. Used for periodic cleanup of low-rated generated skills.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        skillPath: { type: "string", minLength: 1, description: "Skill hyperlink path (e.g. /v1/docs/file?ref=...)." },
        score: { type: "integer", minimum: 1, maximum: 5 },
        note: { type: "string", description: "Optional short note." }
      },
      required: ["skillPath", "score"]
    }
  },
  {
    name: "skill_get_ratings",
    description: "Get rating summary for a given skillPath, including avgScore and ratingCount.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: { skillPath: { type: "string", minLength: 1 } },
      required: ["skillPath"]
    }
  },
  {
    name: "email_send",
    description:
      "Send an email (or store to outbox if SMTP not configured). Use for daily reports and notifications.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        to: { type: "string", minLength: 3, description: "Recipient email address." },
        subject: { type: "string", minLength: 1, maxLength: 2000 },
        bodyMarkdown: { type: "string", minLength: 1, maxLength: 200_000, description: "Markdown/text email body." }
      },
      required: ["to", "subject", "bodyMarkdown"]
    }
  },
  {
    name: "email_list_outbox",
    description: "List recent outbox emails for the current user (read-only).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Max rows (default 50)." }
      }
    }
  },
  {
    name: "agent_send_mail",
    description:
      "Send an internal mail to another agent you own (non-urgent). This stores a message in the target agent inbox (does not enqueue a run).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        agentId: { type: "string", minLength: 1, description: "Target agent id." },
        subject: { type: "string", minLength: 1, maxLength: 2000 },
        bodyMarkdown: { type: "string", minLength: 1, maxLength: 200_000 }
      },
      required: ["agentId", "subject", "bodyMarkdown"]
    }
  },
  {
    name: "agent_list_inbox",
    description: "List recent internal mails received by this agent (read-only).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Max mails (default 50)." },
        unreadOnly: { type: "boolean", description: "If true, only show unread mails (default false)." }
      }
    }
  },
  {
    name: "agent_mark_mail_read",
    description: "Mark a received internal mail as read.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: { mailId: { type: "string", minLength: 1 } },
      required: ["mailId"]
    }
  },
  {
    name: "agent_wake_agent",
    description: "Wake another agent you own (supervisor-only).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: { agentId: { type: "string", minLength: 1 } },
      required: ["agentId"]
    }
  },
  {
    name: "propose_patch",
    description:
      "Propose (and optionally apply) a unified diff patch for code changes. Prefer minimal patches.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", minLength: 1, maxLength: 2000 },
        description: { type: "string", maxLength: 50_000 },
        patchText: { type: "string", minLength: 1, maxLength: 500_000 },
        applyNow: { type: "boolean", description: "If true, apply patch immediately (best-effort hot reload via watch mode)." }
      },
      required: ["title", "patchText"]
    }
  },
  {
    name: "system_logs_recent",
    description: "Fetch recent system logs (errors) for diagnosis.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        service: { type: "string", description: "Optional service filter: api/worker/web." },
        level: { type: "string", description: "Optional level filter: error/warn/info." },
        limit: { type: "integer", minimum: 1, maximum: 500 }
      }
    }
  },
  {
    name: "project_create",
    description:
      "Create a new project (supervisor-only). Optionally creates and assigns a project lead agent automatically.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1, maxLength: 200 },
        createLead: { type: "boolean", description: "If true, create a lead agent and set as project lead (default true)." },
        leadAgentName: { type: "string", minLength: 1, maxLength: 200, description: "Lead agent name (optional)." }
      },
      required: ["name"]
    }
  },
  {
    name: "project_assign_lead",
    description: "Assign (or replace) the lead agent for a project (supervisor-only).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        projectId: { type: "string", minLength: 1 },
        leadAgentId: { type: "string", minLength: 1 }
      },
      required: ["projectId", "leadAgentId"]
    }
  },
  {
    name: "group_create",
    description: "Create a group in a project (project-lead-only).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        projectId: { type: "string", minLength: 1 },
        name: { type: "string", minLength: 1, maxLength: 200 },
        description: { type: "string", maxLength: 10_000 }
      },
      required: ["projectId", "name"]
    }
  },
  {
    name: "group_set_owner",
    description: "Set or change the group owner (group master) (project-lead-only).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        groupId: { type: "string", minLength: 1 },
        ownerAgentId: { type: "string", minLength: 1 }
      },
      required: ["groupId", "ownerAgentId"]
    }
  },
  {
    name: "skill_cleanup_low_score",
    description:
      "Cleanup low-rated generated skills for this agent. Only affects generated skill library; never deletes system skills.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        minAvgScore: { type: "number", minimum: 1, maximum: 5, description: "Delete if avg score < this (default 2.5)." },
        minRatings: { type: "integer", minimum: 1, maximum: 100, description: "Only consider skills with at least this many ratings (default 3)." }
      }
    }
  },
  {
    name: "skill_semantic_search",
    description:
      "Semantic (vector) search over the skill library. Takes a short natural-language query and returns the most relevant skills (with ratings).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", minLength: 1, maxLength: 2000, description: "Natural-language query." },
        limit: { type: "integer", minimum: 1, maximum: 30, description: "Max results (default 10)." },
        ensureIndexed: { type: "boolean", description: "If true, indexes/upserts missing skill embeddings (default true)." },
        maxIndex: { type: "integer", minimum: 1, maximum: 2000, description: "Max skills to (re)index per call (default 200)." }
      },
      required: ["query"]
    }
  },
  {
    name: "agent_dispatch_run",
    description:
      "Dispatch work to another agent (create a session message + enqueue a run). Only allowed when invoked by a supervisor agent.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        agentId: { type: "string", minLength: 1, description: "Target agent id." },
        content: { type: "string", minLength: 1, maxLength: 50000, description: "User message content to send." },
        sessionId: { type: "string", description: "Optional existing session id for the target agent." }
      },
      required: ["agentId", "content"]
    }
  }
];

async function upsertForUser(userId) {
  for (const t of TOOL_DEFS) {
    await prisma.tool.upsert({
      where: { userId_name: { userId, name: t.name } },
      create: { userId, name: t.name, description: t.description, jsonSchema: t.jsonSchema },
      update: { description: t.description, jsonSchema: t.jsonSchema }
    });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.email) {
    const u = await prisma.user.findUnique({ where: { email: String(args.email) } });
    if (!u) throw new Error(`User not found: ${args.email}`);
    await upsertForUser(u.id);
    console.log(`Seeded default tools for ${u.email}`);
    return;
  }

  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  for (const u of users) {
    await upsertForUser(u.id);
    console.log(`Seeded default tools for ${u.email}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
