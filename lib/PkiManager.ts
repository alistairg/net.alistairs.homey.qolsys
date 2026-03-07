import forge from 'node-forge';
import Homey from 'homey/lib/Homey';

const SETTINGS_PREFIX = 'pki_';

interface PkiCertificates {
  privateKey: string;   // PEM
  certificate: string;  // PEM (self-signed)
  csr: string;          // PEM
  secure?: string;      // PEM or raw (panel-signed client cert)
  qolsysCa?: string;   // PEM or raw (panel CA cert)
}

/**
 * Manages PKI for the Qolsys IQ Remote protocol.
 * Generates RSA keys, self-signed certificates, and CSRs.
 * Stores all material in homey.settings (never in /userdata/).
 */
export class PkiManager {

  private homey: Homey;
  private _macAddress: string = '';

  constructor(homey: Homey) {
    this.homey = homey;
  }

  get macAddress(): string {
    return this._macAddress || this.homey.settings.get(`${SETTINGS_PREFIX}mac_address`) || '';
  }

  /** MAC without colons, lowercase (used as internal ID). */
  get macId(): string {
    return this.macAddress.replace(/:/g, '');
  }

  /** MAC formatted with colons (used in MQTT topics and client ID). */
  get formattedMac(): string {
    return this.macAddress;
  }

  /** Generate a random MAC in the format f2:16:3e:xx:xx:xx (matching QolsysController). */
  static generateRandomMac(): string {
    const fixed = [0xf2, 0x16, 0x3e];
    const random = [
      Math.floor(Math.random() * 0x80), // 0x00–0x7F (matches Python source)
      Math.floor(Math.random() * 0x100),
      Math.floor(Math.random() * 0x100),
    ];
    return [...fixed, ...random].map((b) => b.toString(16).padStart(2, '0')).join(':');
  }

  /**
   * Generate RSA 2048-bit key pair, self-signed certificate, and CSR.
   * Subject fields match QolsysController/qolsys_controller/pki.py exactly.
   */
  generatePki(macAddress: string): PkiCertificates {
    this._macAddress = macAddress;

    // Generate RSA 2048-bit key pair
    const keypair = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });

    // Subject must match Python source exactly (note trailing space on CN)
    const attrs: forge.pki.CertificateField[] = [
      { name: 'countryName', value: 'US' },
      { name: 'stateOrProvinceName', value: 'SanJose' },
      { name: 'localityName', value: '' },
      { name: 'organizationName', value: 'Qolsys Inc.' },
      { name: 'commonName', value: 'www.qolsys.com ' }, // trailing space is intentional
    ];

    // Create self-signed certificate (valid 10 years)
    const cert = forge.pki.createCertificate();
    cert.publicKey = keypair.publicKey;
    cert.serialNumber = forge.util.bytesToHex(forge.random.getBytesSync(16));
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 10);
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([
      { name: 'basicConstraints', cA: false, critical: true },
    ]);
    cert.sign(keypair.privateKey, forge.md.sha256.create());

    // Create CSR with same subject
    const csr = forge.pki.createCertificationRequest();
    csr.publicKey = keypair.publicKey;
    csr.setSubject(attrs);
    csr.setAttributes([
      {
        name: 'extensionRequest',
        extensions: [
          { name: 'basicConstraints', cA: false, critical: true },
        ],
      },
    ]);
    csr.sign(keypair.privateKey, forge.md.sha256.create());

    return {
      privateKey: forge.pki.privateKeyToPem(keypair.privateKey),
      certificate: forge.pki.certificateToPem(cert),
      csr: forge.pki.certificationRequestToPem(csr),
    };
  }

  /** Store all PKI material in homey.settings. */
  storePki(certs: PkiCertificates): void {
    this.homey.settings.set(`${SETTINGS_PREFIX}private_key`, certs.privateKey);
    this.homey.settings.set(`${SETTINGS_PREFIX}certificate`, certs.certificate);
    this.homey.settings.set(`${SETTINGS_PREFIX}csr`, certs.csr);
    this.homey.settings.set(`${SETTINGS_PREFIX}mac_address`, this._macAddress);

    if (certs.secure) {
      this.homey.settings.set(`${SETTINGS_PREFIX}secure`, certs.secure);
    }
    if (certs.qolsysCa) {
      this.homey.settings.set(`${SETTINGS_PREFIX}qolsys_ca`, certs.qolsysCa);
    }
  }

  /** Store the signed certificates received from the panel during pairing. */
  storePanelCerts(secureCert: string, qolsysCa: string): void {
    this.homey.settings.set(`${SETTINGS_PREFIX}secure`, secureCert);
    this.homey.settings.set(`${SETTINGS_PREFIX}qolsys_ca`, qolsysCa);
  }

  /** Load PKI material from homey.settings. Returns null if not found. */
  loadPki(): PkiCertificates | null {
    const privateKey = this.homey.settings.get(`${SETTINGS_PREFIX}private_key`);
    const certificate = this.homey.settings.get(`${SETTINGS_PREFIX}certificate`);
    const csr = this.homey.settings.get(`${SETTINGS_PREFIX}csr`);
    this._macAddress = this.homey.settings.get(`${SETTINGS_PREFIX}mac_address`) || '';

    if (!privateKey || !certificate || !csr) {
      return null;
    }

    return {
      privateKey,
      certificate,
      csr,
      secure: this.homey.settings.get(`${SETTINGS_PREFIX}secure`) || undefined,
      qolsysCa: this.homey.settings.get(`${SETTINGS_PREFIX}qolsys_ca`) || undefined,
    };
  }

  /** Returns true if we have all certificates needed for mTLS (pairing completed). */
  isPaired(): boolean {
    const pki = this.loadPki();
    return !!(pki?.privateKey && pki?.secure && pki?.qolsysCa);
  }

  /** Get TLS options for mqtt.connect(). Throws if not paired. */
  getTlsOptions(): { key: Buffer; cert: Buffer; ca: Buffer } {
    const pki = this.loadPki();
    if (!pki?.privateKey || !pki?.secure || !pki?.qolsysCa) {
      throw new Error('PKI not initialized — pairing required');
    }

    return {
      key: Buffer.from(pki.privateKey),
      cert: Buffer.from(pki.secure),
      ca: Buffer.from(pki.qolsysCa),
    };
  }

  /** Get the CSR as a string (for sending to panel during pairing). */
  getCsr(): string {
    const pki = this.loadPki();
    if (!pki?.csr) {
      throw new Error('PKI not initialized — call generatePki() first');
    }
    return pki.csr;
  }

  /** Export all PKI material + panel IP as a JSON string for backup. */
  exportBackup(): string {
    const pki = this.loadPki();
    const panelIp = this.homey.settings.get('panel_ip') || '';
    return JSON.stringify({
      macAddress: this.macAddress,
      panelIp,
      ...pki,
    }, null, 2);
  }

  /** Restore PKI material from a backup JSON string. */
  importBackup(json: string): void {
    const data = JSON.parse(json);
    this._macAddress = data.macAddress || '';
    this.storePki({
      privateKey: data.privateKey,
      certificate: data.certificate,
      csr: data.csr,
      secure: data.secure,
      qolsysCa: data.qolsysCa,
    });
    if (data.panelIp) {
      this.homey.settings.set('panel_ip', data.panelIp);
    }
  }

}
