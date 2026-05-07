import { describe, it, expect } from 'vitest';
import {
  ContactSensorTypes,
  MotionSensorTypes,
  SmokeDetectorTypes,
  CODetectorTypes,
  WaterSensorTypes,
  isGenericSensorType,
} from '../lib/ZoneTypes';
import { ZoneSensorType } from '../lib/types';

/**
 * These tests pin down which Qolsys sensor types each per-driver
 * filter claims. Each driver's `claimsZoneType` is a thin wrapper
 * around the corresponding constant list (or `isGenericSensorType`),
 * so testing the constants exercises the filter logic.
 *
 * The contract this test enforces: every sensor type Homey will
 * surface as a device is claimed by exactly one driver. No type
 * claimed by zero drivers (silent drop) and no type claimed by two
 * drivers (duplicate listings during pairing).
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
});

describe('generic-sensor type filter', () => {
  it('claims types not handled by any specific driver', () => {
    // Spot-check a representative cross-section of types that fall
    // through to the catch-all driver.
    for (const t of [
      ZoneSensorType.GLASS_BREAK,
      ZoneSensorType.PANEL_GLASS_BREAK,
      ZoneSensorType.FREEZE,
      ZoneSensorType.HEAT,
      ZoneSensorType.HIGH_TEMPERATURE,
      ZoneSensorType.SHOCK,
      ZoneSensorType.DOORBELL,
      ZoneSensorType.AUXILIARY_PENDANT,
      ZoneSensorType.KEY_FOB,
      ZoneSensorType.SIREN,
      ZoneSensorType.TAMPER,
      ZoneSensorType.TEMPERATURE,
      ZoneSensorType.TRANSLATOR,
    ]) {
      expect(isGenericSensorType(t)).toBe(true);
    }
  });

  it('does not claim types that have a specific driver', () => {
    for (const t of [
      ZoneSensorType.DOOR_WINDOW,
      ZoneSensorType.MOTION,
      ZoneSensorType.SMOKE_DETECTOR,
      ZoneSensorType.CO_DETECTOR,
      ZoneSensorType.WATER,
    ]) {
      expect(isGenericSensorType(t)).toBe(false);
    }
  });

  it('does not claim excluded types (keypad/bluetooth/takeover-module)', () => {
    expect(isGenericSensorType(ZoneSensorType.KEYPAD)).toBe(false);
    expect(isGenericSensorType(ZoneSensorType.BLUETOOTH)).toBe(false);
    expect(isGenericSensorType(ZoneSensorType.TAKEOVER_MODULE)).toBe(false);
  });

  it('claims completely unknown types (forward-compatibility for new sensors)', () => {
    expect(isGenericSensorType('SomeNewSensorTypeQolsysAddedNextYear')).toBe(true);
  });
});

describe('partition invariant: no type claimed by two drivers', () => {
  // The pair flow assumes each zone shows up under exactly one driver.
  // A type claimed by two drivers would surface as duplicate entries
  // during pairing.
  const allSpecificTypes = [
    ...ContactSensorTypes,
    ...MotionSensorTypes,
    ...SmokeDetectorTypes,
    ...CODetectorTypes,
    ...WaterSensorTypes,
  ];

  it('specific drivers do not overlap with each other', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const t of allSpecificTypes) {
      if (seen.has(t)) dupes.push(t);
      seen.add(t);
    }
    expect(dupes).toEqual([]);
  });

  it('no specific-driver type also leaks into the generic catch-all', () => {
    for (const t of allSpecificTypes) {
      expect(isGenericSensorType(t)).toBe(false);
    }
  });
});
