const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const rootNodeModules = path.resolve(__dirname, '../node_modules');
const localNodeModules = path.resolve(__dirname, 'node_modules');

module.exports = mergeConfig(getDefaultConfig(__dirname), {
  watchFolders: [path.resolve(__dirname, '..')],
  resolver: {
    nodeModulesPaths: [localNodeModules, rootNodeModules],
    useWatchman: false,
  },
});
