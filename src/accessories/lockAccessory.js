const { buildDoorlockSetValue } = require('../protocol/haCommand');

// Binds a Homebridge LockMechanism service to a BGH doorlock endpoint.
function bindLockAccessory({ platform, accessory, device }) {
  const { Service, Characteristic } = platform;
  const service =
    accessory.getService(Service.LockMechanism) ||
    accessory.addService(Service.LockMechanism, device.name);
  service.updateCharacteristic(Characteristic.Name, device.name); // keep in sync on a config.json rename

  let currentState = Characteristic.LockCurrentState.SECURED;

  service.getCharacteristic(Characteristic.LockCurrentState).onGet(() => currentState);

  service
    .getCharacteristic(Characteristic.LockTargetState)
    .onGet(() =>
      currentState === Characteristic.LockCurrentState.SECURED
        ? Characteristic.LockTargetState.SECURED
        : Characteristic.LockTargetState.UNSECURED,
    )
    .onSet(async (value) => {
      const locked = value === Characteristic.LockTargetState.SECURED;
      const packet = buildDoorlockSetValue({
        transport: platform.transport,
        destinationMAC: device.mac,
        endpoint: device.endpoint,
        locked,
      });
      await platform.transport.sendTo(packet, device.ip);
      currentState = locked
        ? Characteristic.LockCurrentState.SECURED
        : Characteristic.LockCurrentState.UNSECURED;
      service.updateCharacteristic(Characteristic.LockCurrentState, currentState);
    });

  return service;
}

module.exports = { bindLockAccessory };
