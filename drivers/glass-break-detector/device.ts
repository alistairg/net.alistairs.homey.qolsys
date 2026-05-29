import ZoneDevice from '../../lib/ZoneDevice';

const SCHEMA_VERSION = 1;

/**
 * Glass break devices were originally paired with the system
 * `alarm_generic` capability, whose auto-generated flow cards are
 * titled "Generic alarm" — confusing for users. We now use a custom
 * `alarm_glass_break` capability so the cards read "Glass break". This
 * subclass handles the one-time migration for devices paired before
 * the rename.
 */
export default class GlassBreakDetectorDevice extends ZoneDevice {

  async onInit(): Promise<void> {
    await this.migrateGlassBreakCapability();
    await super.onInit();
  }

  private async migrateGlassBreakCapability(): Promise<void> {
    const stored = (this.getStoreValue('schema_version') as number | undefined) ?? 0;
    if (stored >= SCHEMA_VERSION) return;

    if (!this.hasCapability('alarm_glass_break')) {
      await this.addCapability('alarm_glass_break').catch((err) => this.log('Failed to add alarm_glass_break:', err));
    }
    if (this.hasCapability('alarm_generic')) {
      await this.removeCapability('alarm_generic').catch((err) => this.log('Failed to remove alarm_generic:', err));
    }
    await this.setStoreValue('schema_version', SCHEMA_VERSION);
  }

}

module.exports = GlassBreakDetectorDevice;
