import type { NextConfig } from 'next'

const gatewayURL   = process.env.NEXT_PUBLIC_GATEWAY_URL     ?? 'http://localhost:8080'
const authURL      = process.env.NEXT_PUBLIC_AUTH_URL        ?? 'http://localhost:8081'
const traceURL     = process.env.NEXT_PUBLIC_TRACE_QUERY_URL ?? 'http://localhost:8084'
const ctxURL       = process.env.NEXT_PUBLIC_CTX_URL         ?? 'http://localhost:8001'

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: '/v1/:path*',   destination: `${gatewayURL}/v1/:path*` },
      { source: '/auth/:path*', destination: `${authURL}/:path*` },
      { source: '/tqs/:path*',  destination: `${traceURL}/:path*` },
      { source: '/ctx/:path*',  destination: `${ctxURL}/:path*` },
    ]
  },
}

export default nextConfig
