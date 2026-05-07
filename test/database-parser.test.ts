import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseParser, DatabaseState, DbChangedEvent } from '../lib/DatabaseParser';
import {
  PartitionSystemStatus,
  PartitionAlarmState,
  ZoneStatus,
} from '../lib/types';

const URI_PARTITION = 'content://com.qolsys.qolsyssettings/PartitionContentProvider/partition';
const URI_SENSOR = 'content://com.qolsys.qolsyssettings/SensorContentProvider/sensor';
const URI_SETTINGS = 'content://com.qolsys.qolsyssettings/QolsysSettingsContentProvider/qolsyssettings';
const URI_STATE = 'content://com.qolsys.qolsyssettings/StateContentProvider/state';
const URI_POWERG = 'content://com.qolsys.qolsyssettings/PowerGDeviceContentProvider/powerg_device';

function fixtureFullDb() {
  return [
    {
      uri: URI_PARTITION,
      resultSet: [
        { partition_id: '0', name: 'Main' },
        { partition_id: '1', name: 'Garage' },
      ],
    },
    {
      uri: URI_SENSOR,
      resultSet: [
        {
          zoneid: '44',
          shortID: '101',
          sensorname: 'Front Door',
          sensortype: 'Door_Window',
          sensorstatus: 'Closed',
          sensorgroup: '10',
          partition_id: '0',
          battery_status: 'Normal',
          ac_status: '',
          latestdBm: '-65',
          averagedBm: '-67',
          current_capability: '',
        },
        {
          zoneid: '45',
          shortID: '102',
          sensorname: 'Living Room Motion',
          sensortype: 'Motion',
          sensorstatus: 'Idle',
          sensorgroup: '15',
          partition_id: '0',
          battery_status: 'Low',
          ac_status: '',
          latestdBm: '-70',
          averagedBm: '-71',
          current_capability: '',
        },
        {
          zoneid: '46',
          // Empty shortID — should NOT appear in shortIdToZoneId
          shortID: '',
          sensorname: 'Smoke Hallway',
          sensortype: 'SmokeDetector',
          sensorstatus: 'Closed',
          sensorgroup: '26',
          partition_id: '0',
          battery_status: 'Normal',
          ac_status: '',
          latestdBm: '-80',
          averagedBm: '-80',
          current_capability: '',
        },
      ],
    },
    {
      uri: URI_SETTINGS,
      resultSet: [
        // Per-partition settings
        { partition_id: '0', name: 'SYSTEM_STATUS', value: 'DISARM' },
        { partition_id: '0', name: 'EXIT_SOUNDS', value: 'ON' },
        { partition_id: '0', name: 'ENTRY_DELAYS', value: '30' },
        { partition_id: '1', name: 'SYSTEM_STATUS', value: 'ARM-AWAY' },
        // Global settings (no partition_id)
        { name: 'HARDWARE_VERSION', value: 'IQ4' },
        { name: 'ANDROID_VERSION', value: '11' },
        { name: 'AC_STATUS', value: 'Normal' },
        { name: 'TAMPER_STATE', value: 'Normal' },
        { name: 'BATTERY_STATUS', value: 'Normal' },
      ],
    },
    {
      uri: URI_STATE,
      resultSet: [
        { partition_id: '0', name: 'ALARM_STATE', value: 'None' },
        { partition_id: '1', name: 'ALARM_STATE', value: 'Delay' },
      ],
    },
  ];
}

