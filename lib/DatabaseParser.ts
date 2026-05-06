import {
  QolsysPartitionData,
  QolsysZoneData,
  QolsysPanelInfo,
  PartitionSystemStatus,
  PartitionAlarmState,
  ZoneStatus,
} from './types';

// ContentProvider URI suffixes we care about. The actual panel URIs are
// of the form `content://com.qolsys.qolsyssettings/qolsyssettings` etc.
// We match by suffix so we don't depend on the specific authority prefix.
// The settings entry was previously written as `QolsysSettingsProvider`
// (without `Content` in the middle) — that happened to work as a substring
// of `QolsysSettingsContentProvider`, but a future panel firmware change
// could break it silently. Settled on the version that matches the
// reference implementation.
const URI_PARTITION = 'PartitionContentProvider/partition';
const URI_SENSOR = 'SensorContentProvider/sensor';
const URI_SETTINGS = 'QolsysSettingsContentProvider/qolsyssettings';
const URI_STATE = 'StateContentProvider/state';
const URI_POWERG = 'PowerGDeviceContentProvider/powerg_device';

interface ContentProviderEntry {
  uri: string;
  resultSet: Record<string, string>[];
}

export interface DbChangedEvent {
  eventName: string;
  dbOperation: string;
  uri: string;
  contentValues?: Record<string, string>;
  selection?: string;
  selectionArgs?: string[] | string;
}

export interface DatabaseState {
  partitions: Map<string, QolsysPartitionData>;
  zones: Map<string, QolsysZoneData>;
  shortIdToZoneId: Map<string, string>;
  panelInfo: QolsysPanelInfo;
}

/**
 * Parses the fulldbdata array from the syncdatabase response
 * into typed partition and zone objects.
 *
 * Reference: QolsysController/qolsys_controller/database/ + panel.py
 */
export class DatabaseParser {

  private settings: Map<string, Map<string, string>> = new Map(); // partition_id → {name → value}
  private states: Map<string, Map<string, string>> = new Map();   // partition_id → {name → value}

  /**
   * Parse the full database dump from syncdatabase response.
   * Returns partitions and zones keyed by their IDs.
   */
  parseFullDatabase(fulldbdata: ContentProviderEntry[]): DatabaseState {
    this.settings.clear();
    this.states.clear();

    const rawPartitions: Record<string, string>[] = [];
    const rawZones: Record<string, string>[] = [];

    // First pass: load all tables
    for (const entry of fulldbdata) {
      if (entry.uri.includes(URI_SETTINGS)) {
        for (const row of entry.resultSet) {
          const partId = row.partition_id ?? '_global';
          if (!this.settings.has(partId)) {
            this.settings.set(partId, new Map());
          }
          this.settings.get(partId)!.set(row.name, row.value);
        }
      } else if (entry.uri.includes(URI_STATE)) {
        for (const row of entry.resultSet) {
          const partId = row.partition_id ?? '_global';
          if (!this.states.has(partId)) {
            this.states.set(partId, new Map());
          }
          this.states.get(partId)!.set(row.name, row.value);
        }
      } else if (entry.uri.includes(URI_PARTITION)) {
        rawPartitions.push(...entry.resultSet);
      } else if (entry.uri.includes(URI_SENSOR)) {
        rawZones.push(...entry.resultSet);
      }
    }

    // Build partitions
    const partitions = new Map<string, QolsysPartitionData>();
    for (const raw of rawPartitions) {
      const partId = raw.partition_id;
      const partSettings = this.settings.get(partId);
      const partState = this.states.get(partId);

      const partition: QolsysPartitionData = {
        partitionId: partId,
        name: raw.name || `Partition ${partId}`,
        systemStatus: this.toPartitionStatus(partSettings?.get('SYSTEM_STATUS')),
        alarmState: this.toAlarmState(partState?.get('ALARM_STATE')),
        alarmTypes: [],
        exitSounds: partSettings?.get('EXIT_SOUNDS') || '',
        entryDelays: partSettings?.get('ENTRY_DELAYS') || '',
      };

      partitions.set(partId, partition);
    }

    // Build zones + shortID reverse lookup
    const zones = new Map<string, QolsysZoneData>();
    const shortIdToZoneId = new Map<string, string>();
    for (const raw of rawZones) {
      const zone: QolsysZoneData = {
        zoneId: raw.zoneid,
        shortID: raw.shortID || '',
        sensorName: raw.sensorname || `Zone ${raw.zoneid}`,
        sensorType: raw.sensortype || 'Unknown',
        sensorStatus: (raw.sensorstatus as ZoneStatus) || ZoneStatus.CLOSED,
        sensorGroup: raw.sensorgroup || '',
        partitionId: raw.partition_id || '0',
        batteryStatus: raw.battery_status || '',
        acStatus: raw.ac_status || '',
        latestdBm: raw.latestdBm || '',
        averagedBm: raw.averagedBm || '',
        currentCapability: raw.current_capability || '',
      };

      zones.set(zone.zoneId, zone);
      if (zone.shortID) {
        shortIdToZoneId.set(zone.shortID, zone.zoneId);
      }
    }

    // Extract panel info from global settings
    const globalSettings = this.settings.get('_global') ?? new Map();
    const panelInfo: QolsysPanelInfo = {
      imei: '',
      productType: '',
      hardwareVersion: globalSettings.get('HARDWARE_VERSION') || '',
      androidVersion: globalSettings.get('ANDROID_VERSION') || '',
      acStatus: globalSettings.get('AC_STATUS') || '',
      tamperState: globalSettings.get('TAMPER_STATE') || '',
      batteryStatus: globalSettings.get('BATTERY_STATUS') || '',
    };

    return { partitions, zones, shortIdToZoneId, panelInfo };
  }

