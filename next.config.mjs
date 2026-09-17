/** @type {import('next').NextConfig} */
const nextConfig = {
  // A self-contained server bundle: the runtime image carries the app, not the
  // toolchain (T-0.DEPLOY.02).
  output: "standalone",
  reactStrictMode: true,
};

export default nextConfig;
