#!/usr/bin/env node
// Minimal pure-JS libpcap reader for analyzing a tcpdump capture of BGH Smart Control traffic.
// No dependencies (tshark/Wireshark aren't required). Usage:
//   node tools/decode-capture.js /path/to/capture.pcap [--port 12345] [--host 192.168.1.50]
//
// Prints, per UDP datagram: timestamp, src/dst ip:port, length, and a hex+ASCII dump of the
// payload, so it can be compared by hand against HACommandHeader's known field layout
// (protocolVersion, sourceMAC, destinationMAC, sequenceNumber, sourceEndpoint,
// destinationEndpoint, commandID) to confirm wire order, sizes, and command byte values.

const fs = require('fs');

function parseArgs(argv) {
  const args = { file: null, port: null, host: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') args.port = Number(argv[++i]);
    else if (argv[i] === '--host') args.host = argv[++i];
    else if (!args.file) args.file = argv[i];
  }
  if (!args.file) {
    console.error('Usage: decode-capture.js <capture.pcap> [--port N] [--host IP]');
    process.exit(1);
  }
  return args;
}

function hexDump(buf) {
  const lines = [];
  for (let i = 0; i < buf.length; i += 16) {
    const chunk = buf.subarray(i, i + 16);
    const hex = Array.from(chunk, (b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(chunk, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`  ${i.toString(16).padStart(4, '0')}  ${hex.padEnd(47)}  ${ascii}`);
  }
  return lines.join('\n');
}

function ipToString(buf, offset) {
  return `${buf[offset]}.${buf[offset + 1]}.${buf[offset + 2]}.${buf[offset + 3]}`;
}

function* readPackets(buf) {
  if (buf.length < 24) throw new Error('File too small to be a pcap capture');
  const magic = buf.readUInt32LE(0);
  let littleEndian;
  if (magic === 0xa1b2c3d4 || magic === 0xa1b23c4d) littleEndian = true;
  else if (magic === 0xd4c3b2a1 || magic === 0x4d3cb2a1) littleEndian = false;
  else throw new Error(`Unrecognized pcap magic number: 0x${magic.toString(16)} (pcapng is not supported)`);

  const read32 = (off) => (littleEndian ? buf.readUInt32LE(off) : buf.readUInt32BE(off));
  const linkType = read32(20);
  if (linkType !== 1) {
    console.error(`Warning: link-layer type ${linkType} is not Ethernet (1); parsing may be wrong.`);
  }

  let offset = 24;
  while (offset + 16 <= buf.length) {
    const tsSec = read32(offset);
    const tsUsec = read32(offset + 4);
    const inclLen = read32(offset + 8);
    offset += 16;
    if (offset + inclLen > buf.length) break;
    yield { tsSec, tsUsec, data: buf.subarray(offset, offset + inclLen) };
    offset += inclLen;
  }
}

function parseEthernetIPv4UDP(frame) {
  if (frame.length < 14) return null;
  const etherType = frame.readUInt16BE(12);
  let ipOffset = 14;
  if (etherType === 0x8100) ipOffset += 4; // 802.1Q VLAN tag
  else if (etherType !== 0x0800) return null; // not IPv4

  const ihl = (frame[ipOffset] & 0x0f) * 4;
  const protocol = frame[ipOffset + 9];
  if (protocol !== 17) return null; // not UDP

  const srcIp = ipToString(frame, ipOffset + 12);
  const dstIp = ipToString(frame, ipOffset + 16);
  const udpOffset = ipOffset + ihl;
  const srcPort = frame.readUInt16BE(udpOffset);
  const dstPort = frame.readUInt16BE(udpOffset + 2);
  const udpLen = frame.readUInt16BE(udpOffset + 4);
  const payload = frame.subarray(udpOffset + 8, udpOffset + udpLen);

  return { srcIp, srcPort, dstIp, dstPort, payload };
}

function main() {
  const { file, port, host } = parseArgs(process.argv.slice(2));
  const buf = fs.readFileSync(file);
  let count = 0;
  let shown = 0;
  for (const pkt of readPackets(buf)) {
    const udp = parseEthernetIPv4UDP(pkt.data);
    if (!udp) continue;
    count++;
    if (port && udp.srcPort !== port && udp.dstPort !== port) continue;
    if (host && udp.srcIp !== host && udp.dstIp !== host) continue;
    if (udp.payload.length === 0) continue;
    shown++;
    const date = new Date(pkt.tsSec * 1000 + Math.round(pkt.tsUsec / 1000));
    console.log(
      `\n#${shown} ${date.toISOString()}  ${udp.srcIp}:${udp.srcPort} -> ${udp.dstIp}:${udp.dstPort}  (${udp.payload.length} bytes)`,
    );
    console.log(hexDump(udp.payload));
  }
  console.error(`\n${count} UDP datagrams total, ${shown} shown with a non-empty payload.`);
  if (!port && !host) {
    console.error('Tip: once you spot the BGH hub/app conversation, re-run with --port/--host to filter.');
  }
}

main();
