#!/usr/bin/env node
// Standalone sanity check for the reimplemented discovery protocol — no Homebridge needed.
// Broadcasts COMMAND.JOIN/ENUMERATE_ALL on the LAN and prints every BGH device that replies.
//
// Usage: node tools/discover.js

const { UdpTransport } = require('../src/transport/udpTransport');
const { scanForDevices } = require('../src/discovery');

async function main() {
  const transport = new UdpTransport({ log: console });
  await transport.start();
  console.log('Listening on UDP :20911, broadcasting ENUMERATE_ALL...');
  try {
    const devices = await scanForDevices({ transport });
    if (devices.length === 0) {
      console.log('No devices responded. Check NETWORK.* in src/protocol/constants.js and that you are on the right LAN.');
    } else {
      console.log(`\nFound ${devices.length} device(s):`);
      for (const d of devices) {
        console.log(`  ${d.ip}  ${d.mac}  ${d.model}  fw ${d.firmwareVersion}`);
      }
    }
  } finally {
    transport.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