describe('DatabaseParser.parseFullDatabase', () => {
  it('parses partitions with name + system status + alarm state + delays', () => {
    const parser = new DatabaseParser();
    const state = parser.parseFullDatabase(fixtureFullDb());

    expect(state.partitions.size).toBe(2);

    const main = state.partitions.get('0')!;
    expect(main).toBeDefined();
    expect(main.name).toBe('Main');
    expect(main.systemStatus).toBe(PartitionSystemStatus.DISARM);
    expect(main.alarmState).toBe(PartitionAlarmState.NONE);
    expect(main.exitSounds).toBe('ON');
    expect(main.entryDelays).toBe('30');

    const garage = state.partitions.get('1')!;
    expect(garage.name).toBe('Garage');
    expect(garage.systemStatus).toBe(PartitionSystemStatus.ARM_AWAY);
    expect(garage.alarmState).toBe(PartitionAlarmState.DELAY);
  });

  it('falls back to "Partition {id}" when partition name is missing', () => {
    const parser = new DatabaseParser();
    const state = parser.parseFullDatabase([
      { uri: URI_PARTITION, resultSet: [{ partition_id: '5', name: '' }] },
    ]);
    expect(state.partitions.get('5')!.name).toBe('Partition 5');
  });

  it('parses zones with all relevant fields', () => {
    const parser = new DatabaseParser();
    const state = parser.parseFullDatabase(fixtureFullDb());

    expect(state.zones.size).toBe(3);

    const front = state.zones.get('44')!;
    expect(front.zoneId).toBe('44');
    expect(front.shortID).toBe('101');
    expect(front.sensorName).toBe('Front Door');
    expect(front.sensorType).toBe('Door_Window');
    expect(front.sensorStatus).toBe(ZoneStatus.CLOSED);
    expect(front.partitionId).toBe('0');
    expect(front.batteryStatus).toBe('Normal');
    expect(front.latestdBm).toBe('-65');
    expect(front.averagedBm).toBe('-67');
  });

  it('falls back to "Zone {id}" when sensor name is missing', () => {
    const parser = new DatabaseParser();
    const state = parser.parseFullDatabase([
      {
        uri: URI_SENSOR,
        resultSet: [
          { zoneid: '99', shortID: '', sensorname: '', sensortype: 'Door_Window', sensorstatus: 'Closed', partition_id: '0' },
        ],
      },
    ]);
    expect(state.zones.get('99')!.sensorName).toBe('Zone 99');
  });

  it('builds shortID → zoneId reverse lookup, skipping zones with empty shortID', () => {
    const parser = new DatabaseParser();
    const state = parser.parseFullDatabase(fixtureFullDb());

    expect(state.shortIdToZoneId.get('101')).toBe('44');
    expect(state.shortIdToZoneId.get('102')).toBe('45');
    // Zone 46 has empty shortID — should not appear here
    expect([...state.shortIdToZoneId.values()]).not.toContain('46');
    expect(state.shortIdToZoneId.size).toBe(2);
  });

  it('extracts global panel info from settings without partition_id', () => {
    const parser = new DatabaseParser();
    const state = parser.parseFullDatabase(fixtureFullDb());

    expect(state.panelInfo.hardwareVersion).toBe('IQ4');
    expect(state.panelInfo.androidVersion).toBe('11');
    expect(state.panelInfo.acStatus).toBe('Normal');
    expect(state.panelInfo.tamperState).toBe('Normal');
    expect(state.panelInfo.batteryStatus).toBe('Normal');
  });

  it('returns empty maps for empty fulldbdata', () => {
    const parser = new DatabaseParser();
    const state = parser.parseFullDatabase([]);
    expect(state.partitions.size).toBe(0);
    expect(state.zones.size).toBe(0);
    expect(state.shortIdToZoneId.size).toBe(0);
  });

  it('returns UNKNOWN partition system status when missing or unrecognised', () => {
    const parser = new DatabaseParser();
    const state = parser.parseFullDatabase([
      { uri: URI_PARTITION, resultSet: [{ partition_id: '0', name: 'Main' }] },
    ]);
    expect(state.partitions.get('0')!.systemStatus).toBe(PartitionSystemStatus.UNKNOWN);
  });

  it('handles SYSTEM_STATUS values with underscores instead of hyphens (the Qolsys API has been seen using both)', () => {
    const parser = new DatabaseParser();
    const state = parser.parseFullDatabase([
      { uri: URI_PARTITION, resultSet: [{ partition_id: '0', name: 'Main' }] },
      { uri: URI_SETTINGS, resultSet: [{ partition_id: '0', name: 'SYSTEM_STATUS', value: 'ARM_AWAY' }] },
    ]);
    expect(state.partitions.get('0')!.systemStatus).toBe(PartitionSystemStatus.ARM_AWAY);
  });

  it('returns UNKNOWN alarm state for unrecognised values', () => {
    const parser = new DatabaseParser();
    const state = parser.parseFullDatabase([
      { uri: URI_PARTITION, resultSet: [{ partition_id: '0', name: 'Main' }] },
      { uri: URI_STATE, resultSet: [{ partition_id: '0', name: 'ALARM_STATE', value: 'BogusValue' }] },
    ]);
    expect(state.partitions.get('0')!.alarmState).toBe(PartitionAlarmState.UNKNOWN);
  });

  it('clears internal settings/state caches between two consecutive calls (stale data must not leak in)', () => {
    const parser = new DatabaseParser();
    parser.parseFullDatabase([
      { uri: URI_PARTITION, resultSet: [{ partition_id: '0', name: 'A' }] },
      { uri: URI_SETTINGS, resultSet: [{ partition_id: '0', name: 'EXIT_SOUNDS', value: 'ON' }] },
    ]);
    // Second call has no EXIT_SOUNDS at all — partition should not retain ON
    const state = parser.parseFullDatabase([
      { uri: URI_PARTITION, resultSet: [{ partition_id: '0', name: 'A' }] },
    ]);
    expect(state.partitions.get('0')!.exitSounds).toBe('');
  });
});

