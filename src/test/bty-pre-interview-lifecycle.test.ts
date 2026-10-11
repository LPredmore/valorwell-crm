import { describe, it, expect } from 'vitest';
import { allowedBtySourceStatuses, requireBtySourceTransition } from '@/domain/pipelines/bty-source-transitions';
import { allowedOpportunityTransitions, opportunityStatuses, opportunityStatusLabel } from '@/domain/relationships/opportunity-workflow';
import { classifyBtyCalendarEvent } from '../../supabase/functions/_shared/relationship-calendar-classification';

describe('BTY pre-interview lifecycle', () => {
  it('orders the two pre-interview stages between Interested and Recording Planned', () => {
    const i = opportunityStatuses.indexOf('interested');
    expect(opportunityStatuses.slice(i, i + 4)).toEqual(['interested', 'pre_interview_scheduled', 'pre_interview_completed', 'recording_planned']);
    expect(new Set(opportunityStatuses).size).toBe(opportunityStatuses.length);
    expect(opportunityStatusLabel('pre_interview_scheduled')).toBe('Pre-Interview Scheduled');
    expect(opportunityStatusLabel('pre_interview_completed')).toBe('Pre-Interview Completed');
  });
  it('follows interested -> scheduled -> completed -> recording planned -> booked -> completed', () => {
    expect(allowedOpportunityTransitions('interested')).toContain('pre_interview_scheduled');
    expect(allowedOpportunityTransitions('pre_interview_scheduled')).toContain('pre_interview_completed');
    expect(allowedOpportunityTransitions('pre_interview_completed')).toContain('recording_planned');
    expect(allowedOpportunityTransitions('recording_planned')).toContain('booked');
    expect(allowedOpportunityTransitions('booked')).toContain('completed');
  });
  it('allows skipping straight to a booked recording, cancelling back to interested, and nurture', () => {
    expect(allowedOpportunityTransitions('pre_interview_scheduled')).toEqual(expect.arrayContaining(['booked', 'interested', 'nurture', 'declined']));
    expect(allowedOpportunityTransitions('interested')).toContain('booked');
  });
  it('never lets a pre-interview jump to a completed recording or be completed without being scheduled', () => {
    expect(allowedOpportunityTransitions('pre_interview_scheduled')).not.toContain('completed');
    expect(allowedOpportunityTransitions('pre_interview_completed')).not.toContain('completed');
    expect(allowedOpportunityTransitions('interested')).not.toContain('pre_interview_completed');
  });
  it('connected board mirrors the server graph and requires an audit reason to mark completion', () => {
    expect(allowedBtySourceStatuses('pre_interview_scheduled')).toEqual(allowedOpportunityTransitions('pre_interview_scheduled'));
    expect(allowedBtySourceStatuses('pre_interview_completed')).toEqual(allowedOpportunityTransitions('pre_interview_completed'));
    expect(() => requireBtySourceTransition('pre_interview_scheduled', 'pre_interview_completed', '', 2)).toThrow(/reason/);
    expect(() => requireBtySourceTransition('pre_interview_scheduled', 'pre_interview_completed', 'Intro call actually held with guest', 2)).not.toThrow();
  });
});

describe('BTY calendar classification', () => {
  it('classifies explicit BTY intro events as pre-interviews even with the StreamYard room', () => {
    expect(classifyBtyCalendarEvent({
      streamyardPresent: true,
      summary: 'Beyond The Yellow - FOCUS Marines Foundation',
      description: 'Introductory call / initial discussion. This is NOT the final recorded episode. https://streamyard.com/frr4zf8e3s',
    })).toBe('bty_preinterview');
    expect(classifyBtyCalendarEvent({ streamyardPresent: true, summary: 'BTY Pre-Interview: The Boot' })).toBe('bty_preinterview');
  });
  it('keeps BTY full recordings on StreamYard as recordings', () => {
    expect(classifyBtyCalendarEvent({
      streamyardPresent: true,
      summary: 'Beyond The Yellow Recording - Operation Hat Trick',
      description: 'Join the StreamYard studio 10 minutes early.',
    })).toBe('bty_recording');
  });
  it('treats non-BTY StreamYard events as recordings (existing fallback), never pre-interviews', () => {
    expect(classifyBtyCalendarEvent({ streamyardPresent: true, summary: 'Intro to new studio' })).toBe('bty_recording');
  });
  it('never classifies generic non-BTY intro meetings', () => {
    expect(classifyBtyCalendarEvent({ streamyardPresent: false, summary: 'Intro call with vendor' })).toBeNull();
    expect(classifyBtyCalendarEvent({ streamyardPresent: false, summary: 'Staff sync' })).toBeNull();
  });
  it('classifies BTY intro without StreamYard as pre-interview', () => {
    expect(classifyBtyCalendarEvent({ streamyardPresent: false, summary: 'BTY Introductory Call - FOCUS Marines' })).toBe('bty_preinterview');
  });
});
