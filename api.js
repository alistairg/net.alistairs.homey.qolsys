'use strict';

/**
 * Homey app API — endpoints for the settings page.
 *
 * The settings page (`/settings/index.html`) calls these via:
 *   Homey.api('GET', '/backup', cb)
 *   Homey.api('POST', '/restore', { json }, cb)
 */

module.exports = {
  /**
   * GET /backup — returns the PKI bundle + panel IP as a JSON string.
   */
  async getBackup({ homey }) {
    return homey.app.exportPkiBackup();
  },

  /**
   * POST /restore — accepts a backup JSON string in body.json and
   * writes it back to homey.settings. Returns the restored panel IP.
   */
  async postRestore({ homey, body }) {
    if (!body || typeof body.json !== 'string' || body.json.length === 0) {
      throw new Error('Missing backup payload');
    }
    return homey.app.importPkiBackup(body.json);
  },
};
