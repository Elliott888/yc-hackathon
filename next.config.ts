import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/fetch-leads": [
      "./src/data/hybrid-structured/**/*",
      "./neural-github-intent/data-track-a-1000/scored_leads.ndjson",
    ],
  },
};

export default nextConfig;
