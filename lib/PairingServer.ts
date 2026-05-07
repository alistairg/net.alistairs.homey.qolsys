import tls from 'tls';
import { EventEmitter } from 'events';
import mdns from 'multicast-dns';
import { PkiManager } from './PkiManager';

const SENT_MARKER = Buffer.from('sent');
const MAC_HEADER = Buffer.from([0x00, 0x11]);

export interface PairingResult {
  panelIp: string;
  panelMac: string;
  secureCert: string;
  qolsysCa: string;
}

/**
 * TLS server + mDNS advertisement for the Qolsys IQ Remote pairing protocol.
 *
 * The panel discovers Homey via mDNS, connects to Homey's TLS server,
 * and exchanges certificates. This is the reverse of typical discovery.
 *
 * Reference: QolsysController/qolsys_controller/controller.py lines 372–503
 */
export class PairingServer extends EventEmitter {

  private pkiManager: PkiManager;
  private pluginIp: string;
  private server: tls.Server | null = null;
  private mdnsServer: any = null;
  private port: number = 0;
  private _timeout: NodeJS.Timeout | null = null;
  private _announceInterval: NodeJS.Timeout | null = null;
  private _pendingReject: ((err: Error) => void) | null = null;
  private log: (...args: any[]) => void;

  constructor(pkiManager: PkiManager, pluginIp: string, log?: (...args: any[]) => void) {
    super();
    this.pkiManager = pkiManager;
    this.pluginIp = pluginIp;
    this.log = log || console.log;
  }

