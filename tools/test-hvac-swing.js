#!/usr/bin/env node
// End-to-end sanity check for the tentative swing flag (see constants.js HVAC_SWING_FLAG), no
// Homebridge involved. Watch the real unit while running this — swing is tentative/unconfirmed.
// Usage:
//   node tools/test-hvac-swing.js <mac> <ip> <on|off>
// Example:
//   node tools/test-hvac-swing.js aa:bb:cc:dd:ee:ff 192.168.1.50 on

const { UdpTransport } = require('../src/transport/udpTransport');
const { macFromString } = require('../src/protocol/haCommandHeader');
const { buildHvacSetModes, buildHvacSwingOnTrigger } = require('../src/protocol/haCommand');
const { HVAC_MODE, HVAC_FAN_MODE, HVAC_SWING_FLAG } = require('../src/protocol/constants');

async function main() {
  const [mac, ip, state] = process.argv.slice(2);
  if (!mac || !ip || !['on', 'off'].includes(state)) {
    console.error('Usage: node tools/test-hvac-swing.js <mac> <ip> <on|off>');
    process.exit(1);
  }

  const transport = new UdpTransport({ log: console });
  await transport.start();

  const macBuf = macFromString(mac);
  const acks = [];
  transport.onMessage((decoded, rinfo) => {
    console.log(
      `<- from ${rinfo.address}: commandID=0x${decoded.commandID.toString(16)} ` +
        `seq=${decoded.sequenceNumber} payload=${decoded.payload.toString('hex')}`,
    );
    if (decoded.commandID === 0x80) acks.push(decoded.sequenceNumber);
  });

  const on = state === 'on';
  const packet = buildHvacSetModes({
    transport,
    destinationMAC: macBuf,
    endpoint: 1,
    mode: HVAC_MODE.NO_CHANGE,
    fanSpeed: HVAC_FAN_MODE.NO_CHANGE,
    swing: on ? HVAC_SWING_FLAG.ON : HVAC_SWING_FLAG.OFF,
  });
  console.log(`-> sending swing ${state} to ${ip} (${mac}): ${packet.toString('hex')}`);
  await transport.sendTo(packet, ip);

  if (on) {
    await new Promise((r) => setTimeout(r, 300));
    const trigger = buildHvacSwingOnTrigger({ transport, destinationMAC: macBuf, endpoint: 1 });
    console.log(`-> sending swing-on trigger: ${trigger.toString('hex')}`);
    await transport.sendTo(trigger, ip);
  }

  await new Promise((r) => setTimeout(r, 3000));
  console.log(acks.length ? `\n${acks.length} ACK(s) received — now go look at the unit.` : '\nNo ACK within 3s.');
  transport.stop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
