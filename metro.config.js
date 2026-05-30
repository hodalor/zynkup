const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Watchman crashes in this environment, so fall back to Node file watching.
config.resolver.useWatchman = false;

module.exports = config;
