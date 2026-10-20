const { buildCurtainSetPosition } = require('../protocol/haCommand');

// Binds a Homebridge WindowCovering service to a BGH curtain/blind endpoint.
// Position feedback is optimistic (assumes the move succeeded) until status-packet decoding
// (HACommand_StatusCurtain) is confirmed from a capture.
function bindCurtainAccessory({ platform, accessory, device }) {
  const { Service, Characteristic } = platform;
  const service =
    accessory.getService(Service.WindowCovering) ||
    accessory.addService(Service.WindowCovering, device.name);
  service.updateCharacteristic(Characteristic.Name, device.name); // keep in sync on a config.json rename

  let currentPosition = 50;

  service.getCharacteristic(Characteristic.CurrentPosition).onGet(() => currentPosition);
  service.getCharacteristic(Characteristic.PositionState).onGet(() => Characteristic.PositionState.STOPPED);

  service
    .getCharacteristic(Characteristic.TargetPosition)
    .onGet(() => currentPosition)
    .onSet(async (value) => {
      try {
        const packet = buildCurtainSetPosition({
          transport: platform.transport,
          destinationMAC: device.mac,
          endpoint: device.endpoint,
          position: value,
        });
        await platform.transport.sendTo(packet, device.ip);
        currentPosition = value;
      } catch (err) {
        platform.log.error(`${device.name}: failed to set curtain position to ${value}: ${err.message}`);
        throw new platform.api.hap.HapStatusError(platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    });

  return service;
}

module.exports = { bindCurtainAccessory };
