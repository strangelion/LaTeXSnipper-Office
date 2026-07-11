module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  globals: {
    MathJax: 'readonly',
    Office: 'readonly',
    Excel: 'readonly',
    PowerPoint: 'readonly',
    Word: 'readonly',
    Logger: 'readonly',
  },
  rules: {
    'no-undef': 'error',
    'no-unreachable': 'error',
    'no-constant-condition': ['error', { checkLoops: false }],
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  },
};
