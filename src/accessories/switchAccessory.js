const { buildSwitchSetOnOff } = require('../protocol/haCommand');

// Binds a Homebridge Switch/Lightbulb (on/off only) service to a BGH endpoint.
function bindSwitchAccessory({ platform, accessory, device }) {
  const { Service, Characteristic } = platform;
  const service =
    accessory.getService(Service.Switch) || accessory.addService(Service.Switch, device.name);
  service.updateCharacteristic(Characteristic.Name, device.name); // keep in sync on a config.json rename

  let currentState = false;

  service
    .getCharacteristic(Characteristic.On)
    .onGet(() => currentState)
    .onSet(async (value) => {
      const packet = buildSwitchSetOnOff({
        transport: platform.transport,
        destinationMAC: device.mac,
        endpoint: device.endpoint,
        on: value,
      });
      await platform.transport.sendTo(packet, device.ip);
      currentState = Boolean(value);
    });

  return service;
}

module.exports = { bindSwitchAccessory };
