import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// CSP compromises (static, nonce-free policy set from next.config):
// - script-src 'unsafe-inline': Next.js emits inline bootstrap/flight-data
//   <script> tags; without per-request nonces (which force dynamic rendering
//   and need proxy-level CSP) they would be blocked. Scripts are still
//   restricted to 'self' + inline; no remote origins, no eval in production.
// - style-src 'unsafe-inline': Next/React inject inline style attributes/tags.
// - dev only: 'unsafe-eval' (React debugging) and ws: for HMR.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
];

const nextConfig: NextConfig = {
  // The phone test build (npm run test:mobile) uses its own output dir so it never clobbers .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  reactStrictMode: true,
  // Document uploads are up to 20 MB; the extra headroom covers the form fields.
  experimental: { serverActions: { bodySizeLimit: "21mb" } },
  // Tailwind v4 via the generator's Turbopack loader, for global CSS only. Its `as: "*.css"` would turn a
  // *.module.css into global CSS with no class names (that silently disabled Homey's face styles).
  turbopack: {
    rules: {
      "*.css": {
        condition: { not: { path: /\.module\.css$/ } },
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
