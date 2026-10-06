import type { NextConfig } from "next";

const config: NextConfig = {
  // Next 16 separates development output at .next/dev by default.
  poweredByHeader: false,
  turbopack: { root: process.cwd() },
  agentRules: false,
  logging: { incomingRequests: { ignore: [/\/api\/auth\/magic-link\/verify/] } },
  async headers() {
    return ["/pradzia", "/nustatymai", "/prideti", "/pirkiniai", "/pirkiniai/:path*"].map((source) => ({ source, headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }] }));
  },
};

export default config;
