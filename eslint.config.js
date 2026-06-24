import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

// Node-side code: root CLIs/configs, Express server, MCP server, shared libs, tools
const nodeFiles = [
  '*.{js,mjs,cjs}',
  'server/**/*.{js,mjs,cjs}',
  'mcp/**/*.{js,mjs,cjs}',
  'lib/**/*.{js,mjs,cjs}',
  'tools/**/*.{js,mjs,cjs}',
]

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    ignores: nodeFiles,
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    files: nodeFiles,
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.node,
      parserOptions: {
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      // Empty catch = intentional best-effort fallthrough in server/CLI code
      'no-empty': ['error', { allowEmptyCatch: true }],
      // ANSI escape stripping needs \x1b in regexes
      'no-control-regex': 'off',
    },
  },
])
