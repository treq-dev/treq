import '@testing-library/jest-native/extend-expect';

// Deliberately no jest.mock('./src/native/TreqSsh', ...) here: this test
// project (jest.config.real.js) routes that import to the real
// napi-backed implementation via moduleNameMapper instead. See
// mobile/README.md "What's tested".