describe('DatabaseParser.applyDbChange', () => {
  let parser: DatabaseParser;
  let state: DatabaseState;

  beforeEach(() => {
    parser = new DatabaseParser();
    state = parser.parseFullDatabase(fixtureFullDb());
  });

  function dbChange(overrides: Partial<DbChangedEvent> = {}): DbChangedEvent {
    return {
      eventName: 'dbChanged',
      dbOperation: 'update',
      uri: URI_SENSOR,
      contentValues: {},
      selectionArgs: ['44'],
      ...overrides,
    };
  }

  it('returns null for non-dbChanged events', () => {
    expect(parser.applyDbChange({ eventName: 'somethingElse' } as DbChangedEvent, state)).toBeNull();
  });

  it('returns null for unrecognised URIs', () => {
    expect(
      parser.applyDbChange(
        dbChange({ uri: 'content://something/Else/foo', contentValues: { sensorstatus: 'Open' } }),
        state,
      ),
    ).toBeNull();
  });

  it('updates a zone sensorstatus and returns a zone change descriptor', () => {
    const result = parser.applyDbChange(
      dbChange({ contentValues: { sensorstatus: 'Open' } }),
      state,
    );
    expect(result).toEqual({ type: 'zone', zoneId: '44' });
    expect(state.zones.get('44')!.sensorStatus).toBe(ZoneStatus.OPEN);
  });

  it('updates a zone sensor name', () => {
    parser.applyDbChange(
      dbChange({ contentValues: { sensorname: 'Front Door (Renamed)' } }),
      state,
    );
    expect(state.zones.get('44')!.sensorName).toBe('Front Door (Renamed)');
  });

  it('updates a zone battery_status', () => {
    parser.applyDbChange(
      dbChange({ contentValues: { battery_status: 'Low' } }),
      state,
    );
    expect(state.zones.get('44')!.batteryStatus).toBe('Low');
  });

  it('updates zone signal-strength fields (latestdBm, averagedBm)', () => {
    parser.applyDbChange(
      dbChange({ contentValues: { latestdBm: '-72', averagedBm: '-74' } }),
      state,
    );
    expect(state.zones.get('44')!.latestdBm).toBe('-72');
    expect(state.zones.get('44')!.averagedBm).toBe('-74');
  });

  it('parses selectionArgs from the panel-formatted string `[44]`', () => {
    const result = parser.applyDbChange(
      dbChange({ selectionArgs: '[44]', contentValues: { sensorstatus: 'Open' } }),
      state,
    );
    expect(result).toEqual({ type: 'zone', zoneId: '44' });
  });

  it('parses comma-separated panel-formatted selectionArgs `[44, 0]`', () => {
    const result = parser.applyDbChange(
      dbChange({ selectionArgs: '[44, 0]', contentValues: { sensorstatus: 'Open' } }),
      state,
    );
    expect(result).toEqual({ type: 'zone', zoneId: '44' });
  });

  it('returns null when zone update targets a zone that does not exist', () => {
    expect(
      parser.applyDbChange(
        dbChange({ selectionArgs: ['9999'], contentValues: { sensorstatus: 'Open' } }),
        state,
      ),
    ).toBeNull();
  });

  it('updates a partition SYSTEM_STATUS via settings URI', () => {
    const result = parser.applyDbChange(
      dbChange({
        uri: URI_SETTINGS,
        contentValues: { partition_id: '0', name: 'SYSTEM_STATUS', value: 'ARM-AWAY' },
        selectionArgs: undefined,
      }),
      state,
    );
    expect(result).toEqual({ type: 'partition', partitionId: '0' });
    expect(state.partitions.get('0')!.systemStatus).toBe(PartitionSystemStatus.ARM_AWAY);
  });

  it('updates EXIT_SOUNDS and ENTRY_DELAYS via settings URI', () => {
    parser.applyDbChange(
      dbChange({
        uri: URI_SETTINGS,
        contentValues: { partition_id: '0', name: 'EXIT_SOUNDS', value: 'OFF' },
        selectionArgs: undefined,
      }),
      state,
    );
    expect(state.partitions.get('0')!.exitSounds).toBe('OFF');

    parser.applyDbChange(
      dbChange({
        uri: URI_SETTINGS,
        contentValues: { partition_id: '0', name: 'ENTRY_DELAYS', value: '60' },
        selectionArgs: undefined,
      }),
      state,
    );
    expect(state.partitions.get('0')!.entryDelays).toBe('60');
  });

  it('updates partition ALARM_STATE via state URI', () => {
    const result = parser.applyDbChange(
      dbChange({
        uri: URI_STATE,
        contentValues: { partition_id: '0', name: 'ALARM_STATE', value: 'Alarm' },
        selectionArgs: undefined,
      }),
      state,
    );
    expect(result).toEqual({ type: 'partition', partitionId: '0' });
    expect(state.partitions.get('0')!.alarmState).toBe(PartitionAlarmState.ALARM);
  });

  it('ignores settings updates targeting unknown partitions', () => {
    expect(
      parser.applyDbChange(
        dbChange({
          uri: URI_SETTINGS,
          contentValues: { partition_id: '99', name: 'SYSTEM_STATUS', value: 'ARM-AWAY' },
          selectionArgs: undefined,
        }),
        state,
      ),
    ).toBeNull();
  });

  it('ignores settings updates with unknown setting names (e.g. ones we do not surface)', () => {
    expect(
      parser.applyDbChange(
        dbChange({
          uri: URI_SETTINGS,
          contentValues: { partition_id: '0', name: 'SOME_OTHER_KEY', value: 'whatever' },
          selectionArgs: undefined,
        }),
        state,
      ),
    ).toBeNull();
  });

  it('updates PowerG temperature via shortID lookup', () => {
    const result = parser.applyDbChange(
      dbChange({
        uri: URI_POWERG,
        selectionArgs: ['101'], // shortID for zone 44
        contentValues: { temperature: '21.5' },
      }),
      state,
    );
    expect(result).toEqual({ type: 'zone', zoneId: '44' });
    expect(state.zones.get('44')!.powergTemperature).toBe(21.5);
  });

  it('updates PowerG light value via shortID lookup', () => {
    parser.applyDbChange(
      dbChange({
        uri: URI_POWERG,
        selectionArgs: ['102'], // shortID for zone 45
        contentValues: { light: '450' },
      }),
      state,
    );
    expect(state.zones.get('45')!.powergLight).toBe(450);
  });

  it('returns null when PowerG update targets a shortID we do not know about', () => {
    expect(
      parser.applyDbChange(
        dbChange({
          uri: URI_POWERG,
          selectionArgs: ['9999'],
          contentValues: { temperature: '22.0' },
        }),
        state,
      ),
    ).toBeNull();
  });

  it('returns null when PowerG payload is empty (nothing actually changed)', () => {
    expect(
      parser.applyDbChange(
        dbChange({
          uri: URI_POWERG,
          selectionArgs: ['101'],
          contentValues: {},
        }),
        state,
      ),
    ).toBeNull();
  });
});
