// 2026-11-05: structural request checks; registry parsers enforce dates and lifecycle invariants.
const hash = { type: 'string', pattern: '^(?:[0-9a-f]{64})?$' };
const identifier = { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,79}$' };
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const color = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' };
const description = { type: 'string', maxLength: 10000 };
const cover = { type: 'string', maxLength: 2048 };
const carryOver = { type: 'object', additionalProperties: false, required: ['review', 'blocked', 'other'],
  properties: { review: { type: 'boolean' }, blocked: { type: 'boolean' }, other: { type: 'boolean' } } };

export const planningBodySchema = {
  type: 'object', additionalProperties: false, required: ['source', 'action'], properties: {
    source: { const: 'sandbox' },
    action: { enum: ['update-run', 'save-run-configuration', 'finish-run', 'delete-run', 'resume-runs', 'create-milestone', 'update-milestone', 'delete-milestone', 'pin-milestone'] },
    runsHash: hash, milestonesHash: hash, manifestHash: hash, optionsHash: hash,
    runId: identifier, configurationId: identifier,
    milestoneId: { ...identifier, type: ['string', 'null'] }, carryOver,
    configuration: { type: 'object', additionalProperties: false,
      required: ['id', 'shortName', 'color', 'labelTemplate', 'startDate', 'durationWeeks', 'upcomingCount', 'finishTime', 'timeZone', 'carryOver'],
      properties: { id: identifier, shortName: { type: 'string', minLength: 1, maxLength: 5 }, color,
        projectSpecific: { type: 'boolean' }, labelTemplate: { type: 'string', minLength: 1, maxLength: 160 },
        startDate: date, durationWeeks: { type: 'integer', minimum: 1, maximum: 52 },
        upcomingCount: { type: 'integer', minimum: 1, maximum: 52 },
        finishTime: { type: 'string', pattern: '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$' },
        timeZone: { type: 'string', minLength: 1, maxLength: 100 }, carryOver, stopDate: date,
      } },
    run: { type: 'object', additionalProperties: false, required: ['id', 'number', 'start', 'end', 'goal'],
      properties: { id: identifier, number: { type: 'integer', minimum: 1 }, start: date, end: date,
        goal: { type: 'string', minLength: 1, maxLength: 200 }, configurationId: identifier,
        description, cover, finishedAt: { type: 'string' }, statistics: { type: 'object' }, history: { type: 'array', maxItems: 4000 },
      } },
    milestone: { type: 'object', additionalProperties: false, required: ['id', 'title', 'date', 'color'],
      properties: { id: identifier, title: { type: 'string', minLength: 1, maxLength: 120 }, date, color,
        projectSpecific: { type: 'boolean' }, description, cover, history: { type: 'array', maxItems: 4000 },
      } },
  },
  allOf: [
    { if: { properties: { action: { const: 'update-run' } } }, then: { required: ['run', 'runsHash'] } },
    { if: { properties: { action: { const: 'save-run-configuration' } } }, then: { required: ['configuration', 'runsHash'] } },
    { if: { properties: { action: { const: 'finish-run' } } }, then: { required: ['runId', 'carryOver', 'runsHash', 'optionsHash'] } },
    { if: { properties: { action: { const: 'delete-run' } } }, then: { required: ['runId', 'runsHash', 'optionsHash'] } },
    { if: { properties: { action: { const: 'resume-runs' } } }, then: { required: ['configurationId', 'runsHash'] } },
    { if: { properties: { action: { enum: ['create-milestone', 'update-milestone'] } } }, then: { required: ['milestone', 'milestonesHash'] } },
    { if: { properties: { action: { const: 'delete-milestone' } } }, then: { required: ['milestoneId', 'milestonesHash', 'optionsHash', 'manifestHash'], properties: { milestoneId: identifier } } },
    { if: { properties: { action: { const: 'pin-milestone' } } }, then: { required: ['milestoneId', 'milestonesHash', 'manifestHash'] } },
  ],
};
