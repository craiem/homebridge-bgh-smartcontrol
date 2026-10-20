#!/usr/bin/env node
// Requests a fresh status broadcast from a real device and parses it, to validate
// buildHvacStatusRequest/parseStatusReport end to end. Usage:
//   node tools/test-status.js <mac> <ip>

const { UdpTransport } = require('../src/transport/udpTransport');
const { macFromString } = require('../src/protocol/haCommandHeader');
const { buildHvacStatusRequest, parsePacket, parseStatusReport } = require('../src/protocol/haCommand');

async function main() {
  const [mac, ip] = process.argv.slice(2);
  if (!mac || !ip) {
    console.error('Usage: node tools/test-status.js <mac> <ip>');
    process.exit(1);
  }

  const transport = new UdpTransport({ log: console });
  await transport.start();

  transport.onMessage((decoded, rinfo) => {
    const status = parseStatusReport(decoded);
    if (!status) return;
    console.log(`Status from ${rinfo.address}:`, {
      mode: `0x${status.mode.toString(16)}`,
      fanSpeed: status.fanSpeed,
      ambientTempC: status.ambientTempC,
      targetTempC: status.targetTempC,
    });
  });

  const packet = buildHvacStatusRequest({ transport, destinationMAC: macFromString(mac) });
  await transport.sendTo(packet, ip);

  await new Promise((r) => setTimeout(r, 2000));
  transport.stop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
