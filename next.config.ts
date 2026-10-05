import type { NextConfig } from "next";

const config: NextConfig = {
  // Next 16 separates development output at .next/dev by default.
  poweredByHeader: false,
  turbopack: { root: process.cwd() },
  agentRules: false,
  logging: { incomingRequests: { ignore: [/\/api\/auth\/magic-link\/verify/] } },
};

export default config;
