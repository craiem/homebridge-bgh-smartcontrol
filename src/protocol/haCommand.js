const { encodeHeader, decodeHeader, macFromString } = require('./haCommandHeader');
const { COMMAND, JOIN_SUBCOMMAND, HVAC_MODE, HVAC_FAN_MODE, HVAC_STATUS_PAYLOAD_OFFSETS } = require('./constants');

// Thin layer over HACommandHeader that assembles a full HACommand packet (header + payload) for
// known command types. Command IDs come from constants.js and are unconfirmed placeholders; calls
// here will throw until the relevant constant is filled in from a real capture, which is
// intentional (better a loud failure than silently sending a wrong byte on the wire).

function requireConstant(value, name) {
  if (value === null || value === undefined) {
    throw new Error(`Protocol constant "${name}" is unknown — fill it in from a packet capture first.`);
  }
  return value;
}

function buildPacket({ transport, destinationMAC, sourceEndpoint = 0, destinationEndpoint = 0, commandID, payload = Buffer.alloc(0) }) {
  const header = encodeHeader({
    protocolVersion: 0, // confirmed: every captured packet (app and device) used 0x00
    sourceMAC: Buffer.alloc(6, 0), // confirmed: the app identifies itself as 00:00:00:00:00:00
    destinationMAC: Buffer.isBuffer(destinationMAC) ? destinationMAC : macFromString(destinationMAC),
    sequenceNumber: transport.getNextSequenceNumber(),
    sourceEndpoint,
    destinationEndpoint,
    commandID: requireConstant(commandID, 'commandID'),
  });
  return Buffer.concat([header, payload]);
}

// Confirmed: sent with destinationEndpoint=1 and an empty payload; the device ACKs with 0x80 and,
// for HVAC units, follows up with a fresh STATUS_REPORT broadcast.
function buildPing({ transport, destinationMAC, endpoint = 1 }) {
  return buildPacket({
    transport,
    destinationMAC,
    destinationEndpoint: endpoint,
    commandID: requireConstant(COMMAND.PING, 'COMMAND.PING'),
  });
}

function buildEnumerateAll({ transport }) {
  // Confirmed against a real capture: COMMAND.JOIN (0xa1) with payload [0x04] broadcast to
  // ff:ff:ff:ff:ff:ff, sent both to the subnet broadcast address and unicast to every host in the
  // /24 (see udpTransport.js's broadcastDiscovery, which mirrors SendToAllAddressesOfBroadCast).
  return buildPacket({
    transport,
    destinationMAC: Buffer.alloc(6, 0xff),
    commandID: requireConstant(COMMAND.JOIN, 'COMMAND.JOIN'),
    payload: Buffer.from([requireConstant(JOIN_SUBCOMMAND.ENUMERATE_ALL, 'JOIN_SUBCOMMAND.ENUMERATE_ALL')]),
  });
}

// Confirmed: a device's reply to ENUMERATE_ALL is COMMAND.JOIN with payload
// [JOIN_SUBCOMMAND.ENUMERATE_RESPONSE, ...ASCII "<Model>,<firmwareVersion>"], e.g. "BGH-7012,1.0.0.8".
// decodeHeader() already exposes commandID and payload; this just interprets that payload shape.
function parseEnumerateResponse(decodedPacket) {
  if (decodedPacket.commandID !== COMMAND.JOIN) return null;
  if (decodedPacket.payload[0] !== JOIN_SUBCOMMAND.ENUMERATE_RESPONSE) return null;
  const text = decodedPacket.payload.subarray(1).toString('ascii');
  const [model, firmwareVersion] = text.split(',');
  return { model, firmwareVersion };
}

function buildSwitchSetOnOff({ transport, destinationMAC, endpoint, on }) {
  return buildPacket({
    transport,
    destinationMAC,
    destinationEndpoint: endpoint,
    commandID: requireConstant(on ? COMMAND.SWITCH_ON : COMMAND.SWITCH_OFF, 'COMMAND.SWITCH_ON/OFF'),
  });
}

function buildDimmerSetValue({ transport, destinationMAC, endpoint, level }) {
  // Payload layout (e.g. single byte 0-100, or 0-255) is unconfirmed.
  return buildPacket({
    transport,
    destinationMAC,
    destinationEndpoint: endpoint,
    commandID: requireConstant(COMMAND.DIM, 'COMMAND.DIM'),
    payload: Buffer.from([level & 0xff]),
  });
}

