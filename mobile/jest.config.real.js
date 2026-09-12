const path = require('node:path');

module.exports = {
  preset: 'react-native',
  displayName: 'real-ssh',
  testMatch: ['<rootDir>/src/**/__tests__/*.real.test.tsx'],
  setupFilesAfterEnv: ['./jest.setup.real.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-navigation|react-native-screens|react-native-safe-area-context|react-native-keychain)/)',
  ],
  moduleNameMapper: {
    // Routes every screen's `import TreqSsh from '../native/TreqSsh'`
    // (whatever its relative depth) to the real-addon-backed
    // implementation instead of the default export, which jest.config.js's
    // (component-level) tests mock via jest.setup.js.
    '(\\.\\./)+native/TreqSsh$': path.join(__dirname, 'src/native/TreqSsh.real.ts'),
  },
};
