import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },
];
