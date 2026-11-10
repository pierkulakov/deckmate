// 2026-11-10: keep fixture routing and the resource-limited Vitest project in one registry.
export const browserFixtures = {
  'attachments-panel': 'tests/attachments-panel.test.ts',
  'attachments-refresh': 'tests/attachments-refresh.test.ts',
  'card-drag-layout': 'tests/card-drag-layout.test.ts',
  'card-edit-attachments': 'tests/card-edit-attachments.test.ts',
  'card-preview-first-batch': 'tests/card-preview-first-batch.test.ts',
  'card-preview-loading': 'tests/card-preview-loading.test.ts',
  'card-preview-quick-settings': 'tests/card-preview-quick-settings.test.ts',
  'card-state-actions': 'tests/card-state-actions.test.ts',
  'card-scale': 'tests/card-scale.test.ts',
  'card-scope': 'tests/card-scope.test.ts',
  'client-audit-regressions': 'tests/client-audit-regressions.test.ts',
  'controls': 'tests/controls.test.ts',
  'deck-transition': 'tests/deck-transition.test.ts',
  'empty-deck': 'tests/empty-deck.test.ts',
  'escape-focus': 'tests/escape-focus.test.ts',
  'open-deck-chrome': 'tests/open-deck-chrome.test.ts',
  'first-use-navigation': 'tests/first-use-navigation.test.ts',
  'hand-drag-performance': 'tests/hand-drag-performance.test.ts',
  'hero-return': 'tests/hero-return.test.ts',
  'small-dialogs': 'tests/small-dialogs.test.ts',
  'import-templates': 'tests/import-templates.test.ts',
  'inbox-flows': 'tests/inbox-flows.test.ts',
  'members-states': 'tests/members-states.test.ts',
  'interface-states': 'tests/interface-states.test.ts',
  'journey-operation': 'tests/journey-operation-ui.test.tsx',
  'journey-track': 'tests/journey-track.test.tsx',
  'project-pulse-cache': 'tests/project-pulse-cache.test.ts',
  'selects': 'tests/selects.test.ts',
  'shell-ui': 'tests/shell-ui.test.ts',
  'vision-chrome': 'tests/vision-chrome.test.ts',
};

export type BrowserFixture = keyof typeof browserFixtures;
// 2026-11-10: the full-app/API integration owns its proxy, but must share the serial browser budget.
export const browserFiles = [...Object.values(browserFixtures), 'tests/agent-collaboration-ux.test.ts'];
