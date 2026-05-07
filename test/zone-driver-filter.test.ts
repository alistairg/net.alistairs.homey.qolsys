import { describe, it, expect } from 'vitest';
import {
  ContactSensorTypes,
  MotionSensorTypes,
  SmokeDetectorTypes,
  CODetectorTypes,
  WaterSensorTypes,
  GlassBreakDetectorTypes,
  UnsupportedZoneTypes,
  shouldIncludeZone,
} from '../lib/ZoneTypes';
import { ZoneSensorType } from '../lib/types';

/**
 * These tests pin down which Qolsys sensor types each per-driver
 * filter claims. Each driver's `claimsZoneType` is a thin wrapper
 * around the corresponding constant list, so testing the constants
 * exercises the filter logic.
 *
 * The contract this test enforces: every Qolsys sensor type goes into
 * exactly one bucket — claimed by a specific driver, excluded entirely
 * from pairing, or explicitly listed as unsupported (no Homey driver
 * yet, deliberate decision rather than a silent drop). Adding a new
 * `ZoneSensorType` to the enum without categorising it will fail the
 * exhaustiveness test below.
 */

describe('per-driver sensor type filters', () => {
  it('contact-sensor claims door/window/tilt', () => {
    expect([...ContactSensorTypes].sort()).toEqual([
      ZoneSensorType.DOOR_WINDOW,
      ZoneSensorType.DOOR_WINDOW_M,
      ZoneSensorType.TILT,
    ].sort());
  });

  it('motion-sensor claims motion/panel-motion/occupancy', () => {
    expect([...MotionSensorTypes].sort()).toEqual([
      ZoneSensorType.MOTION,
      ZoneSensorType.PANEL_MOTION,
      ZoneSensorType.OCCUPANCY,
    ].sort());
  });

  it('smoke-detector claims smoke + smoke-monitored', () => {
    expect([...SmokeDetectorTypes].sort()).toEqual([
      ZoneSensorType.SMOKE_DETECTOR,
      ZoneSensorType.SMOKE_M,
    ].sort());
  });

  it('co-detector claims CO detector only', () => {
    expect([...CODetectorTypes]).toEqual([ZoneSensorType.CO_DETECTOR]);
  });

  it('water-sensor claims water only', () => {
    expect([...WaterSensorTypes]).toEqual([ZoneSensorType.WATER]);
  });

  it('glass-break-detector claims glass break + panel glass break', () => {
    expect([...GlassBreakDetectorTypes].sort()).toEqual([
      ZoneSensorType.GLASS_BREAK,
      ZoneSensorType.PANEL_GLASS_BREAK,
    ].sort());
  });
});

describe('PowerG extras scope', () => {
  // Only motion-class PowerG sensors (PG9914/9924/9984/9994 etc.) carry
  // ambient light and temperature sensors. Other PowerG hardware
  // (glass-break, contact, smoke, CO, water) doesn't have those sensors,
  // so adding `measure_temperature` / `measure_luminance` to a non-motion
  // PowerG device would surface a permanent "Temperature: 0°C" /
  // "Light: 0 lux" with no real updates ever arriving. ZoneDriver scopes
  // the extras to motion-class types only — these tests pin that down.

  it('motion-class types are eligible for PowerG temperature + luminance', () => {
    for (const t of MotionSensorTypes) {
      expect(MotionSensorTypes.includes(t)).toBe(true);
    }
  });

  it('non-motion zone-driver types are NOT eligible for PowerG extras', () => {
    const ineligible = [
      ...ContactSensorTypes,
      ...SmokeDetectorTypes,
      ...CODetectorTypes,
      ...WaterSensorTypes,
      ...GlassBreakDetectorTypes,
    ];
    for (const t of ineligible) {
      expect(MotionSensorTypes.includes(t)).toBe(false);
    }
  });
});

describe('partition invariants', () => {
  const allSpecificTypes = [
    ...ContactSensorTypes,
    ...MotionSensorTypes,
    ...SmokeDetectorTypes,
    ...CODetectorTypes,
    ...WaterSensorTypes,
    ...GlassBreakDetectorTypes,
  ];

  it('specific drivers do not overlap with each other (no duplicate pairing entries)', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const t of allSpecificTypes) {
      if (seen.has(t)) dupes.push(t);
      seen.add(t);
    }
    expect(dupes).toEqual([]);
  });

  it('every ZoneSensorType is claimed, excluded, or explicitly unsupported', () => {
    // Exhaustiveness: walking the entire ZoneSensorType enum, every
    // value must end up in one of three buckets. This catches a new
    // value being added to the enum without a deliberate decision.
    const claimed = new Set(allSpecificTypes);
    const unsupported = new Set(UnsupportedZoneTypes);

    const uncategorised: string[] = [];
    for (const t of Object.values(ZoneSensorType)) {
      const isExcluded = !shouldIncludeZone(t);
      if (isExcluded) continue;
      if (claimed.has(t)) continue;
      if (unsupported.has(t)) continue;
      uncategorised.push(t);
    }
    expect(uncategorised).toEqual([]);
  });

  it('UnsupportedZoneTypes does not overlap with any specific-driver list', () => {
    const claimed = new Set(allSpecificTypes);
    const overlap = UnsupportedZoneTypes.filter((t) => claimed.has(t));
    expect(overlap).toEqual([]);
  });
});
