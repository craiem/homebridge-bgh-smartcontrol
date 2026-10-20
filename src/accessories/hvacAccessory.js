const { buildHvacSetModes, buildHvacStatusRequest } = require('../protocol/haCommand');
const { HVAC_MODE, HVAC_FAN_MODE, HVAC_TEMP_RANGE_C } = require('../protocol/constants');

// HomeKit's basic Thermostat service only has OFF/HEAT/COOL/AUTO — BGH's DRY and FAN-only modes
// have no equivalent, so they're exposed as AUTO on the HomeKit side (best-effort; setting AUTO
// from HomeKit always sends BGH's own AUTO, not DRY/FAN).
function bghModeToHomeKit(bghMode, Characteristic) {
  switch (bghMode) {
    case HVAC_MODE.OFF:
      return Characteristic.CurrentHeatingCoolingState.OFF;
    case HVAC_MODE.HEAT:
      return Characteristic.CurrentHeatingCoolingState.HEAT;
    case HVAC_MODE.COOL:
      return Characteristic.CurrentHeatingCoolingState.COOL;
    default:
      return Characteristic.CurrentHeatingCoolingState.OFF;
  }
}

function homeKitModeToBgh(targetState, Characteristic) {
  switch (targetState) {
    case Characteristic.TargetHeatingCoolingState.OFF:
      return HVAC_MODE.OFF;
    case Characteristic.TargetHeatingCoolingState.HEAT:
      return HVAC_MODE.HEAT;
    case Characteristic.TargetHeatingCoolingState.COOL:
      return HVAC_MODE.COOL;
    case Characteristic.TargetHeatingCoolingState.AUTO:
      return HVAC_MODE.AUTO;
    default:
      return HVAC_MODE.NO_CHANGE;
  }
}

// Binds a Homebridge Thermostat service to a BGH-7012 HVAC unit. Confirmed against real hardware
// (power on/off) and cross-validated against github.com/firtman/bgh_smart's working local-UDP
// client (mode, fan speed, temperature). Fan speed is sent as HIGH on every mode/temp change since
// this service doesn't expose a fan-speed control; add a separate Fanv2 service if that's wanted.
function bindHvacAccessory({ platform, accessory, device }) {
  const { Service, Characteristic } = platform;
  const service =
    accessory.getService(Service.Thermostat) || accessory.addService(Service.Thermostat, device.name);

  let currentTempC = 24;
  let targetTempC = 24;
  let currentMode = HVAC_MODE.OFF;

  service.getCharacteristic(Characteristic.TemperatureDisplayUnits).setProps({ validValues: [0] }); // Celsius only
  service
    .getCharacteristic(Characteristic.TargetTemperature)
    .setProps({ minValue: HVAC_TEMP_RANGE_C.min, maxValue: HVAC_TEMP_RANGE_C.max, minStep: 1 });

  service.getCharacteristic(Characteristic.CurrentTemperature).onGet(() => currentTempC);

  service
    .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
    .onGet(() => bghModeToHomeKit(currentMode, Characteristic));

  service
    .getCharacteristic(Characteristic.TargetTemperature)
    .onGet(() => targetTempC)
    .onSet(async (value) => {
      targetTempC = value;
      const packet = buildHvacSetModes({
        transport: platform.transport,
        destinationMAC: device.mac,
        endpoint: device.endpoint || 1,
        fanSpeed: HVAC_FAN_MODE.HIGH,
        targetTempC: value,
      });
      await platform.transport.sendTo(packet, device.ip);
    });

  service
    .getCharacteristic(Characteristic.TargetHeatingCoolingState)
    .onSet(async (value) => {
      const mode = homeKitModeToBgh(value, Characteristic);
      currentMode = mode;
      const packet = buildHvacSetModes({
        transport: platform.transport,
        destinationMAC: device.mac,
        endpoint: device.endpoint || 1,
        mode,
        fanSpeed: HVAC_FAN_MODE.HIGH,
      });
      await platform.transport.sendTo(packet, device.ip);
      service.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, bghModeToHomeKit(mode, Characteristic));
    })
    .onGet(() => {
      switch (currentMode) {
        case HVAC_MODE.OFF:
          return Characteristic.TargetHeatingCoolingState.OFF;
        case HVAC_MODE.HEAT:
          return Characteristic.TargetHeatingCoolingState.HEAT;
        case HVAC_MODE.COOL:
          return Characteristic.TargetHeatingCoolingState.COOL;
        default:
          return Characteristic.TargetHeatingCoolingState.AUTO;
      }
    });

  // Called by the platform when a STATUS_REPORT broadcast from this device's MAC is observed
  // (push updates — no polling needed), and once at startup after requesting a fresh status.
  function updateFromStatus(status) {
    currentTempC = status.ambientTempC;
    targetTempC = status.targetTempC;
    currentMode = status.mode;
    service.updateCharacteristic(Characteristic.CurrentTemperature, currentTempC);
    service.updateCharacteristic(Characteristic.TargetTemperature, targetTempC);
    service.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, bghModeToHomeKit(currentMode, Characteristic));
  }

  const requestInitialStatus = () =>
    platform.transport.sendTo(
      buildHvacStatusRequest({ transport: platform.transport, destinationMAC: device.mac }),
      device.ip,
    );

  return { service, updateFromStatus, requestInitialStatus };
}

module.exports = { bindHvacAccessory };
