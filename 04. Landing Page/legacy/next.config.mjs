/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: the landing has no server runtime, so it ships as plain files
  // to Cloudflare Pages instead of a Node/Worker server.
  output: 'export',
  images: {
    // next/image has no optimizer outside a server runtime.
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  }
}

export default nextConfig
