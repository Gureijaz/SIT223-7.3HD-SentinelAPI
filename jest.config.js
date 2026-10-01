'use strict';

module.exports = {
  rootDir: '.',
  setupFiles: ['<rootDir>/tests/setup-env.js'],
  clearMocks: true,
  testEnvironment: 'node',
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      setupFiles: ['<rootDir>/tests/setup-env.js'],
      testMatch: ['<rootDir>/tests/unit/**/*.test.js'],
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      setupFiles: ['<rootDir>/tests/setup-env.js'],
      testMatch: ['<rootDir>/tests/integration/**/*.test.js'],
    },
  ],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server.js',
    '!**/node_modules/**',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'text-summary', 'lcov', 'cobertura'],
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 70,
      functions: 80,
      lines: 80,
    },
  },
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: '<rootDir>/reports/junit',
      outputName: 'junit.xml',
      classNameTemplate: '{classname}',
      titleTemplate: '{title}',
      ancestorSeparator: ' › ',
    }],
  ],
};
