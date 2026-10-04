import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't let `next dev` drop generated AGENTS.md / CLAUDE.md into the repo.
  agentRules: false,
};

export default nextConfig;
