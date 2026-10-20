// Names recovered from SolidApp.dll (Solidmation.Mobile.Core.UDPHandling.HACommand_Constants /
// HACommand_Join_Constants / UDPResponseCodes) via static .NET metadata inspection. Numeric
// values below were then CONFIRMED (or left UNKNOWN) against a real tcpdump capture of the
// official app on this Mac discovering 4 real BGH-7012 units on the home LAN
// (~/Documents/SmartControlRE/captures/smartcontrol_home.pcap, decoded with
// tools/decode-capture.js). Each confirmed value is commented with how it was observed.
//
// Fill in a value only after seeing it on the wire; do not guess. `null` means "unknown".

const UNKNOWN = null;

const COMMAND = {
  RSP_ACK: 0x80, // tentative: device's zero-payload reply to cmd 0xE4 (see PING)
  RSP_NAK: UNKNOWN,
  DEBUG: UNKNOWN,
  STATUS_REPORT: 0xfd, // confirmed: periodic self-announced HVAC status broadcast (all 4 units)
  PING: 0xe4, // tentative: app->device unicast, destinationEndpoint=1, empty payload, ACK'd with 0x80
  PING_REPLY: UNKNOWN,
  POLL: UNKNOWN,
  JOIN: 0xa1, // confirmed: discovery query (payload [0x04]) and its per-device reply (payload [0x02, model-string])
  RSP_JOINED: UNKNOWN,
  ACTIVATE_SCENE: UNKNOWN,
  CUSTOM_COMMAND: UNKNOWN,
  REBOOT: UNKNOWN,
  LEAVE: UNKNOWN,
  UPGRADE: UNKNOWN,
  CURTAIN_POSITION: UNKNOWN,
  CURTAIN_UP_AND_STOP: UNKNOWN,
  CURTAIN_DOWN_AND_STOP: UNKNOWN,
  CURTAIN_STOP: UNKNOWN,
  HVAC_SET_MODE: UNKNOWN, // mode/temp SET payload layout not captured yet, only power on/off
  HVAC_COMMAND: 0x61, // confirmed: destinationEndpoint=1, payload [powerByte, 0xff, 0xff, 0x00, 0x80]
  SWITCH_ON: UNKNOWN,
  SWITCH_OFF: UNKNOWN,
  DIM: UNKNOWN,
  AUTO_OFF: UNKNOWN,
  FADE_RATE: UNKNOWN,
  DOORLOCK: UNKNOWN,
  DOORLOCK_LOCK: UNKNOWN,
  DOORLOCK_UNLOCK: UNKNOWN,
  CHANGE_CHANNEL: UNKNOWN,
};

const JOIN_SUBCOMMAND = {
  ENUMERATE: UNKNOWN,
  ENUMERATE_RESPONSE: 0x02, // confirmed: reply payload is [0x02, ...ASCII "<Model>,<firmware>"]
  ENUMERATE_ALL: 0x04, // confirmed: query payload the app broadcasts to find every device
  JOIN: UNKNOWN,
  SCAN: UNKNOWN,
  SCAN_RESPONSE: UNKNOWN,
  GET_CLOUD_NOTIFICATION_IP: UNKNOWN,
  SET_CLOUD_NOTIFICATION_IP: UNKNOWN,
  KEY_REQUEST: UNKNOWN,
  SET_KEY: 0x0c, // tentative: sent unicast right after discovery, to the device's real MAC, no reply payload observed beyond ACK
  SUBSCRIBE: UNKNOWN,
  UNSUBSCRIBE: UNKNOWN,
};

const RESPONSE_CODE = {
  NONE: UNKNOWN,
  JOIN_ENUMERATE_RESPONSE: UNKNOWN,
  JOIN_SCAN_RESPONSE_STARTED: UNKNOWN,
  JOIN_SWITCH_CLOUD_RESPONSE: UNKNOWN,
  JOIN_JOIN_RESPONSE: UNKNOWN,
};

// Confirmed from the capture: the app listens on 20911, devices listen on 20910, and discovery
// is sent both as true broadcast (x.x.x.255 and x.x.x.0) AND as individual unicast to every host
// in the /24 (SendToAllAddressesOfBroadCast iterating the whole subnet, exactly as the decompiled
// method name suggested).
const NETWORK = {
  SERVER_PORT: 20910,
  CLIENT_PORT: 20911,
  BROADCAST_ADDRESS: UNKNOWN, // sender used both x.x.x.255 and x.x.x.0; null here means "use local /24 .255" (see udpTransport.js)
};

// Standard Ethernet MAC length; HACommandHeader fields are byte arrays of unconfirmed length.
const MAC_LENGTH_BYTES = 6;

// Confirmed from a captured ON/OFF pair sent to a real BGH-7012 (destinationEndpoint=1,
// commandID=COMMAND.HVAC_COMMAND): only the first payload byte differs between power states,
// the rest (0xff 0xff 0x00 0x80) was identical in both captures.
const HVAC_POWER_PAYLOAD_SUFFIX = Buffer.from([0xff, 0xff, 0x00, 0x80]);
const HVAC_POWER_ON_BYTE = 0xfd;
const HVAC_POWER_OFF_BYTE = 0x00;

// Cross-confirmed against two independent open-source reverse-engineering projects the user
// pointed us to (github.com/firtman/bgh_smart — a working local-UDP Home Assistant integration —
// and github.com/sbehrends/homebridge-bgh-smart — a cloud-API Homebridge plugin whose endpoint
// value-type IDs match these same semantics). Both agree with each other and with our own capture.
const HVAC_MODE = {
  OFF: 0x00,
  COOL: 0x01,
  HEAT: 0x02,
  DRY: 0x03,
  FAN: 0x04,
  AUTO: 0xfe,
  LAST_MODE: 0xfd, // "turn on, resume whatever mode was last active" — what the app's plain on/off toggle sends
  NO_CHANGE: 0xff,
};

const HVAC_FAN_MODE = {
  LOW: 0x01,
  MEDIUM: 0x02,
  HIGH: 0x03,
  AUTO: 0xfe,
  NO_CHANGE: 0xff,
};

// firtman/bgh_smart's const.py says 16-30, but the user confirmed their real BGH-7012 units only
// accept 17-30 — trust the hardware over the reference project here.
const HVAC_TEMP_RANGE_C = { min: 17, max: 30 };

// HACommand_StatusHVAC broadcast payload (confirmed against our own captures), as bytes
// *after* the 17-byte header: [0]=report tag (always seen as 0x06), [1]=mode (HVAC_MODE),
// [2]=fan speed (HVAC_FAN_MODE), [3]=unused/0, [4:6]=ambient temp *100 LE u16,
// [6:8]=target temp *100 LE u16, [8:12]=unused/0.
const HVAC_STATUS_PAYLOAD_OFFSETS = {
  reportTag: 0,
  mode: 1,
  fanSpeed: 2,
  ambientTempLE: 4,
  targetTempLE: 6,
};

module.exports = {
  COMMAND,
  JOIN_SUBCOMMAND,
  RESPONSE_CODE,
  NETWORK,
  MAC_LENGTH_BYTES,
  HVAC_POWER_PAYLOAD_SUFFIX,
  HVAC_POWER_ON_BYTE,
  HVAC_POWER_OFF_BYTE,
  HVAC_MODE,
  HVAC_FAN_MODE,
  HVAC_TEMP_RANGE_C,
  HVAC_STATUS_PAYLOAD_OFFSETS,
  UNKNOWN,
};
