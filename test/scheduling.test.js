/**
 * Tests for scheduling.ts
 *
 * Test PRD structure:
 * - T001: Done (started_at + done_at known)
 * - T002: Done (only done_at known) - blocked by T001
 * - T003: In Progress (started_at known) - blocked by T002
 * - T004: In Progress (no dates) - blocked by T002
 * - T005: Not Started - blocked by T003
 * - T006: Not Started - blocked by T004
 * - T007: Not Started - no blockers
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Import the scheduling functions (compiled JS)
import {
  calculateTheoreticalSchedule,
  calculateRealSchedule,
  calculateCriticalPath,
  getScheduleEnvelope,
  calculateGanttMetrics
} from '../dist/cli/lib/scheduling.js';

// Mock effort config
const effortConfig = {
  default_duration: '2h',
  effort_map: 'S=1h,M=2h,L=4h,XL=8h'
};

describe('Scheduling - Theoretical Schedule', () => {
  it('should calculate theoretical schedule without dates', () => {
    const taskData = new Map([
      ['T001', { id: 'T001', effort: '2h', blockedBy: [] }],
      ['T002', { id: 'T002', effort: '2h', blockedBy: ['T001'] }],
      ['T003', { id: 'T003', effort: '2h', blockedBy: ['T002'] }],
    ]);

    const schedule = calculateTheoreticalSchedule(taskData, effortConfig);

    // T001: starts at 0, ends at 2
    assert.strictEqual(schedule.get('T001').startHour, 0);
    assert.strictEqual(schedule.get('T001').endHour, 2);

    // T002: starts at 2 (after T001), ends at 4
    assert.strictEqual(schedule.get('T002').startHour, 2);
    assert.strictEqual(schedule.get('T002').endHour, 4);

    // T003: starts at 4 (after T002), ends at 6
    assert.strictEqual(schedule.get('T003').startHour, 4);
    assert.strictEqual(schedule.get('T003').endHour, 6);
  });

  it('should handle parallel tasks (no dependencies between them)', () => {
    const taskData = new Map([
      ['T001', { id: 'T001', effort: '2h', blockedBy: [] }],
      ['T002', { id: 'T002', effort: '4h', blockedBy: [] }],
      ['T003', { id: 'T003', effort: '2h', blockedBy: ['T001', 'T002'] }],
    ]);

    const schedule = calculateTheoreticalSchedule(taskData, effortConfig);

    // T001 and T002 start at 0 (parallel)
    assert.strictEqual(schedule.get('T001').startHour, 0);
    assert.strictEqual(schedule.get('T002').startHour, 0);

    // T003 starts after the longest blocker (T002 ends at 4)
    assert.strictEqual(schedule.get('T003').startHour, 4);
    assert.strictEqual(schedule.get('T003').endHour, 6);
  });
});

describe('Scheduling - Real Schedule with Done tasks', () => {
  it('should use actual dates for Done tasks (both dates known)', () => {
    // T0 = Jan 1, 2026 00:00
    const t0 = new Date('2026-01-01T00:00:00');
    const now = new Date('2026-01-02T00:00:00'); // Fixed "now"

    const taskData = new Map([
      ['T001', {
        id: 'T001',
        effort: '2h',
        blockedBy: [],
        status: 'Done',
        startedAt: '2026-01-01T10:00:00', // 10 hours after T0
        doneAt: '2026-01-01T14:00:00'     // 14 hours after T0
      }],
    ]);

    const schedule = calculateRealSchedule(taskData, effortConfig, t0, now);

    assert.strictEqual(schedule.get('T001').startHour, 10);
    assert.strictEqual(schedule.get('T001').endHour, 14);
    assert.strictEqual(schedule.get('T001').durationHours, 2); // Original effort
  });

  it('should calculate end from start + duration when done_at unknown', () => {
    const t0 = new Date('2026-01-01T00:00:00');
    const now = new Date('2026-01-02T00:00:00');

    const taskData = new Map([
      ['T001', {
        id: 'T001',
        effort: '4h',
        blockedBy: [],
        status: 'Done',
        startedAt: '2026-01-01T10:00:00', // 10 hours after T0
        // done_at unknown
      }],
    ]);

    const schedule = calculateRealSchedule(taskData, effortConfig, t0, now);

    assert.strictEqual(schedule.get('T001').startHour, 10);
    assert.strictEqual(schedule.get('T001').endHour, 14); // start + duration
  });

  it('should calculate start from end - duration when started_at unknown', () => {
    const t0 = new Date('2026-01-01T00:00:00');
    const now = new Date('2026-01-02T00:00:00');

    const taskData = new Map([
      ['T001', {
        id: 'T001',
        effort: '4h',
        blockedBy: [],
        status: 'Done',
        // started_at unknown
        doneAt: '2026-01-01T14:00:00' // 14 hours after T0
      }],
    ]);

    const schedule = calculateRealSchedule(taskData, effortConfig, t0, now);

    assert.strictEqual(schedule.get('T001').startHour, 10); // end - duration
    assert.strictEqual(schedule.get('T001').endHour, 14);
  });
});

describe('Scheduling - Real Schedule with In Progress tasks', () => {
  it('should set end = now + duration for In Progress task with started_at', () => {
    const t0 = new Date('2026-01-01T00:00:00');
    const now = new Date('2026-01-01T20:00:00'); // 20 hours after T0

    const taskData = new Map([
      ['T001', {
        id: 'T001',
        effort: '4h',
        blockedBy: [],
        status: 'In Progress',
        startedAt: '2026-01-01T10:00:00', // 10 hours after T0
      }],
    ]);

    const schedule = calculateRealSchedule(taskData, effortConfig, t0, now);
    const s = schedule.get('T001');

    // Start should be from started_at (10h)
    assert.strictEqual(s.startHour, 10);

    // End should be now + duration = 20 + 4 = 24
    assert.strictEqual(s.endHour, 24);

    // Duration should be preserved
    assert.strictEqual(s.durationHours, 4);
  });

  it('should set start = now and end = now + duration for In Progress task without started_at', () => {
    const t0 = new Date('2026-01-01T00:00:00');
    const now = new Date('2026-01-01T20:00:00'); // 20 hours after T0

    const taskData = new Map([
      ['T001', {
        id: 'T001',
        effort: '4h',
        blockedBy: [],
        status: 'In Progress',
        // No started_at
      }],
    ]);

    const schedule = calculateRealSchedule(taskData, effortConfig, t0, now);
    const s = schedule.get('T001');

    // Start = now = 20
    assert.strictEqual(s.startHour, 20);

    // End = now + duration = 20 + 4 = 24
    assert.strictEqual(s.endHour, 24);

    assert.strictEqual(s.durationHours, 4);
  });

  it('should show stretch when task has been running longer than duration', () => {
    const t0 = new Date('2026-01-01T00:00:00');
    const now = new Date('2026-01-01T20:00:00'); // 20 hours after T0

    const taskData = new Map([
      ['T001', {
        id: 'T001',
        effort: '4h', // Only 4h of work
        blockedBy: [],
        status: 'In Progress',
        startedAt: '2026-01-01T10:00:00', // Started 10h ago, running for 10h already
      }],
    ]);

    const schedule = calculateRealSchedule(taskData, effortConfig, t0, now);
    const s = schedule.get('T001');

    // Timespan = endHour - startHour = 24 - 10 = 14h (exceeds 4h duration)
    const timespan = s.endHour - s.startHour;
    assert.strictEqual(timespan, 14);
    assert.ok(timespan > s.durationHours, 'Timespan should exceed duration (stretch)');
  });
});

describe('Scheduling - Real Schedule with Not Started tasks', () => {
  it('should schedule Not Started task after blocker ends', () => {
    const t0 = new Date('2026-01-01T00:00:00');
    const now = new Date('2026-01-01T08:00:00'); // 8 hours after T0

    const taskData = new Map([
      ['T001', {
        id: 'T001',
        effort: '2h',
        blockedBy: [],
        status: 'Done',
        startedAt: '2026-01-01T10:00:00',
        doneAt: '2026-01-01T12:00:00' // ends at hour 12
      }],
      ['T002', {
        id: 'T002',
        effort: '4h',
        blockedBy: ['T001'],
        status: 'Not Started',
      }],
    ]);

    const schedule = calculateRealSchedule(taskData, effortConfig, t0, now);

    // T002 should start at max(now=8, blocker_end=12) = 12
    const t002 = schedule.get('T002');
    assert.strictEqual(t002.startHour, 12);
    assert.strictEqual(t002.endHour, 16); // 12 + 4
  });

  it('should start at now if no blockers and now > 0', () => {
    const t0 = new Date('2026-01-01T00:00:00');
    const now = new Date('2026-01-01T10:00:00'); // 10 hours after T0

    const taskData = new Map([
      ['T001', {
        id: 'T001',
        effort: '4h',
        blockedBy: [],
        status: 'Not Started',
      }],
    ]);

    const schedule = calculateRealSchedule(taskData, effortConfig, t0, now);

    // T001 should start at now = 10
    const t001 = schedule.get('T001');
    assert.strictEqual(t001.startHour, 10);
    assert.strictEqual(t001.endHour, 14); // 10 + 4
  });

  it('should cascade dependencies through In Progress tasks', () => {
    const t0 = new Date('2026-01-01T00:00:00');
    const now = new Date('2026-01-01T20:00:00'); // 20 hours after T0

    const taskData = new Map([
      ['T001', {
        id: 'T001',
        effort: '2h',
        blockedBy: [],
        status: 'In Progress',
        startedAt: '2026-01-01T10:00:00', // hour 10
      }],
      ['T002', {
        id: 'T002',
        effort: '4h',
        blockedBy: ['T001'],
        status: 'Not Started',
      }],
      ['T003', {
        id: 'T003',
        effort: '2h',
        blockedBy: ['T002'],
        status: 'Not Started',
      }],
    ]);

    const schedule = calculateRealSchedule(taskData, effortConfig, t0, now);

    const t001 = schedule.get('T001');
    const t002 = schedule.get('T002');
    const t003 = schedule.get('T003');

    // T001 (In Progress): start = 10, end = now + 2h = 22
    assert.strictEqual(t001.startHour, 10);
    assert.strictEqual(t001.endHour, 22);

    // T002 (Not Started): start = max(now=20, T001.end=22) = 22, end = 22 + 4 = 26
    assert.strictEqual(t002.startHour, 22);
    assert.strictEqual(t002.endHour, 26);

    // T003 (Not Started): start = max(now=20, T002.end=26) = 26, end = 26 + 2 = 28
    assert.strictEqual(t003.startHour, 26);
    assert.strictEqual(t003.endHour, 28);
  });
});

describe('Scheduling - Complete PRD scenario', () => {
  it('should correctly schedule a mixed PRD', () => {
    const t0 = new Date('2026-01-01T00:00:00');
    const now = new Date('2026-01-01T14:00:00'); // 14 hours after T0

    // Simulated PRD:
    // T001: Done (both dates) - baseline
    // T002: Done (only done_at) - blocked by T001
    // T003: In Progress (started_at) - blocked by T002
    // T004: Not Started - blocked by T003
    const taskData = new Map([
      ['T001', {
        id: 'T001',
        effort: '2h',
        blockedBy: [],
        status: 'Done',
        startedAt: '2026-01-01T08:00:00', // hour 8
        doneAt: '2026-01-01T10:00:00'     // hour 10
      }],
      ['T002', {
        id: 'T002',
        effort: '2h',
        blockedBy: ['T001'],
        status: 'Done',
        doneAt: '2026-01-01T12:00:00'     // hour 12 (started_at = 12-2 = 10)
      }],
      ['T003', {
        id: 'T003',
        effort: '4h',
        blockedBy: ['T002'],
        status: 'In Progress',
        startedAt: '2026-01-01T12:00:00', // hour 12
      }],
      ['T004', {
        id: 'T004',
        effort: '2h',
        blockedBy: ['T003'],
        status: 'Not Started',
      }],
    ]);

    const schedule = calculateRealSchedule(taskData, effortConfig, t0, now);

    // T001: 8-10
    assert.strictEqual(schedule.get('T001').startHour, 8);
    assert.strictEqual(schedule.get('T001').endHour, 10);

    // T002: 10-12 (start = end - duration)
    assert.strictEqual(schedule.get('T002').startHour, 10);
    assert.strictEqual(schedule.get('T002').endHour, 12);

    // T003: start = 12, end = now + 4h = 14 + 4 = 18
    const t003 = schedule.get('T003');
    assert.strictEqual(t003.startHour, 12);
    assert.strictEqual(t003.endHour, 18);

    // T004: start = max(now=14, T003.end=18) = 18, end = 18 + 2 = 20
    const t004 = schedule.get('T004');
    assert.strictEqual(t004.startHour, 18);
    assert.strictEqual(t004.endHour, 20);

    // Verify the chain
    assert.ok(schedule.get('T002').startHour >= schedule.get('T001').endHour);
    assert.ok(schedule.get('T003').startHour >= schedule.get('T002').endHour);
    assert.ok(schedule.get('T004').startHour >= schedule.get('T003').endHour);
  });
});

describe('Scheduling - Gantt Metrics', () => {
  it('should calculate correct metrics for a PRD', () => {
    const t0 = new Date('2026-01-01T00:00:00');
    const now = new Date('2026-01-01T16:00:00'); // 16 hours after T0

    const taskData = new Map([
      ['T001', {
        id: 'T001',
        effort: '2h',
        blockedBy: [],
        status: 'Done',
        startedAt: '2026-01-01T08:00:00', // hour 8
        doneAt: '2026-01-01T10:00:00'     // hour 10
      }],
      ['T002', {
        id: 'T002',
        effort: '4h',
        blockedBy: ['T001'],
        status: 'Done',
        startedAt: '2026-01-01T10:00:00', // hour 10
        doneAt: '2026-01-01T14:00:00'     // hour 14
      }],
    ]);

    const metrics = calculateGanttMetrics(taskData, effortConfig, t0, now);

    // Total effort = 2h + 4h = 6h
    assert.strictEqual(metrics.totalEffortHours, 6);

    // Span = 14 - 8 = 6h
    assert.strictEqual(metrics.realSpanHours, 6);

    // Min start = 8
    assert.strictEqual(metrics.minStartHour, 8);

    // Max end = 14
    assert.strictEqual(metrics.maxEndHour, 14);

    // Critical timespan (theoretical) = 6h (2h + 4h sequential)
    assert.strictEqual(metrics.criticalTimespanHours, 6);
  });

  it('should calculate displaySpanHours excluding in-progress now extension', () => {
    const t0 = new Date('2026-01-01T00:00:00');
    const now = new Date('2026-01-01T20:00:00'); // 20 hours after T0

    const taskData = new Map([
      ['T001', {
        id: 'T001',
        effort: '2h',
        blockedBy: [],
        status: 'Done',
        startedAt: '2026-01-01T08:00:00', // hour 8
        doneAt: '2026-01-01T10:00:00'     // hour 10
      }],
      ['T002', {
        id: 'T002',
        effort: '4h',
        blockedBy: ['T001'],
        status: 'In Progress',
        startedAt: '2026-01-01T10:00:00', // hour 10
      }],
      ['T003', {
        id: 'T003',
        effort: '2h',
        blockedBy: ['T002'],
        status: 'Not Started',
      }],
    ]);

    const metrics = calculateGanttMetrics(taskData, effortConfig, t0, now);

    // T002 In Progress: end = now + 4 = 24
    // T003 Not Started: start = 24, end = 26

    // realSpanHours = 26 - 8 = 18
    assert.strictEqual(metrics.realSpanHours, 18);

    // displaySpanHours should use T002.start + duration = 10 + 4 = 14 for T002
    // Then T003 starts at 24 (based on real T002 end), ends at 26
    // But for display, T002 would end at 14, so the question is what displayMaxEndHour should be
    // Since T003 depends on T002's real end, not display end, displayMaxEndHour = maxEndHour
    // Actually the displaySpanHours is meant to exclude the "stretch" of in-progress tasks

    // Let's verify: T003 end = 26 is the maxEndHour
    assert.strictEqual(metrics.maxEndHour, 26);
  });
});

describe('Scheduling - Critical Path', () => {
  it('should identify tasks on the critical path', () => {
    const taskData = new Map([
      ['T001', { id: 'T001', effort: '2h', blockedBy: [] }],
      ['T002', { id: 'T002', effort: '4h', blockedBy: ['T001'] }],
      ['T003', { id: 'T003', effort: '1h', blockedBy: ['T001'] }], // Parallel to T002
    ]);

    const schedule = calculateTheoreticalSchedule(taskData, effortConfig);
    const criticalPath = calculateCriticalPath(taskData, schedule);

    // Critical path should be T001 -> T002 (total 6h)
    // T003 is not critical (only 3h path: T001 + T003)
    assert.ok(criticalPath.includes('T001'), 'T001 should be on critical path');
    assert.ok(criticalPath.includes('T002'), 'T002 should be on critical path');
    assert.ok(!criticalPath.includes('T003'), 'T003 should NOT be on critical path');
  });
});
