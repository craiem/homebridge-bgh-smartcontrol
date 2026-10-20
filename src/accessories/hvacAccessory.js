const { buildHvacSetModes, buildHvacSwingOnTrigger, buildHvacStatusRequest } = require('../protocol/haCommand');
const { HVAC_MODE, HVAC_FAN_MODE, HVAC_SWING_FLAG, HVAC_TEMP_RANGE_C } = require('../protocol/constants');

// HomeKit's RotationSpeed is 0-100; BGH only has three discrete speeds plus AUTO (handled
// separately via TargetFanState). Buckets chosen so each speed's slider position is unambiguous.
const FAN_SPEED_TO_PERCENT = {
  [HVAC_FAN_MODE.LOW]: 33,
  [HVAC_FAN_MODE.MEDIUM]: 66,
  [HVAC_FAN_MODE.HIGH]: 100,
};

function percentToFanSpeed(percent) {
  if (percent <= 33) return HVAC_FAN_MODE.LOW;
  if (percent <= 66) return HVAC_FAN_MODE.MEDIUM;
  return HVAC_FAN_MODE.HIGH;
}

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

function activeFromMode(bghMode, Characteristic) {
  return bghMode === HVAC_MODE.OFF ? Characteristic.Active.INACTIVE : Characteristic.Active.ACTIVE;
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

// Binds a Homebridge Thermostat + Fanv2 service pair to a BGH-7012 HVAC unit. Mode/temperature
// confirmed against real hardware (power on/off) and cross-validated against
// github.com/firtman/bgh_smart's working local-UDP client. Fan speed is confirmed from live
// STATUS_REPORT captures. Swing is confirmed by replaying both flag values against a real unit and
// watching it start/stop swinging (see constants.js HVAC_SWING_FLAG) but is otherwise unvalidated
// (single unit, single session).
function bindHvacAccessory({ platform, accessory, device }) {
  const { Service, Characteristic } = platform;
  const service =
    accessory.getService(Service.Thermostat) || accessory.addService(Service.Thermostat, device.name);
  service.updateCharacteristic(Characteristic.Name, device.name); // keep in sync on a config.json rename

  const fanService =
    accessory.getService(Service.Fanv2) || accessory.addService(Service.Fanv2, `${device.name} Fan`);
  fanService.updateCharacteristic(Characteristic.Name, `${device.name} Fan`);

  let currentTempC = 24;
  let targetTempC = 24;
  let currentMode = HVAC_MODE.OFF;
  let currentFanSpeed = HVAC_FAN_MODE.HIGH;
  let currentSwing = HVAC_SWING_FLAG.OFF;

  // Sends the full desired state every time, matching how the official app itself operates (every
  // captured command carries mode+fan+swing+temp together, never just the one field that changed).
  function sendState({ mode = currentMode, fanSpeed = currentFanSpeed, swing = currentSwing, targetTempC: temp } = {}) {
    return buildHvacSetModes({
      transport: platform.transport,
      destinationMAC: device.mac,
      endpoint: device.endpoint || 1,
      mode,
      fanSpeed,
      swing,
      targetTempC: temp,
    });
  }

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
      try {
        const packet = sendState({ targetTempC: value });
        await platform.transport.sendTo(packet, device.ip);
        targetTempC = value;
      } catch (err) {
        platform.log.error(`${device.name}: failed to set target temperature to ${value}: ${err.message}`);
        throw new platform.api.hap.HapStatusError(platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    });

  service
    .getCharacteristic(Characteristic.TargetHeatingCoolingState)
    .onSet(async (value) => {
      const mode = homeKitModeToBgh(value, Characteristic);
      try {
        const packet = sendState({ mode });
        await platform.transport.sendTo(packet, device.ip);
        currentMode = mode;
        service.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, bghModeToHomeKit(mode, Characteristic));
        fanService.updateCharacteristic(Characteristic.Active, activeFromMode(mode, Characteristic));
      } catch (err) {
        platform.log.error(`${device.name}: failed to set mode: ${err.message}`);
        throw new platform.api.hap.HapStatusError(platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
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

  fanService
    .getCharacteristic(Characteristic.Active)
    .onGet(() => activeFromMode(currentMode, Characteristic))
    .onSet(async (value) => {
      const mode = value === Characteristic.Active.ACTIVE ? HVAC_MODE.LAST_MODE : HVAC_MODE.OFF;
      try {
        const packet = sendState({ mode });
        await platform.transport.sendTo(packet, device.ip);
        currentMode = mode === HVAC_MODE.LAST_MODE ? HVAC_MODE.AUTO : HVAC_MODE.OFF;
        service.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, bghModeToHomeKit(currentMode, Characteristic));
        service.updateCharacteristic(Characteristic.TargetHeatingCoolingState, value === Characteristic.Active.ACTIVE ? Characteristic.TargetHeatingCoolingState.AUTO : Characteristic.TargetHeatingCoolingState.OFF);
      } catch (err) {
        platform.log.error(`${device.name}: failed to set power via fan: ${err.message}`);
        throw new platform.api.hap.HapStatusError(platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    });

  fanService.getCharacteristic(Characteristic.CurrentFanState).onGet(() => {
    if (currentMode === HVAC_MODE.OFF) return Characteristic.CurrentFanState.INACTIVE;
    return Characteristic.CurrentFanState.BLOWING_AIR;
  });

  fanService
    .getCharacteristic(Characteristic.TargetFanState)
    .onGet(() => (currentFanSpeed === HVAC_FAN_MODE.AUTO ? Characteristic.TargetFanState.AUTO : Characteristic.TargetFanState.MANUAL))
    .onSet(async (value) => {
      const fanSpeed =
        value === Characteristic.TargetFanState.AUTO
          ? HVAC_FAN_MODE.AUTO
          : percentToFanSpeed(fanService.getCharacteristic(Characteristic.RotationSpeed).value || 100);
      try {
        const packet = sendState({ fanSpeed });
        await platform.transport.sendTo(packet, device.ip);
        currentFanSpeed = fanSpeed;
      } catch (err) {
        platform.log.error(`${device.name}: failed to set fan auto/manual: ${err.message}`);
        throw new platform.api.hap.HapStatusError(platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    });

  fanService
    .getCharacteristic(Characteristic.RotationSpeed)
    .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
    .onGet(() => FAN_SPEED_TO_PERCENT[currentFanSpeed] ?? 100)
    .onSet(async (value) => {
      const fanSpeed = percentToFanSpeed(value);
      try {
        const packet = sendState({ fanSpeed });
        await platform.transport.sendTo(packet, device.ip);
        currentFanSpeed = fanSpeed;
        fanService.updateCharacteristic(Characteristic.TargetFanState, Characteristic.TargetFanState.MANUAL);
      } catch (err) {
        platform.log.error(`${device.name}: failed to set fan speed to ${value}%: ${err.message}`);
        throw new platform.api.hap.HapStatusError(platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    });

  // Swing is confirmed (see constants.js HVAC_SWING_FLAG) but only from one toggle on one unit —
  // watch the real unit the first few times this is used.
  fanService
    .getCharacteristic(Characteristic.SwingMode)
    .onGet(() => (currentSwing === HVAC_SWING_FLAG.ON ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED))
    .onSet(async (value) => {
      const swing = value === Characteristic.SwingMode.SWING_ENABLED ? HVAC_SWING_FLAG.ON : HVAC_SWING_FLAG.OFF;
      try {
        const packet = sendState({ swing });
        await platform.transport.sendTo(packet, device.ip);
        if (swing === HVAC_SWING_FLAG.ON) {
          await platform.transport.sendTo(
            buildHvacSwingOnTrigger({ transport: platform.transport, destinationMAC: device.mac, endpoint: device.endpoint || 1 }),
            device.ip,
          );
        }
        currentSwing = swing;
      } catch (err) {
        platform.log.error(`${device.name}: failed to set swing: ${err.message}`);
        throw new platform.api.hap.HapStatusError(platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    });

  // Called by the platform when a STATUS_REPORT broadcast from this device's MAC is observed
  // (push updates — no polling needed), and once at startup after requesting a fresh status.
  function updateFromStatus(status) {
    currentTempC = status.ambientTempC;
    targetTempC = status.targetTempC;
    currentMode = status.mode;
    currentFanSpeed = status.fanSpeed;
    service.updateCharacteristic(Characteristic.CurrentTemperature, currentTempC);
    service.updateCharacteristic(Characteristic.TargetTemperature, targetTempC);
    service.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, bghModeToHomeKit(currentMode, Characteristic));
    fanService.updateCharacteristic(Characteristic.Active, activeFromMode(currentMode, Characteristic));
    fanService.updateCharacteristic(Characteristic.CurrentFanState, currentMode === HVAC_MODE.OFF ? Characteristic.CurrentFanState.INACTIVE : Characteristic.CurrentFanState.BLOWING_AIR);
    fanService.updateCharacteristic(
      Characteristic.TargetFanState,
      currentFanSpeed === HVAC_FAN_MODE.AUTO ? Characteristic.TargetFanState.AUTO : Characteristic.TargetFanState.MANUAL,
    );
    if (FAN_SPEED_TO_PERCENT[currentFanSpeed] !== undefined) {
      fanService.updateCharacteristic(Characteristic.RotationSpeed, FAN_SPEED_TO_PERCENT[currentFanSpeed]);
    }
    // Swing isn't reported in STATUS_REPORT (see constants.js HVAC_STATUS_PAYLOAD_OFFSETS), so
    // currentSwing is left as whatever we last set it to rather than guessed from this broadcast.
  }

  const requestInitialStatus = () =>
    platform.transport.sendTo(
      buildHvacStatusRequest({ transport: platform.transport, destinationMAC: device.mac }),
      device.ip,
    );

  return { service, fanService, updateFromStatus, requestInitialStatus };
}

module.exports = { bindHvacAccessory };
