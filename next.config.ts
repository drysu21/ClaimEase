import type { NextConfig } from 'next';

// node:sqlite is stable enough for this app but still prints an "experimental" notice in every
// worker process. Hide just that notice; other warnings are untouched.
const quiet = '--disable-warning=ExperimentalWarning';
if (!process.env.NODE_OPTIONS?.includes(quiet)) {
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} ${quiet}`.trim();
}

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default config;
