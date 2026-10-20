#!/usr/bin/env node
// End-to-end sanity check: send our reimplemented HVAC power command straight to a real device,
// no Homebridge involved. Usage:
//   node tools/test-hvac-power.js <mac> <ip> <on|off>
// Example:
//   node tools/test-hvac-power.js aa:bb:cc:dd:ee:ff 192.168.1.50 on

const { UdpTransport } = require('../src/transport/udpTransport');
const { macFromString } = require('../src/protocol/haCommandHeader');
const { buildHvacPower, parsePacket } = require('../src/protocol/haCommand');

async function main() {
  const [mac, ip, state] = process.argv.slice(2);
  if (!mac || !ip || !['on', 'off'].includes(state)) {
    console.error('Usage: node tools/test-hvac-power.js <mac> <ip> <on|off>');
    process.exit(1);
  }

  const transport = new UdpTransport({ log: console });
  await transport.start();

  const gotAck = new Promise((resolve) => {
    transport.onMessage((decoded, rinfo) => {
      console.log(
        `<- from ${rinfo.address}: commandID=0x${decoded.commandID.toString(16)} ` +
          `seq=${decoded.sequenceNumber} payload=${decoded.payload.toString('hex')}`,
      );
      if (decoded.commandID === 0x80) resolve(true);
    });
  });

  const packet = buildHvacPower({ transport, destinationMAC: macFromString(mac), endpoint: 1, on: state === 'on' });
  console.log(`-> sending to ${ip} (${mac}): ${packet.toString('hex')}`);
  await transport.sendTo(packet, ip);

  const acked = await Promise.race([gotAck, new Promise((r) => setTimeout(() => r(false), 3000))]);
  console.log(acked ? '\nACK received — command accepted.' : '\nNo ACK within 3s.');
  transport.stop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
