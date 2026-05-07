import { describe, it, expect } from 'vitest';
import { getBatteryType } from '../lib/BatteryTypes';

describe('getBatteryType', () => {
  it('returns CR2032 for door/window-class sensors', () => {
    expect(getBatteryType('Door_Window')).toBe('CR2032');
    expect(getBatteryType('Door_Window_M')).toBe('CR2032');
    expect(getBatteryType('Tilt')).toBe('CR2032');
  });

  it('returns CR123A for motion sensors with their own battery', () => {
    expect(getBatteryType('Motion')).toBe('CR123A');
    expect(getBatteryType('Occupancy Sensor')).toBe('CR123A');
  });

  it('returns empty string for built-in panel sensors (no user-replaceable battery)', () => {
    expect(getBatteryType('Panel Motion')).toBe('');
    expect(getBatteryType('Panel Glass Break')).toBe('');
  });

  it('returns CR123A x2 for life-safety devices that take dual cells', () => {
    expect(getBatteryType('SmokeDetector')).toBe('CR123A x2');
    expect(getBatteryType('Smoke_M')).toBe('CR123A x2');
    expect(getBatteryType('CODetector')).toBe('CR123A x2');
    expect(getBatteryType('GlassBreak')).toBe('CR123A x2');
  });

  it('returns the documented siren chemistry', () => {
    expect(getBatteryType('Siren')).toBe('3V CR123A x4');
  });

  it('returns CR2032 for water/freeze/keyfob/pendant/doorbell', () => {
    expect(getBatteryType('Water')).toBe('CR2032');
    expect(getBatteryType('Freeze')).toBe('CR2032');
    expect(getBatteryType('KeyFob')).toBe('CR2032');
    expect(getBatteryType('Auxiliary Pendant')).toBe('CR2032');
    expect(getBatteryType('Doorbell')).toBe('CR2032');
  });

  it('returns empty string for unknown sensor types', () => {
    expect(getBatteryType('CompletelyNewSensor')).toBe('');
    expect(getBatteryType('')).toBe('');
  });
});
