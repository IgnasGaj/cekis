import type { NextConfig } from "next";

const config: NextConfig = {
  distDir: process.env.CEKIS_NEXT_DIST_DIR ?? ".next",
  // Next 16 separates development output at .next/dev by default.
  allowedDevOrigins: process.env.NODE_ENV === "development" && process.env.APP_URL
    ? [new URL(process.env.APP_URL).hostname]
    : undefined,
  poweredByHeader: false,
  turbopack: { root: process.cwd() },
  agentRules: false,
  logging: { incomingRequests: { ignore: [/\/api\/auth\/magic-link\/verify/] } },
  async headers() {
    return ["/pradzia", "/nustatymai", "/prideti", "/pirkiniai", "/pirkiniai/:path*"].map((source) => ({ source, headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }] }));
  },
};

export default config;
