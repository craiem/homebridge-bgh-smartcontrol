const { buildDimmerSetValue } = require('../protocol/haCommand');

// Binds a Homebridge Lightbulb (on/off + brightness) service to a BGH dimmer endpoint.
function bindDimmerAccessory({ platform, accessory, device }) {
  const { Service, Characteristic } = platform;
  const service =
    accessory.getService(Service.Lightbulb) || accessory.addService(Service.Lightbulb, device.name);
  service.updateCharacteristic(Characteristic.Name, device.name); // keep in sync on a config.json rename

  let currentOn = false;
  let currentBrightness = 100;

  const send = async (level) => {
    try {
      const packet = buildDimmerSetValue({
        transport: platform.transport,
        destinationMAC: device.mac,
        endpoint: device.endpoint,
        level,
      });
      await platform.transport.sendTo(packet, device.ip);
    } catch (err) {
      platform.log.error(`${device.name}: failed to set dimmer level to ${level}: ${err.message}`);
      throw new platform.api.hap.HapStatusError(platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  };

  service
    .getCharacteristic(Characteristic.On)
    .onGet(() => currentOn)
    .onSet(async (value) => {
      await send(value ? currentBrightness : 0);
      currentOn = Boolean(value);
    });

  service
    .getCharacteristic(Characteristic.Brightness)
    .onGet(() => currentBrightness)
    .onSet(async (value) => {
      if (currentOn) await send(value);
      currentBrightness = value;
    });

  return service;
}

module.exports = { bindDimmerAccessory };
