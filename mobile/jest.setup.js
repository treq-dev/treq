import '@testing-library/jest-native/extend-expect';

jest.mock('./src/native/TreqSsh', () => ({
  __esModule: true,
  default: {
    generateDeviceKey: jest.fn(),
    connect: jest.fn(),
    execCommand: jest.fn(),
    disconnect: jest.fn(),
  },
}));
