const dgram = require('dgram');
const os = require('os');
const { NETWORK } = require('../protocol/constants');
const { decodeHeader } = require('../protocol/haCommandHeader');

// Mirrors Solidmation.Mobile.Core.UDPHandling.UDPManagerBase / UDPManager_Client / UDPManager_Server:
// one UDP socket, broadcast-capable, sequence-numbered outgoing commands, dispatched incoming
// responses. Ports/broadcast address come from protocol/constants.js and are UNCONFIRMED (see
// that file) until matched against a real capture.

function localBroadcastAddress() {
  if (NETWORK.BROADCAST_ADDRESS) return NETWORK.BROADCAST_ADDRESS;
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal) {
        const parts = a.address.split('.');
        parts[3] = '255';
        return parts.join('.');
      }
    }
  }
  throw new Error('Could not determine a local IPv4 broadcast address; set NETWORK.BROADCAST_ADDRESS.');
}

class UdpTransport {
  constructor({ log } = {}) {
    this.log = log || console;
    this.socket = null;
    this._sequence = 0;
    this._listeners = new Set();
  }

  getNextSequenceNumber() {
    this._sequence = (this._sequence + 1) & 0xff;
    return this._sequence;
  }

  onMessage(handler) {
    this._listeners.add(handler);
    return () => this._listeners.delete(handler);
  }

  start() {
    if (this.socket) return;
    if (!NETWORK.CLIENT_PORT) {
      throw new Error(
        'NETWORK.CLIENT_PORT is unknown. Capture real traffic and fill it in before starting the transport.',
      );
    }
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket.on('message', (msg, rinfo) => {
      let decoded;
      try {
        decoded = decodeHeader(msg);
      } catch (err) {
        this.log.debug?.(`Dropped malformed HACommand packet from ${rinfo.address}: ${err.message}`);
        return;
      }
      for (const handler of this._listeners) {
        try {
          handler(decoded, rinfo, msg);
        } catch (err) {
          this.log.error?.(`HACommand handler error: ${err.stack || err}`);
        }
      }
    });
    this.socket.on('error', (err) => {
      this.log.error?.(`UDP socket error: ${err.stack || err}`);
    });
    return new Promise((resolve, reject) => {
      this.socket.once('error', reject);
      this.socket.bind(NETWORK.CLIENT_PORT, () => {
        this.socket.setBroadcast(true);
        resolve();
      });
    });
  }

  stop() {
    if (!this.socket) return;
    this.socket.close();
    this.socket = null;
  }

  sendBroadcast(buffer) {
    return this._send(buffer, localBroadcastAddress());
  }

  sendTo(buffer, host) {
    return this._send(buffer, host);
  }

  _send(buffer, host) {
    if (!NETWORK.SERVER_PORT) {
      throw new Error(
        'NETWORK.SERVER_PORT is unknown. Capture real traffic and fill it in before sending commands.',
      );
    }
    return new Promise((resolve, reject) => {
      this.socket.send(buffer, NETWORK.SERVER_PORT, host, (err) => (err ? reject(err) : resolve()));
    });
  }
}

module.exports = { UdpTransport, localBroadcastAddress };
