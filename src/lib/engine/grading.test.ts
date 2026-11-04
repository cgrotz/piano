import { describe, it, expect, beforeEach } from 'vitest';
import { GradingEngine } from './grading';
import type { GradedStep } from '../score/extractor';

function step(pitches: number[], index = 0): GradedStep {
  return { pitches, measure: 1, cursorIndex: index };
}

describe('GradingEngine', () => {
  let engine: GradingEngine;

  beforeEach(() => {
    engine = new GradingEngine();
  });

  it('starts with status "empty"', () => {
    expect(engine.status).toBe('empty');
    expect(engine.total).toBe(0);
  });

  describe('empty load', () => {
    it('remains "empty" when loaded with no steps', () => {
      engine.load([]);
      expect(engine.status).toBe('empty');
      expect(engine.total).toBe(0);
    });

    it('returns "idle" for any pressed note', () => {
      engine.load([]);
      expect(engine.pressNote(60)).toBe('idle');
    });
  });

  describe('single note', () => {
    it('returns "completed" when the correct pitch is pressed', () => {
      engine.load([step([60])]);
      expect(engine.status).toBe('playing');
      expect(engine.pressNote(60)).toBe('completed');
      expect(engine.status).toBe('completed');
    });
  });

  describe('wrong note', () => {
    it('returns "wrong" and increments errorCount', () => {
      engine.load([step([60])]);
      expect(engine.pressNote(61)).toBe('wrong');
      expect(engine.errorCount).toBe(1);
      expect(engine.index).toBe(0);
    });

    it('accumulates errors across multiple wrong notes', () => {
      engine.load([step([60])]);
      engine.pressNote(61);
      engine.pressNote(62);
      expect(engine.errorCount).toBe(2);
    });
  });

  describe('sequence of single-note steps', () => {
    it('advances through steps and completes on the last one', () => {
      engine.load([step([60], 0), step([64], 1), step([67], 2)]);
      expect(engine.pressNote(60)).toBe('advanced');
      expect(engine.index).toBe(1);
      expect(engine.pressNote(64)).toBe('advanced');
      expect(engine.index).toBe(2);
      expect(engine.pressNote(67)).toBe('completed');
      expect(engine.status).toBe('completed');
    });
  });

  describe('chord', () => {
    it('returns "progress" until all chord tones are satisfied, then "completed"', () => {
      engine.load([step([60, 64, 67])]);
      expect(engine.pressNote(60)).toBe('progress');
      expect(engine.satisfiedPitches).toContain(60);
      expect(engine.pressNote(64)).toBe('progress');
      expect(engine.pressNote(67)).toBe('completed');
    });

    it('returns "advanced" when more steps follow', () => {
      engine.load([step([60, 64, 67], 0), step([72], 1)]);
      expect(engine.pressNote(60)).toBe('progress');
      expect(engine.pressNote(64)).toBe('progress');
      expect(engine.pressNote(67)).toBe('advanced');
      expect(engine.index).toBe(1);
    });
  });

  describe('chord with error', () => {
    it('reports "wrong" but keeps already-satisfied pitches', () => {
      engine.load([step([60, 64, 67])]);
      expect(engine.pressNote(60)).toBe('progress');
      expect(engine.pressNote(61)).toBe('wrong');
      expect(engine.errorCount).toBe(1);
      // The satisfied pitch (60) should be preserved
      expect(engine.satisfiedPitches).toContain(60);
      // Can still complete the chord
      expect(engine.pressNote(64)).toBe('progress');
      expect(engine.pressNote(67)).toBe('completed');
    });
  });

  describe('re-pressing a satisfied chord tone', () => {
    it('returns "progress" without negative side effects', () => {
      engine.load([step([60, 64])]);
      expect(engine.pressNote(60)).toBe('progress');
      // Press 60 again — already satisfied, harmless
      expect(engine.pressNote(60)).toBe('progress');
      expect(engine.errorCount).toBe(0);
      // Still need 64 to complete
      expect(engine.pressNote(64)).toBe('completed');
    });
  });

  describe('reset', () => {
    it('allows replaying the same steps from the beginning', () => {
      engine.load([step([60], 0), step([64], 1)]);
      engine.pressNote(60);
      engine.pressNote(64);
      expect(engine.status).toBe('completed');

      engine.reset();
      expect(engine.status).toBe('playing');
      expect(engine.index).toBe(0);
      expect(engine.errorCount).toBe(0);

      expect(engine.pressNote(60)).toBe('advanced');
      expect(engine.pressNote(64)).toBe('completed');
    });
  });

  describe('after completion', () => {
    it('returns "idle" for any further notes', () => {
      engine.load([step([60])]);
      engine.pressNote(60);
      expect(engine.status).toBe('completed');
      expect(engine.pressNote(60)).toBe('idle');
      expect(engine.pressNote(72)).toBe('idle');
    });
  });

  describe('currentPitches', () => {
    it('returns expected pitches while playing', () => {
      engine.load([step([60, 64])]);
      expect(engine.currentPitches).toEqual([60, 64]);
    });

    it('returns empty array when not playing', () => {
      expect(engine.currentPitches).toEqual([]);
      engine.load([step([60])]);
      engine.pressNote(60);
      expect(engine.currentPitches).toEqual([]);
    });
  });

  describe('early presses (next step)', () => {
    it('banks a next-step pitch instead of counting it wrong', () => {
      engine.load([step([72], 0), step([48, 76], 1), step([79], 2)]);
      // Left hand C3 lands a hair before the right hand finishes C5.
      expect(engine.pressNote(48)).toBe('early');
      expect(engine.errorCount).toBe(0);
      expect(engine.pressNote(72)).toBe('advanced');
      // C3 is already counted for step 1 — no re-strike of the held key needed.
      expect(engine.satisfiedPitches).toEqual([48]);
      expect(engine.pressNote(76)).toBe('advanced');
      expect(engine.index).toBe(2);
    });

    it('chains through a step fully satisfied by banked notes', () => {
      engine.load([step([60], 0), step([48], 1), step([62], 2)]);
      expect(engine.pressNote(48)).toBe('early');
      expect(engine.pressNote(60)).toBe('advanced');
      expect(engine.index).toBe(2);
    });

    it('prefers the current step for a pitch both steps share (repeated notes)', () => {
      engine.load([step([60], 0), step([60], 1)]);
      expect(engine.pressNote(60)).toBe('advanced');
      expect(engine.pressNote(60)).toBe('completed');
    });

    it('banks a re-struck, already-satisfied tone that the next step repeats', () => {
      // Step 0 = {C3, E5}; step 1 = {C3}. C3 pressed, then pressed again early.
      engine.load([step([48, 76], 0), step([48], 1), step([79], 2)]);
      expect(engine.pressNote(48)).toBe('progress');
      expect(engine.pressNote(48)).toBe('early');
      expect(engine.pressNote(76)).toBe('advanced');
      expect(engine.index).toBe(2);
    });

    it('still counts pitches from two steps ahead as wrong', () => {
      engine.load([step([60], 0), step([62], 1), step([64], 2)]);
      expect(engine.pressNote(64)).toBe('wrong');
      expect(engine.errorCount).toBe(1);
    });
  });

  describe('tolerated pitches (other hand playing along)', () => {
    it('ignores them: no error, no progress', () => {
      engine.load([{ ...step([72], 0), tolerated: [48, 55] }, step([74], 1)]);
      expect(engine.pressNote(48)).toBe('ignored');
      expect(engine.errorCount).toBe(0);
      expect(engine.index).toBe(0);
      expect(engine.pressNote(50)).toBe('wrong');
    });

    it("doesn't let the other hand bank the next step (no silent skip)", () => {
      // Left hand plays G4 along; the right hand's NEXT note is also G4.
      engine.load([{ ...step([72], 0), tolerated: [67] }, step([67], 1), step([69], 2)]);
      expect(engine.pressNote(67)).toBe('ignored');
      expect(engine.pressNote(72)).toBe('advanced');
      expect(engine.index).toBe(1); // G4 still has to be played by the right hand
    });
  });
});
