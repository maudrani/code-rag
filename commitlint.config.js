export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Scope is required and constrained to the architecture's layers (+ housekeeping).
    // Keeps a clean, reviewable Conventional-Commits history across the build.
    'scope-enum': [
      2,
      'always',
      [
        'ingest',
        'retrieval',
        'answer',
        'surface',
        'frontend',
        'contracts',
        'membrane',
        'repo',
        'ci',
        'deps',
      ],
    ],
    'scope-empty': [2, 'never'],
  },
}