  /**
   * Start the pairing server. Opens a TLS server on a random high port,
   * advertises via mDNS, and waits for the panel to connect.
   *
   * Returns a promise that resolves with the pairing result when the
   * certificate exchange is complete, or rejects on timeout/error.
   *
   * @param timeoutMs How long to wait for the panel to connect (default: 5 minutes)
   */
  async startPairing(timeoutMs: number = 300000): Promise<PairingResult> {
    // Pick random port 50000–55000
    this.port = 50000 + Math.floor(Math.random() * 5001);

    // Load PKI for TLS server context
    const pki = this.pkiManager.loadPki();
    if (!pki) {
      throw new Error('PKI not initialized — call generatePki() first');
    }

    this.log('[PairingServer] Starting pairing on port', this.port, 'pluginIp:', this.pluginIp);

    return new Promise<PairingResult>((resolve, reject) => {
      // Track the reject callback so stopPairing() can cancel a pending
      // attempt rather than orphan the promise.
      this._pendingReject = reject;

      // Create TLS server using the self-signed cert (for initial pairing handshake)
      this.server = tls.createServer(
        {
          key: pki.privateKey,
          cert: pki.certificate,
          requestCert: false,
          rejectUnauthorized: false,
        },
        (socket) => {
          this.log('[PairingServer] TLS connection from', socket.remoteAddress, ':', socket.remotePort);
          this.handleConnection(socket, resolve, reject);
        },
      );

      this.server.on('error', (err) => {
        this.log('[PairingServer] Server error:', err.message);
        this.cleanup();
        reject(new Error(`Pairing server error: ${err.message}`));
      });

      this.server.on('tlsClientError', (err) => {
        this.log('[PairingServer] TLS client error:', err.message);
      });

      // Listen on all interfaces
      this.server.listen(this.port, '0.0.0.0', () => {
        this.log('[PairingServer] TLS server listening on 0.0.0.0:', this.port);
        this.emit('listening', this.port);

        // Start mDNS advertisement using multicast-dns directly.
        // Records match what Python zeroconf generates for the panel.
        const serviceName = 'NsdPairService._http._tcp.local';
        const serviceType = '_http._tcp.local';
        const hostName = 'NsdPairService.local';

        const ptrRecord = { name: serviceType, type: 'PTR' as const, ttl: 4500, data: serviceName };
        const srvRecord = { name: serviceName, type: 'SRV' as const, ttl: 120, data: { port: this.port, target: hostName, weight: 0, priority: 0 } };
        const txtRecord = { name: serviceName, type: 'TXT' as const, ttl: 4500, data: Buffer.alloc(0) };
        const aRecord = { name: hostName, type: 'A' as const, ttl: 120, data: this.pluginIp };
        // DNS-SD meta-query: advertise that _http._tcp exists as a service type
        const metaPtrRecord = { name: '_services._dns-sd._udp.local', type: 'PTR' as const, ttl: 4500, data: serviceType };

        this.log('[PairingServer] Records: PTR', serviceType, '->', serviceName,
          '| SRV', serviceName, '->', hostName + ':' + this.port,
          '| A', hostName, '->', this.pluginIp);

        this.mdnsServer = mdns();

        // Respond to mDNS queries with proper record placement per DNS-SD spec:
        // PTR query → answer=PTR, additionals=[SRV, TXT, A]
        // SRV query → answer=SRV, additionals=[A]
        // A query → answer=A
        // All records in one response — some Android NSD implementations
        // work better when all records are in answers (not split answers/additionals)
        const allRecords = [ptrRecord, srvRecord, txtRecord, aRecord];

        // multicast-dns emits (packet, rinfo) as two args
        this.mdnsServer.on('query', (query: any, rinfo: any) => {
          const remoteAddr = rinfo?.address || 'unknown';
          for (const q of query.questions) {
            const isOurs = q.name === serviceType || q.name === serviceName
              || q.name === hostName || q.name === '_services._dns-sd._udp.local';
            if (isOurs) {
              this.log('[PairingServer] mDNS query from', remoteAddr, ': name=' + q.name + ' type=' + q.type);
            }

            // Respond with all records for any query about our service
            // Send both multicast AND unicast directly to the querier
            if (q.name === serviceType || q.name === serviceName || q.name === hostName) {
              const packet = { answers: allRecords };
              this.mdnsServer.respond(packet);
              // Also send unicast directly to the querier (Android NSD often needs this)
              if (rinfo) {
                this.mdnsServer.respond(packet, rinfo);
              }
            } else if (q.name === '_services._dns-sd._udp.local' && (q.type === 'PTR' || q.type === 'ANY')) {
              this.mdnsServer.respond({ answers: [metaPtrRecord] });
            }
          }
        });

        // Announce: all records in answers for maximum compatibility
        const announcePacket = {
          answers: allRecords,
        };
        this.mdnsServer.respond(announcePacket, () => {
          this.log('[PairingServer] mDNS announced NsdPairService on', this.pluginIp, ':', this.port);
        });

        // Re-announce periodically every 5s so the panel sees us even if it starts scanning late
        this._announceInterval = setInterval(() => {
          if (this.mdnsServer) {
            this.mdnsServer.respond(announcePacket);
          }
        }, 5000);

        this.emit('advertising', this.port);
      });

      // Timeout
      this._timeout = setTimeout(() => {
        this.log('[PairingServer] Pairing timed out after', timeoutMs, 'ms');
        this.cleanup();
        reject(new Error('Pairing timed out — no connection from panel'));
      }, timeoutMs);
    });
  }

