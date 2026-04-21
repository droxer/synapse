const nextJest = require("next/jest");

const createJestConfig = nextJest({
  dir: "./",
});

const customJestConfig = {
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    // ESM-only markdown stack — stub in Jest (real parsing is covered in build / browser).
    "^react-markdown$": "<rootDir>/src/test/mocks/react-markdown.tsx",
    "^remark-gfm$": "<rootDir>/src/test/mocks/unified-noop-plugin.ts",
    "^remark-math$": "<rootDir>/src/test/mocks/unified-noop-plugin.ts",
    "^rehype-katex$": "<rootDir>/src/test/mocks/unified-noop-plugin.ts",
    "^rehype-highlight$": "<rootDir>/src/test/mocks/unified-noop-plugin.ts",
  },
  testMatch: ["**/*.test.ts", "**/*.test.tsx"],
};

module.exports = createJestConfig(customJestConfig);
