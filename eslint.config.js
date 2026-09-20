import js from '@eslint/js';
import globals from 'globals';

export default [{
  files: ['src/**/*.js'],
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.browser } },
  rules: { ...js.configs.recommended.rules, 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }], 'no-constant-condition': 'off' },
}];
