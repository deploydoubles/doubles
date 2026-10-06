import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The checks library reads files relative to the app root at run time;
  // load it from node_modules instead of bundling it.
  serverExternalPackages: ['@deploydoubles/checks'],
};

export default nextConfig;