  /** Handle an incoming connection from the panel during pairing. */
  private handleConnection(
    socket: tls.TLSSocket,
    resolve: (result: PairingResult) => void,
    reject: (err: Error) => void,
  ): void {
    const panelIp = socket.remoteAddress || '';
    let buffer = Buffer.alloc(0);
    let panelMac = '';
    let macReceived = false;
    let macSent = false;
    let csrSent = false;
    let secureCert = '';
    let secureReceived = false;

    socket.on('data', (chunk: Buffer) => {
      this.log('[PairingServer] Received', chunk.length, 'bytes, macReceived:', macReceived, 'secureReceived:', secureReceived);
      buffer = Buffer.concat([buffer, chunk]);

      try {
        // Step 1: Panel sends \x00\x11 + panel_mac
        if (!macReceived) {
          // Panel MAC comes as raw bytes, decode as string, filter printable
          const raw = buffer.toString();
          panelMac = raw.replace(/[\x00-\x1f]/g, '');
          macReceived = true;
          buffer = Buffer.alloc(0);
          this.log('[PairingServer] Panel MAC received:', panelMac);

          // Step 2: Send \x00\x11 + our random_mac
          if (!macSent) {
            const macMsg = Buffer.concat([MAC_HEADER, Buffer.from(this.pkiManager.formattedMac)]);
            socket.write(macMsg);
            macSent = true;
            this.log('[PairingServer] Sent our MAC:', this.pkiManager.formattedMac);

            // Step 3: Send CSR + "sent" terminator
            if (!csrSent) {
              const csrContent = this.pkiManager.getCsr();
              socket.write(Buffer.from(csrContent));
              socket.write(SENT_MARKER);
              csrSent = true;
              this.log('[PairingServer] Sent CSR (' + csrContent.length + ' bytes) + sent marker');
            }
          }
          return;
        }

        // Step 4: Read signed client cert until "sent" terminator
        if (macReceived && !secureReceived) {
          const sentIdx = buffer.indexOf(SENT_MARKER);
          if (sentIdx === -1) {
            this.log('[PairingServer] Waiting for secure cert... buffer:', buffer.length, 'bytes');
            return;
          }

          secureCert = buffer.subarray(0, sentIdx).toString();
          buffer = buffer.subarray(sentIdx + SENT_MARKER.length);
          secureReceived = true;
          this.log('[PairingServer] Secure cert received (' + secureCert.length + ' chars)');
        }

        // Step 5: Read Qolsys CA cert until "sent" terminator
        if (secureReceived) {
          const sentIdx = buffer.indexOf(SENT_MARKER);
          if (sentIdx === -1) {
            this.log('[PairingServer] Waiting for CA cert... buffer:', buffer.length, 'bytes');
            return;
          }

          const qolsysCa = buffer.subarray(0, sentIdx).toString();
          this.log('[PairingServer] CA cert received (' + qolsysCa.length + ' chars)');

          // Pairing complete
          socket.end();
          this.cleanup();

          // Store the panel certificates
          this.pkiManager.storePanelCerts(secureCert, qolsysCa);
          this.log('[PairingServer] Pairing complete! Panel IP:', panelIp);

          resolve({
            panelIp: panelIp.replace('::ffff:', ''), // strip IPv6 prefix
            panelMac,
            secureCert,
            qolsysCa,
          });
        }
      } catch (err) {
        this.log('[PairingServer] Error in data handler:', err);
        socket.end();
        this.cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    socket.on('error', (err) => {
      this.log('[PairingServer] Socket error:', err.message);
      this.cleanup();
      reject(new Error(`Pairing socket error: ${err.message}`));
    });

    socket.on('close', () => {
      this.log('[PairingServer] Socket closed. secureReceived:', secureReceived);
      // If we haven't resolved yet, the panel disconnected early
      if (!secureReceived) {
        this.emit('panel_disconnected');
      }
    });
  }

  /** Stop the pairing server and clean up all resources. */
  async stopPairing(): Promise<void> {
    this.cleanup({ rejectReason: 'Pairing cancelled' });
  }

  private cleanup(opts: { rejectReason?: string } = {}): void {
    if (this._timeout) {
      clearTimeout(this._timeout);
      this._timeout = null;
    }

    if (this._announceInterval) {
      clearInterval(this._announceInterval);
      this._announceInterval = null;
    }

    if (this.mdnsServer) {
      this.mdnsServer.destroy();
      this.mdnsServer = null;
    }

    if (this.server) {
      this.server.close();
      this.server = null;
    }

    // Reject any in-flight startPairing promise so callers' .catch fires
    // instead of orphaning the promise. Cleared first so an inadvertent
    // re-cleanup doesn't double-reject.
    if (this._pendingReject && opts.rejectReason) {
      const reject = this._pendingReject;
      this._pendingReject = null;
      reject(new Error(opts.rejectReason));
    } else {
      this._pendingReject = null;
    }
  }

}
