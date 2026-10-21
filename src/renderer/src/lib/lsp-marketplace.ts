import { BUILTIN_LSP, type BuiltinLsp } from "@shared/types"

export type LspMarketCategory = "web" | "systems" | "backend" | "mobile" | "data"

export interface LspMarketMeta {
  category: LspMarketCategory
  autoInstall: boolean
  installCommand?: string
  serverCommand?: string[]
}

export interface LspMarketEntry extends BuiltinLsp {
  category: LspMarketCategory
  autoInstall: boolean
  installCommand?: string
  serverCommand?: string[]
}

export const LSP_MARKET_CATEGORIES: LspMarketCategory[] = ["web", "systems", "backend", "mobile", "data"]

const META: Record<string, LspMarketMeta> = {
  astro: { category: "web", autoInstall: true },
  bash: { category: "systems", autoInstall: true },
  clangd: { category: "systems", autoInstall: true },
  csharp: { category: "backend", autoInstall: false, installCommand: "dotnet --version" },
  "clojure-lsp": {
    category: "backend",
    autoInstall: false,
    installCommand: "brew install clojure-lsp/brew/clojure-lsp-native",
    serverCommand: ["clojure-lsp"],
  },
  dart: { category: "mobile", autoInstall: false, installCommand: "https://dart.dev/get-dart" },
  deno: { category: "web", autoInstall: false, installCommand: "https://docs.deno.com/runtime/getting_started/installation/",
    serverCommand: ["deno", "lsp"],
  },
  "elixir-ls": { category: "backend", autoInstall: false, installCommand: "mix escript.install hex elixir_ls" },
  eslint: { category: "web", autoInstall: false, installCommand: "npm i -D eslint" },
  fsharp: { category: "backend", autoInstall: false, installCommand: "dotnet --version" },
  gleam: { category: "backend", autoInstall: false, installCommand: "https://gleam.run/getting-started/installing/" },
  gopls: { category: "backend", autoInstall: false, installCommand: "go install golang.org/x/tools/gopls@latest",
    serverCommand: ["gopls"],
  },
  hls: { category: "systems", autoInstall: false, installCommand: "ghcup install hls",
    serverCommand: ["haskell-language-server-wrapper", "--lsp"],
  },
  jdtls: { category: "backend", autoInstall: false, installCommand: "https://github.com/eclipse-jdtls/eclipse.jdt.ls" },
  julials: { category: "data", autoInstall: false, installCommand: "julia -e 'using Pkg; Pkg.add(\"LanguageServer\")'" },
  "kotlin-ls": { category: "mobile", autoInstall: true },
  "lua-ls": { category: "data", autoInstall: true },
  nixd: { category: "systems", autoInstall: false, installCommand: "nix profile install nixpkgs#nixd",
    serverCommand: ["nixd"],
  },
  "ocaml-lsp": { category: "systems", autoInstall: false, installCommand: "opam install ocaml-lsp-server",
    serverCommand: ["ocamllsp"],
  },
  oxlint: { category: "web", autoInstall: false, installCommand: "npm i -D oxlint" },
  "php intelephense": { category: "backend", autoInstall: true },
  prisma: { category: "data", autoInstall: false, installCommand: "npm i -D prisma" },
  pyright: { category: "backend", autoInstall: false, installCommand: "npm i -g pyright",
    serverCommand: ["pyright-langserver", "--stdio"],
  },
  razor: { category: "web", autoInstall: false, installCommand: "dotnet --version" },
  "ruby-lsp": { category: "backend", autoInstall: false, installCommand: "gem install ruby-lsp",
    serverCommand: ["ruby-lsp"],
  },
  rust: { category: "systems", autoInstall: false, installCommand: "rustup component add rust-analyzer",
    serverCommand: ["rust-analyzer"],
  },
  "sourcekit-lsp": { category: "mobile", autoInstall: false, installCommand: "xcode-select --install",
    serverCommand: ["sourcekit-lsp"],
  },
  svelte: { category: "web", autoInstall: true },
  terraform: { category: "data", autoInstall: true },
  tinymist: { category: "data", autoInstall: true },
  typescript: { category: "web", autoInstall: false, installCommand: "npm i -D typescript",
    serverCommand: ["typescript-language-server", "--stdio"],
  },
  vue: { category: "web", autoInstall: true },
  "yaml-ls": { category: "data", autoInstall: true },
  zls: { category: "systems", autoInstall: false, installCommand: "https://github.com/zigtools/zls",
    serverCommand: ["zls"],
  },
}

export const LSP_MARKETPLACE: LspMarketEntry[] = BUILTIN_LSP.map((entry) => {
  const meta = META[entry.name] ?? { category: "data", autoInstall: false }
  return { ...entry, ...meta }
})


