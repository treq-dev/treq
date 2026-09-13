module.exports = {
  preset: 'react-native',
  setupFilesAfterEnv: ['./jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-navigation|react-native-screens|react-native-safe-area-context|react-native-keychain|@react-native-async-storage)/)',
  ],
  moduleNameMapper: {
    '^@react-native-async-storage/async-storage$': '@react-native-async-storage/async-storage/jest',
  },
  // `*.real.test.tsx` files run against the real compiled Rust addon (see
  // jest.config.real.js / `npm run test:real`), not the mocked TreqSsh this
  // config's jest.setup.js installs - excluded here so `npm test` doesn't
  // fail on a native-test/treq_mobile_ssh.node that build:native-test
  // hasn't produced yet.
  testPathIgnorePatterns: ['/node_modules/', '\\.real\\.test\\.tsx$'],
};
