const { UdpTransport } = require('./transport/udpTransport');
const { macFromString, macToString } = require('./protocol/haCommandHeader');
const { parseStatusReport } = require('./protocol/haCommand');
const { bindSwitchAccessory } = require('./accessories/switchAccessory');
const { bindHvacAccessory } = require('./accessories/hvacAccessory');
const { bindDimmerAccessory } = require('./accessories/dimmerAccessory');
const { bindCurtainAccessory } = require('./accessories/curtainAccessory');
const { bindLockAccessory } = require('./accessories/lockAccessory');
const { scanForDevices } = require('./discovery');
const { DeviceDirectory } = require('./deviceDirectory');

const ACCESSORY_BINDERS = {
  switch: bindSwitchAccessory,
  hvac: bindHvacAccessory,
  dimmer: bindDimmerAccessory,
  curtain: bindCurtainAccessory,
  lock: bindLockAccessory,
};

const DEFAULT_ENDPOINT_BY_TYPE = { hvac: 1 };

const PLUGIN_NAME = 'homebridge-bgh-smartcontrol';
const PLATFORM_NAME = 'BGHSmartControl';

class BGHSmartControlPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.accessories = new Map();
    this.transport = new UdpTransport({ log });
    this.hvacByMac = new Map(); // mac string -> { updateFromStatus, requestInitialStatus }
    this.directory = new DeviceDirectory(); // mac string -> last-observed IP (self-healing against DHCP changes)

    this.api.on('didFinishLaunching', () => this._onDidFinishLaunching());
    this.api.on('shutdown', () => this.transport.stop());
  }

  configureAccessory(accessory) {
    this.log.info(`Restoring cached accessory: ${accessory.displayName}`);
    this.accessories.set(accessory.UUID, accessory);
  }

  async _onDidFinishLaunching() {
    const devices = Array.isArray(this.config.devices) ? this.config.devices : [];
    if (devices.length === 0) {
      this.log.warn(
        `${PLATFORM_NAME}: no "devices" configured. See README.md — protocol discovery is not ` +
          'decoded yet, so devices must be listed manually in config.json for now.',
      );
      return;
    }

    try {
      await this.transport.start();
    } catch (err) {
      this.log.error(
        `${PLATFORM_NAME}: could not start the UDP transport (${err.message}). ` +
          'This plugin needs NETWORK.SERVER_PORT/CLIENT_PORT filled in from a real packet ' +
          'capture before it can talk to a hub — see tools/decode-capture.js.',
      );
      return;
    }

    this.transport.onMessage((decoded, rinfo) => {
      this.log.debug?.(
        `HACommand from ${rinfo.address}:${rinfo.port} cmd=${decoded.commandID} seq=${decoded.sequenceNumber} ` +
          `payload=${decoded.payload.toString('hex')}`,
      );
      const senderMac = macToString(decoded.sourceMAC);
      if (senderMac !== '00:00:00:00:00:00') this.directory.observe(senderMac, rinfo.address);

      const status = parseStatusReport(decoded);
      if (!status) return;
      const hvac = this.hvacByMac.get(senderMac);
      if (hvac) hvac.updateFromStatus(status);
    });

    try {
      const found = await scanForDevices({ transport: this.transport });
      this.log.info(
        `${PLATFORM_NAME}: discovered ${found.length} device(s) on the LAN (for reference — devices ` +
          `are still registered from config.json, not auto-added):`,
      );
      for (const d of found) {
        this.log.info(`  ${d.ip}  ${d.mac}  ${d.model} fw ${d.firmwareVersion}`);
        this.directory.observe(d.mac, d.ip);
      }
    } catch (err) {
      this.log.warn(`${PLATFORM_NAME}: discovery scan failed (${err.message}); continuing with configured devices only.`);
    }

    for (const deviceConfig of devices) {
      this._registerDevice(deviceConfig);
    }
  }

  _registerDevice(deviceConfig) {
    const { name, mac, ip, type, endpoint = DEFAULT_ENDPOINT_BY_TYPE[deviceConfig.type] ?? 0 } = deviceConfig;
    if (!name || !mac || !ip || !type) {
      this.log.error(`${PLATFORM_NAME}: skipping device with missing name/mac/ip/type: ${JSON.stringify(deviceConfig)}`);
      return;
    }
    const bind = ACCESSORY_BINDERS[type];
    if (!bind) {
      this.log.error(`${PLATFORM_NAME}: unknown device type "${type}" for "${name}" (expected one of: ${Object.keys(ACCESSORY_BINDERS).join(', ')})`);
      return;
    }

    const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${mac}:${endpoint}`);
    let accessory = this.accessories.get(uuid);
    if (!accessory) {
      accessory = new this.api.platformAccessory(name, uuid);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.set(uuid, accessory);
    }

    const directory = this.directory;
    const device = {
      name,
      mac: macFromString(mac),
      endpoint,
      // Resolved live on every access: prefers the most recent IP actually observed on the wire
      // for this MAC over the config.json bootstrap value, so a DHCP lease change self-heals
      // instead of silently sending commands to a stale address.
      get ip() {
        return directory.resolve(mac, ip);
      },
    };
    const result = bind({ platform: this, accessory, device });
    if (type === 'hvac' && result?.updateFromStatus) {
      this.hvacByMac.set(mac.toLowerCase(), result);
      result.requestInitialStatus().catch((err) => this.log.warn(`${PLATFORM_NAME}: initial status request for "${name}" failed: ${err.message}`));
    }
    this.log.info(`${PLATFORM_NAME}: registered "${name}" (${type}) at ${ip} / ${mac} endpoint ${endpoint}`);
  }
}

module.exports = { BGHSmartControlPlatform, PLUGIN_NAME, PLATFORM_NAME };
