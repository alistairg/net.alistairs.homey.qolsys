import { describe, it, expect } from 'vitest';
import {
  getCapabilitiesForZone,
  getDeviceClassForZone,
  isZoneActive,
  shouldIncludeZone,
} from '../lib/ZoneTypes';
import { ZoneSensorType, ZoneStatus } from '../lib/types';

describe('getCapabilitiesForZone', () => {
  it('maps door/window-style sensors to alarm_contact', () => {
    for (const t of [ZoneSensorType.DOOR_WINDOW, ZoneSensorType.DOOR_WINDOW_M, ZoneSensorType.TILT]) {
      expect(getCapabilitiesForZone(t)).toContain('alarm_contact');
    }
  });

  it('maps motion-style sensors to alarm_motion', () => {
    for (const t of [ZoneSensorType.MOTION, ZoneSensorType.PANEL_MOTION, ZoneSensorType.OCCUPANCY]) {
      expect(getCapabilitiesForZone(t)).toContain('alarm_motion');
    }
  });

  it('maps smoke detectors to alarm_smoke', () => {
    expect(getCapabilitiesForZone(ZoneSensorType.SMOKE_DETECTOR)).toContain('alarm_smoke');
    expect(getCapabilitiesForZone(ZoneSensorType.SMOKE_M)).toContain('alarm_smoke');
  });

  it('maps CO detector to alarm_co', () => {
    expect(getCapabilitiesForZone(ZoneSensorType.CO_DETECTOR)).toContain('alarm_co');
  });

  it('maps water sensor to alarm_water', () => {
    expect(getCapabilitiesForZone(ZoneSensorType.WATER)).toContain('alarm_water');
  });

  it('falls back to alarm_generic for unmapped sensor types', () => {
    expect(getCapabilitiesForZone('CompletelyUnknownType')).toContain('alarm_generic');
  });

  it('maps glass break to alarm_glass_break', () => {
    expect(getCapabilitiesForZone(ZoneSensorType.GLASS_BREAK)).toContain('alarm_glass_break');
    expect(getCapabilitiesForZone(ZoneSensorType.PANEL_GLASS_BREAK)).toContain('alarm_glass_break');
  });

  it('falls back to alarm_generic for unsupported types like shock and freeze', () => {
    expect(getCapabilitiesForZone(ZoneSensorType.SHOCK)).toContain('alarm_generic');
    expect(getCapabilitiesForZone(ZoneSensorType.FREEZE)).toContain('alarm_generic');
  });

  it('always includes alarm_tamper and alarm_battery alongside the primary', () => {
    const caps = getCapabilitiesForZone(ZoneSensorType.DOOR_WINDOW);
    expect(caps).toContain('alarm_tamper');
    expect(caps).toContain('alarm_battery');
  });

  it('adds measure_temperature when hasPowergTemp is true', () => {
    const caps = getCapabilitiesForZone(ZoneSensorType.MOTION, true);
    expect(caps).toContain('measure_temperature');
  });

  it('does not add measure_temperature when hasPowergTemp is omitted', () => {
    const caps = getCapabilitiesForZone(ZoneSensorType.MOTION);
    expect(caps).not.toContain('measure_temperature');
  });

  it('adds measure_luminance when hasPowergLight is true', () => {
    const caps = getCapabilitiesForZone(ZoneSensorType.MOTION, false, true);
    expect(caps).toContain('measure_luminance');
  });

  it('adds both PowerG capabilities when both flags are true', () => {
    const caps = getCapabilitiesForZone(ZoneSensorType.MOTION, true, true);
    expect(caps).toContain('measure_temperature');
    expect(caps).toContain('measure_luminance');
  });

  it('emits primary capability first (for canonical-cap conventions)', () => {
    expect(getCapabilitiesForZone(ZoneSensorType.DOOR_WINDOW)[0]).toBe('alarm_contact');
    expect(getCapabilitiesForZone(ZoneSensorType.MOTION)[0]).toBe('alarm_motion');
  });
});

describe('getDeviceClassForZone', () => {
  it('returns "sensor" for known types', () => {
    expect(getDeviceClassForZone(ZoneSensorType.DOOR_WINDOW)).toBe('sensor');
    expect(getDeviceClassForZone(ZoneSensorType.MOTION)).toBe('sensor');
    expect(getDeviceClassForZone(ZoneSensorType.WATER)).toBe('sensor');
  });

  it('falls back to "sensor" for unknown types', () => {
    expect(getDeviceClassForZone('CompletelyUnknownType')).toBe('sensor');
  });
});

describe('isZoneActive', () => {
  it('returns true for active-equivalent statuses', () => {
    for (const s of [ZoneStatus.OPEN, ZoneStatus.ACTIVE, ZoneStatus.ACTIVATED, ZoneStatus.ALARMED, ZoneStatus.OCCUPIED]) {
      expect(isZoneActive(s)).toBe(true);
    }
  });

  it('returns false for closed/idle/normal statuses', () => {
    for (const s of [ZoneStatus.CLOSED, ZoneStatus.IDLE, ZoneStatus.NORMAL, ZoneStatus.INACTIVE, ZoneStatus.VACANT]) {
      expect(isZoneActive(s)).toBe(false);
    }
  });

  it('returns false for trouble/connectivity statuses (those drive other capabilities, not the primary alarm)', () => {
    for (const s of [ZoneStatus.FAILURE, ZoneStatus.TROUBLE, ZoneStatus.UNREACHABLE, ZoneStatus.DISCONNECTED, ZoneStatus.SYNCHRONIZING]) {
      expect(isZoneActive(s)).toBe(false);
    }
  });

  it('returns false for arm-state-mirror statuses (those describe partition state, not zone activation)', () => {
    expect(isZoneActive(ZoneStatus.ARM_AWAY)).toBe(false);
    expect(isZoneActive(ZoneStatus.ARM_STAY)).toBe(false);
    expect(isZoneActive(ZoneStatus.DISARM)).toBe(false);
  });

  it('returns false for unknown strings rather than throwing', () => {
    expect(isZoneActive('totally-not-a-real-status')).toBe(false);
    expect(isZoneActive('')).toBe(false);
  });
});

describe('shouldIncludeZone', () => {
  it('excludes Keypad and Bluetooth', () => {
    expect(shouldIncludeZone(ZoneSensorType.KEYPAD)).toBe(false);
    expect(shouldIncludeZone(ZoneSensorType.BLUETOOTH)).toBe(false);
  });

  it('excludes TakeoverModule', () => {
    expect(shouldIncludeZone(ZoneSensorType.TAKEOVER_MODULE)).toBe(false);
  });

  it('includes door/window, motion, smoke, CO, water', () => {
    for (const t of [ZoneSensorType.DOOR_WINDOW, ZoneSensorType.MOTION, ZoneSensorType.SMOKE_DETECTOR, ZoneSensorType.CO_DETECTOR, ZoneSensorType.WATER]) {
      expect(shouldIncludeZone(t)).toBe(true);
    }
  });

  it('includes unknown types (better to expose than to silently drop)', () => {
    expect(shouldIncludeZone('SomeNewSensorType')).toBe(true);
  });
});
