/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Shared workspace package ships TS; let Next transpile it.
  transpilePackages: ['@routewrangler/contracts'],
  eslint: {
    // Linting runs as its own CI step via the root flat config, not in `next build`.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