  /**
   * Apply a dbChanged event from iq2meid to the existing state.
   * Returns which entity was updated (if any) so callers can emit events.
   */
  applyDbChange(
    event: DbChangedEvent,
    state: DatabaseState,
  ): { type: 'zone'; zoneId: string } | { type: 'partition'; partitionId: string } | null {
    if (event.eventName !== 'dbChanged') return null;

    const { uri, dbOperation, contentValues } = event;

    // selectionArgs comes as a string like "[44]" or "[44, 0]" from the panel
    let selectionArgs: string[] | undefined;
    if (typeof event.selectionArgs === 'string') {
      selectionArgs = event.selectionArgs.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim());
    } else {
      selectionArgs = event.selectionArgs;
    }

    if (dbOperation === 'update' && contentValues) {
      // Zone update
      if (uri.includes(URI_SENSOR) && selectionArgs?.length) {
        const zoneId = selectionArgs[0];
        const zone = state.zones.get(zoneId);
        if (zone) {
          if (contentValues.sensorstatus !== undefined) {
            zone.sensorStatus = contentValues.sensorstatus as ZoneStatus;
          }
          if (contentValues.sensorname !== undefined) {
            zone.sensorName = contentValues.sensorname;
          }
          if (contentValues.battery_status !== undefined) {
            zone.batteryStatus = contentValues.battery_status;
          }
          if (contentValues.ac_status !== undefined) {
            zone.acStatus = contentValues.ac_status;
          }
          if (contentValues.latestdBm !== undefined) {
            zone.latestdBm = contentValues.latestdBm;
          }
          if (contentValues.averagedBm !== undefined) {
            zone.averagedBm = contentValues.averagedBm;
          }
          return { type: 'zone', zoneId };
        }
      }

      // Settings update (partition system status, exit sounds, etc.)
      if (uri.includes(URI_SETTINGS) && contentValues.name && contentValues.value) {
        const partitionId = contentValues.partition_id;
        if (partitionId !== undefined) {
          const partition = state.partitions.get(partitionId);
          if (partition) {
            if (contentValues.name === 'SYSTEM_STATUS') {
              partition.systemStatus = this.toPartitionStatus(contentValues.value);
              return { type: 'partition', partitionId };
            }
            if (contentValues.name === 'EXIT_SOUNDS') {
              partition.exitSounds = contentValues.value;
              return { type: 'partition', partitionId };
            }
            if (contentValues.name === 'ENTRY_DELAYS') {
              partition.entryDelays = contentValues.value;
              return { type: 'partition', partitionId };
            }
          }
        }
      }

      // State update (alarm state)
      if (uri.includes(URI_STATE) && contentValues.name && contentValues.value) {
        const partitionId = contentValues.partition_id;
        if (partitionId !== undefined) {
          const partition = state.partitions.get(partitionId);
          if (partition && contentValues.name === 'ALARM_STATE') {
            partition.alarmState = this.toAlarmState(contentValues.value);
            return { type: 'partition', partitionId };
          }
        }
      }

      // PowerG device update (temperature, light)
      if (uri.includes(URI_POWERG) && selectionArgs?.length) {
        const shortID = selectionArgs[0];
        const zoneId = state.shortIdToZoneId.get(shortID);
        if (zoneId) {
          const zone = state.zones.get(zoneId);
          if (zone) {
            let changed = false;
            if (contentValues.temperature !== undefined) {
              zone.powergTemperature = parseFloat(contentValues.temperature);
              changed = true;
            }
            if (contentValues.light !== undefined) {
              zone.powergLight = parseInt(contentValues.light, 10);
              changed = true;
            }
            if (changed) {
              return { type: 'zone', zoneId };
            }
          }
        }
      }
    }

    return null;
  }

  private toPartitionStatus(value: string | undefined): PartitionSystemStatus {
    if (!value) return PartitionSystemStatus.UNKNOWN;
    // Map raw string values to enum (values may come with or without hyphens)
    const normalized = value.toUpperCase().replace(/_/g, '-');
    return (Object.values(PartitionSystemStatus) as string[]).includes(normalized)
      ? (normalized as PartitionSystemStatus)
      : PartitionSystemStatus.UNKNOWN;
  }

  private toAlarmState(value: string | undefined): PartitionAlarmState {
    if (!value) return PartitionAlarmState.UNKNOWN;
    return (Object.values(PartitionAlarmState) as string[]).includes(value)
      ? (value as PartitionAlarmState)
      : PartitionAlarmState.UNKNOWN;
  }

}