function buildCurtainSetPosition({ transport, destinationMAC, endpoint, position }) {
  // Payload layout unconfirmed (percentage vs. raw motor steps).
  return buildPacket({
    transport,
    destinationMAC,
    destinationEndpoint: endpoint,
    commandID: requireConstant(COMMAND.CURTAIN_POSITION, 'COMMAND.CURTAIN_POSITION'),
    payload: Buffer.from([position & 0xff]),
  });
}

// Validated against github.com/firtman/bgh_smart's working local-UDP implementation (cross-checked
// with our own power-on/off capture): commandID=HVAC_COMMAND (0x61), destinationEndpoint=1,
// payload = [mode, fanSpeed, 0x00, tempLowByte, tempHighByte] when setting a temperature, or
// [mode, fanSpeed, 0x00, 0x00, 0x80] when only mode/fan matter. Pass HVAC_MODE.NO_CHANGE /
// HVAC_FAN_MODE.NO_CHANGE to leave that field alone (0xff is the device's own "don't touch" sentinel).
function buildHvacSetModes({ transport, destinationMAC, endpoint = 1, mode, fanSpeed, targetTempC }) {
  let tail;
  if (targetTempC === undefined) {
    tail = Buffer.from([0x00, 0x80]);
  } else {
    const tempRaw = Math.round(targetTempC * 100) & 0xffff;
    tail = Buffer.from([tempRaw & 0xff, (tempRaw >> 8) & 0xff]);
  }
  const payload = Buffer.concat([
    Buffer.from([
      mode === undefined ? HVAC_MODE.NO_CHANGE : mode,
      fanSpeed === undefined ? HVAC_FAN_MODE.NO_CHANGE : fanSpeed,
      0x00,
    ]),
    tail,
  ]);
  return buildPacket({
    transport,
    destinationMAC,
    destinationEndpoint: endpoint,
    commandID: requireConstant(COMMAND.HVAC_COMMAND, 'COMMAND.HVAC_COMMAND'),
    payload,
  });
}

// Confirmed against two real captures (power on then power off, same unit, same session): the
// app's plain on/off toggle is just buildHvacSetModes with mode=LAST_MODE/OFF and fan=NO_CHANGE.
function buildHvacPower({ transport, destinationMAC, endpoint = 1, on }) {
  return buildHvacSetModes({
    transport,
    destinationMAC,
    endpoint,
    mode: on ? HVAC_MODE.LAST_MODE : HVAC_MODE.OFF,
  });
}

// Confirmed: COMMAND.PING (0xe4) to destinationEndpoint=1 makes the unit broadcast a fresh
// STATUS_REPORT — this is how to prime current temperature/mode on startup instead of waiting for
// the next unsolicited broadcast.
function buildHvacStatusRequest({ transport, destinationMAC }) {
  return buildPing({ transport, destinationMAC });
}

// Parses a STATUS_REPORT broadcast's payload (the bytes after decodeHeader's 17-byte header) into
// mode/fan/temperature fields. Returns null for any other commandID.
function parseStatusReport(decodedPacket) {
  if (decodedPacket.commandID !== COMMAND.STATUS_REPORT) return null;
  const p = decodedPacket.payload;
  const o = HVAC_STATUS_PAYLOAD_OFFSETS;
  if (p.length < o.targetTempLE + 2) return null;
  return {
    mode: p[o.mode],
    fanSpeed: p[o.fanSpeed],
    ambientTempC: p.readUInt16LE(o.ambientTempLE) / 100,
    targetTempC: p.readUInt16LE(o.targetTempLE) / 100,
  };
}

function buildDoorlockSetValue({ transport, destinationMAC, endpoint, locked }) {
  return buildPacket({
    transport,
    destinationMAC,
    destinationEndpoint: endpoint,
    commandID: requireConstant(COMMAND.DOORLOCK, 'COMMAND.DOORLOCK'),
    payload: Buffer.from([
      requireConstant(locked ? COMMAND.DOORLOCK_LOCK : COMMAND.DOORLOCK_UNLOCK, 'COMMAND.DOORLOCK_LOCK/UNLOCK'),
    ]),
  });
}

function parsePacket(buf) {
  return decodeHeader(buf);
}

module.exports = {
  buildPing,
  buildEnumerateAll,
  parseEnumerateResponse,
  buildSwitchSetOnOff,
  buildHvacPower,
  buildHvacSetModes,
  buildHvacStatusRequest,
  parseStatusReport,
  buildDimmerSetValue,
  buildCurtainSetPosition,
  buildDoorlockSetValue,
  parsePacket,
};
