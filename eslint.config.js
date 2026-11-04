// ESLint 9 flat config for OpenHamClock.
//
// Scope: the frontend (src/), the Express server (server/, server.js, config.js),
// the rig-bridge companion app, the scripts/ helpers, the Electron shell and the
// public service worker. Sibling microservices (ohc-cluster, dxspider-proxy, …)
// own their package.json and are linted — if at all — from their own directory.
//
// Signal over noise: the rules that fire as *errors* are the ones that have
// produced real crashes (rules-of-hooks, no-undef) or are unambiguous bugs.
// Everything stylistic is left to Prettier; everything advisory is a warning.
const js = require('@eslint/js');
const globals = require('globals');
const reactHooks = require('eslint-plugin-react-hooks');
// Only for `react/jsx-uses-vars`: ESLint 9's scope analysis does not count
// `<Foo />` as a use of `Foo`, so without it every JSX-only component import
// shows up as a false no-unused-vars warning. No other react/* rules are on.
const react = require('eslint-plugin-react');

// Browser-only "window" globals that Vite's `define` block injects at build time.
const viteDefines = {
  __OHC_VERSION__: 'readonly',
  __OHC_BUILD_TS__: 'readonly',
};

const sharedRules = {
  ...js.configs.recommended.rules,
  // Real bugs — keep at error.
  'no-undef': 'error',
  // Advisory: unused code is a smell, not a crash. `_`-prefixed names are the
  // conventional "intentionally unused" marker. Unused `catch (e)` bindings are
  // not reported — swallowing an error on purpose is common and harmless here.
  'no-unused-vars': [
    'warn',
    {
      args: 'after-used',
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrors: 'none',
      destructuredArrayIgnorePattern: '^_',
      ignoreRestSiblings: true,
    },
  ],
  // `catch {}` and `while (x) {}` with a comment inside are common and benign.
  'no-empty': ['warn', { allowEmptyCatch: true }],
  // A `\/` or `\-` that does nothing is untidy, not a bug.
  'no-useless-escape': 'warn',
  // The server deliberately strips \x00-\x1f from telnet/cluster streams and
  // user-supplied QSO text; those regexes are the point, not a mistake.
  'no-control-regex': 'off',
};

module.exports = [
  {
    ignores: [
      // Build output / dependencies
      '**/node_modules/**',
      'dist/**',
      'dist-electron/**',
      'release/**',
      'build/**',
      'out/**',
      'coverage/**',
      // Vendored / generated / fetched assets
      'public/vendor/**',
      'public/wasm/**',
      'public/index-monolithic.html',
      'src/assets/geodata/**',
      'src/plugins/local/**/*.js',
      'src/plugins/local/**/*.jsx',
      'wasm-build/**',
      // k6 load-test script: runs inside k6, not Node (k6/http imports, __ENV)
      'scripts/load/**',
      // Editor / agent scratch
      '.claude/**',
      '.agent/**',
      // Sibling services with their own package.json and tooling
      'AddOns/**',
      'dx-relay/**',
      'dxspider-proxy/**',
      'fletcher/**',
      'iturhfprop-service/**',
      'ohc-cluster/**',
      'presentations/**',
      'rig-control/**',
      'rig-listener/**',
      'watchtower/**',
      'wsjtx-relay/**',
      // Test fixtures (captured external pages)
      '**/__fixtures__/**',
    ],
  },

  // ---------------------------------------------------------------------------
  // Frontend: React 18 + JSX, ES modules, browser globals.
  // ---------------------------------------------------------------------------
  {
    files: ['src/**/*.{js,jsx,mjs}'],
    ignores: ['src/server/**'], // Node-side cty.dat parser, see below
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...viteDefines,
        // Leaflet is loaded as a classic script in index.html (/vendor/leaflet)
        L: 'readonly',
      },
    },
    plugins: { 'react-hooks': reactHooks, react },
    rules: {
      ...sharedRules,
      'react/jsx-uses-vars': 'error',
      // Calling a hook after an early return, inside a condition, or not at
      // all while still referencing its result crashes React at runtime.
      'react-hooks/rules-of-hooks': 'error',
      // Missing/extra effect deps change behaviour; surface them, don't block.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Vitest test files (globals: true in vitest.config.js) + the test setup.
  {
    files: ['src/**/*.test.{js,jsx}', 'src/test/**/*.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.vitest, ...globals.node },
    },
  },

  // ---------------------------------------------------------------------------
  // Server, rig-bridge, Electron shell, scripts: Node, CommonJS.
  // ---------------------------------------------------------------------------
  {
    files: [
      'server.js',
      'config.js',
      'server/**/*.js',
      'src/server/**/*.js', // cty.dat parser required by server/ (CommonJS)
      'rig-bridge/**/*.js',
      'electron/**/*.js',
      'scripts/**/*.js',
      'mqtt-test.js',
      'verify_settings.js',
      'eslint.config.js',
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: sharedRules,
  },

  // Node ES-module files (scripts/*.mjs, vite/vitest config).
  {
    files: ['**/*.mjs', 'vitest.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: sharedRules,
  },

  // Node-side vitest suites are ESM (`import { describe } from 'vitest'`) that
  // still `require()` the CommonJS modules under test — vitest provides both.
  {
    files: ['server/**/*.test.js', 'src/server/**/*.test.js', 'rig-bridge/**/*.test.js', 'scripts/**/*.test.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node, ...globals.vitest },
    },
  },

  // Service worker shipped from public/.
  {
    files: ['public/sw.js', 'public/sw-policy.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: { ...globals.serviceworker },
    },
    rules: sharedRules,
  },
];
