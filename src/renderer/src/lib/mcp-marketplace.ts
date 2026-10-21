import type { McpConfig } from "@shared/types"

export type McpMarketCategory = "files" | "search" | "dev" | "data" | "productivity" | "cloud"

export interface McpMarketField {
  id: string
  labelKey: string
  placeholder?: string
  required?: boolean
  secret?: boolean
  envKey?: string
}

export interface McpMarketEntry {
  id: string
  name: string
  descriptionKey: string
  category: McpMarketCategory
  type: "local" | "remote"
  command?: string[]
  url?: string
  oauth?: boolean
  fields?: McpMarketField[]
  homepage?: string
  tags?: string[]
}

export const MCP_MARKET_CATEGORIES: McpMarketCategory[] = [
  "files",
  "search",
  "dev",
  "data",
  "productivity",
  "cloud",
]

export const MCP_MARKETPLACE: McpMarketEntry[] = [
  {
    id: "context7",
    name: "Context7",
    descriptionKey: "mcp.market.context7.desc",
    category: "search",
    type: "remote",
    url: "https://mcp.context7.com/mcp",
    homepage: "https://github.com/upstash/context7",
    tags: ["docs", "libraries"],
  },
  {
    id: "grep",
    name: "Grep by Vercel",
    descriptionKey: "mcp.market.grep.desc",
    category: "search",
    type: "remote",
    url: "https://mcp.grep.app",
    homepage: "https://grep.app",
    tags: ["github", "examples"],
  },
  {
    id: "deepwiki",
    name: "DeepWiki",
    descriptionKey: "mcp.market.deepwiki.desc",
    category: "search",
    type: "remote",
    url: "https://mcp.deepwiki.com/mcp",
    homepage: "https://deepwiki.com",
    tags: ["repository", "docs"],
  },
  {
    id: "sentry",
    name: "Sentry",
    descriptionKey: "mcp.market.sentry.desc",
    category: "dev",
    type: "remote",
    url: "https://mcp.sentry.dev/mcp",
    oauth: true,
    homepage: "https://mcp.sentry.dev",
    tags: ["errors", "monitoring"],
  },
  {
    id: "github",
    name: "GitHub",
    descriptionKey: "mcp.market.github.desc",
    category: "dev",
    type: "remote",
    url: "https://api.githubcopilot.com/mcp/",
    oauth: true,
    homepage: "https://github.com/github/github-mcp-server",
    tags: ["repos", "issues", "pull requests"],
  },
  {
    id: "linear",
    name: "Linear",
    descriptionKey: "mcp.market.linear.desc",
    category: "productivity",
    type: "remote",
    url: "https://mcp.linear.app/mcp",
    oauth: true,
    homepage: "https://linear.app",
    tags: ["issues", "projects"],
  },
  {
    id: "notion",
    name: "Notion",
    descriptionKey: "mcp.market.notion.desc",
    category: "productivity",
    type: "remote",
    url: "https://mcp.notion.com/mcp",
    oauth: true,
    homepage: "https://notion.so",
    tags: ["docs", "wiki"],
  },
  {
    id: "supabase",
    name: "Supabase",
    descriptionKey: "mcp.market.supabase.desc",
    category: "data",
    type: "remote",
    url: "https://mcp.supabase.com/mcp",
    oauth: true,
    homepage: "https://supabase.com",
    tags: ["postgres", "sql"],
  },
  {
    id: "neon",
    name: "Neon",
    descriptionKey: "mcp.market.neon.desc",
    category: "data",
    type: "remote",
    url: "https://mcp.neon.tech/mcp",
    oauth: true,
    homepage: "https://neon.tech",
    tags: ["postgres", "sql"],
  },
  {
    id: "semgrep",
    name: "Semgrep",
    descriptionKey: "mcp.market.semgrep.desc",
    category: "dev",
    type: "remote",
    url: "https://mcp.semgrep.ai/mcp",
    homepage: "https://semgrep.dev",
    tags: ["security", "scan"],
  },
  {
    id: "figma",
    name: "Figma",
    descriptionKey: "mcp.market.figma.desc",
    category: "productivity",
    type: "remote",
    url: "https://mcp.figma.com/mcp",
    oauth: true,
    homepage: "https://figma.com",
    tags: ["design", "files"],
  },
  {
    id: "cloudflare-docs",
    name: "Cloudflare Docs",
    descriptionKey: "mcp.market.cloudflare.desc",
    category: "cloud",
    type: "remote",
    url: "https://docs.mcp.cloudflare.com/mcp",
    homepage: "https://developers.cloudflare.com",
    tags: ["docs", "cloudflare"],
  },
  {
    id: "filesystem",
    name: "Filesystem",
    descriptionKey: "mcp.market.filesystem.desc",
    category: "files",
    type: "local",
    command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "{{directory}}"],
    fields: [
      {
        id: "directory",
        labelKey: "mcp.field.directory",
        placeholder: "Project folder or an absolute path",
        required: true,
      },
    ],
    homepage: "https://github.com/modelcontextprotocol/servers",
    tags: ["files", "read", "write"],
  },
  {
    id: "everything",
    name: "Everything (test)",
    descriptionKey: "mcp.market.everything.desc",
    category: "dev",
    type: "local",
    command: ["npx", "-y", "@modelcontextprotocol/server-everything"],
    homepage: "https://github.com/modelcontextprotocol/servers",
    tags: ["test", "reference"],
  },
  {
    id: "memory",
    name: "Memory",
    descriptionKey: "mcp.market.memory.desc",
    category: "dev",
    type: "local",
    command: ["npx", "-y", "@modelcontextprotocol/server-memory"],
    homepage: "https://github.com/modelcontextprotocol/servers",
    tags: ["knowledge graph", "memory"],
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    descriptionKey: "mcp.market.sequential.desc",
    category: "dev",
    type: "local",
    command: ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"],
    homepage: "https://github.com/modelcontextprotocol/servers",
    tags: ["reasoning"],
  },
  {
    id: "playwright",
    name: "Playwright",
    descriptionKey: "mcp.market.playwright.desc",
    category: "dev",
    type: "local",
    command: ["npx", "-y", "@playwright/mcp@latest"],
    homepage: "https://github.com/microsoft/playwright-mcp",
    tags: ["browser", "testing"],
  },
  {
    id: "puppeteer",
    name: "Puppeteer",
    descriptionKey: "mcp.market.puppeteer.desc",
    category: "dev",
    type: "local",
    command: ["npx", "-y", "@modelcontextprotocol/server-puppeteer"],
    homepage: "https://github.com/modelcontextprotocol/servers",
    tags: ["browser", "automation"],
  },
  {
    id: "postgres",
    name: "Postgres",
    descriptionKey: "mcp.market.postgres.desc",
    category: "data",
    type: "local",
    command: ["npx", "-y", "@modelcontextprotocol/server-postgres", "{{connectionString}}"],
    fields: [
      {
        id: "connectionString",
        labelKey: "mcp.field.connectionString",
        placeholder: "postgresql://user:password@localhost:5432/db",
        required: true,
        secret: true,
      },
    ],
    homepage: "https://github.com/modelcontextprotocol/servers",
    tags: ["database", "sql"],
  },
  {
    id: "brave-search",
    name: "Brave Search",
    descriptionKey: "mcp.market.brave.desc",
    category: "search",
    type: "local",
    command: ["npx", "-y", "@modelcontextprotocol/server-brave-search"],
    fields: [
      {
        id: "apiKey",
        labelKey: "mcp.field.braveApiKey",
        placeholder: "BSA...",
        required: true,
        secret: true,
        envKey: "BRAVE_API_KEY",
      },
    ],
    homepage: "https://brave.com/search/api/",
    tags: ["web search", "api key"],
  },
]

export function buildMarketConfig(entry: McpMarketEntry, values: Record<string, string>): McpConfig {
  if (entry.type === "remote") {
    return {
      type: "remote",
      url: entry.url ?? "",
      ...(entry.oauth ? { oauth: {} } : {}),
      enabled: true,
    }
  }
  const command = (entry.command ?? []).map((part) =>
    part.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? ""),
  )
  const environment: Record<string, string> = {}
  for (const field of entry.fields ?? []) {
    const value = values[field.id]
    if (field.envKey && value) environment[field.envKey] = value
  }
  return {
    type: "local",
    command,
    ...(Object.keys(environment).length > 0 ? { environment } : {}),
    enabled: true,
  }
}

export function marketFieldsFor(entry: McpMarketEntry): McpMarketField[] {
  return entry.fields ?? []
}
