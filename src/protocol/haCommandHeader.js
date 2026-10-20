const { MAC_LENGTH_BYTES } = require('./constants');

// Field order and sizes, CONFIRMED byte-for-byte against a real capture of the official app
// discovering 4 BGH-7012 units (see tools/decode-capture.js output in captures/smartcontrol_home.pcap):
// every packet's bytes 1-6 decoded as sourceMAC matched the sender's real MAC from the LAN's ARP
// table exactly, and bytes 7-12 (destinationMAC) were ff:ff:ff:ff:ff:ff for every broadcast query
// and the real target MAC for every unicast command.
const FIELDS = [
  { name: 'protocolVersion', size: 1 },
  { name: 'sourceMAC', size: MAC_LENGTH_BYTES },
  { name: 'destinationMAC', size: MAC_LENGTH_BYTES },
  { name: 'sequenceNumber', size: 1 },
  { name: 'sourceEndpoint', size: 1 },
  { name: 'destinationEndpoint', size: 1 },
  { name: 'commandID', size: 1 },
];

const HEADER_LENGTH_BYTES = FIELDS.reduce((sum, f) => sum + f.size, 0);

function encodeHeader(fields) {
  const buf = Buffer.alloc(HEADER_LENGTH_BYTES);
  let offset = 0;
  for (const { name, size } of FIELDS) {
    const value = fields[name];
    if (value === undefined) {
      throw new Error(`HACommandHeader: missing field "${name}"`);
    }
    if (size === 1) {
      buf.writeUInt8(value & 0xff, offset);
    } else if (Buffer.isBuffer(value) || Array.isArray(value)) {
      Buffer.from(value).copy(buf, offset, 0, size);
    } else {
      throw new Error(`HACommandHeader: unsupported value for field "${name}"`);
    }
    offset += size;
  }
  return buf;
}

function decodeHeader(buf) {
  if (buf.length < HEADER_LENGTH_BYTES) {
    throw new Error(
      `HACommandHeader: buffer too short (${buf.length} < ${HEADER_LENGTH_BYTES} bytes)`,
    );
  }
  const result = {};
  let offset = 0;
  for (const { name, size } of FIELDS) {
    if (size === 1) {
      result[name] = buf.readUInt8(offset);
    } else {
      result[name] = Buffer.from(buf.subarray(offset, offset + size));
    }
    offset += size;
  }
  result.payload = Buffer.from(buf.subarray(HEADER_LENGTH_BYTES));
  return result;
}

function macToString(macBuf) {
  return Buffer.from(macBuf).toString('hex').match(/.{1,2}/g).join(':');
}

function macFromString(macStr) {
  return Buffer.from(macStr.split(':').map((b) => parseInt(b, 16)));
}

module.exports = {
  FIELDS,
  HEADER_LENGTH_BYTES,
  encodeHeader,
  decodeHeader,
  macToString,
  macFromString,
};
