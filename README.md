# homebridge-bgh-smartcontrol

Unofficial, local-only Homebridge plugin for BGH/Solidmation "Smart Control" HVAC units
(BGH-7012 confirmed; likely compatible with other BGH-70xx/HPA44xx models sharing the same
firmware family). Built for interoperability with hardware the user already owns — not affiliated
with BGH or Solidmation.

## Status: working, validated against real hardware

The local protocol ("HACommand", a custom binary format over UDP) was reverse-engineered from the
official app's .NET metadata, then confirmed byte-for-byte with a real packet capture against 4
BGH-7012 units, and cross-validated against two independent open-source projects:
[firtman/bgh_smart](https://github.com/firtman/bgh_smart) (a working local-UDP Home Assistant
integration) and [sbehrends/homebridge-bgh-smart](https://github.com/sbehrends/homebridge-bgh-smart)
(a cloud-API Homebridge plugin whose endpoint value-type IDs independently confirm the same
mode/fan/temperature semantics).

Confirmed and implemented:
- **Discovery**: broadcast enumeration finds every unit on the LAN by MAC/IP and reports its model
  and firmware string (tested: found all 4 real units).
- **Status**: request-and-parse (and passive broadcast listening) for mode, fan speed, ambient
  temperature, and target temperature (tested against real hardware).
- **Control**: power on/off, mode (off/cool/heat/dry/fan/auto), fan speed, and target temperature
  (power on/off tested live against real hardware and visually confirmed; mode/fan/temp payload
  layout is cross-validated against firtman/bgh_smart's independently-working implementation but
  not separately captured by us).

Not implemented: switch/dimmer/curtain/lock command payloads (`src/protocol/haCommand.js` has
stubs with placeholder command IDs in `src/protocol/constants.js` — this app controls HVAC units
only, so those were never captured).

## How the protocol works

- UDP port 20910 (devices listen) / 20911 (app listens), both broadcast and unicast.
- Every packet starts with a 17-byte `HACommandHeader`: protocol version (always 0x00), 6-byte
  source MAC (the app identifies itself as `00:00:00:00:00:00`), 6-byte destination MAC (device's
  real MAC, or `ff:ff:ff:ff:ff:ff` for broadcast), sequence number, source endpoint, destination
  endpoint, command ID.
- Discovery: command `0xa1` (JOIN) with payload `[0x04]` (ENUMERATE_ALL) broadcast; each device
  replies with the same command ID and payload `[0x02, ...ASCII "<Model>,<firmware>"]`.
- HVAC control: command `0x61` to destinationEndpoint `1`, payload
  `[mode, fanSpeed, 0x00, tempLowByte, tempHighByte]` (or `[mode, fanSpeed, 0x00, 0x00, 0x80]` to
  leave the temperature alone). `mode`/`fanSpeed` can be `0xff` ("don't change"); mode `0xfd` means
  "turn on, resume whatever mode was last active" — what the official app's plain on/off toggle sends.
- Status: devices periodically (and in reply to a `0xe4` PING to endpoint 1) broadcast command
  `0xfd` (STATUS_REPORT) with mode/fan/ambient-temp/target-temp in the payload.

See `src/protocol/constants.js` and `src/protocol/haCommand.js` for the exact byte layouts, each
commented with how it was confirmed.

## Try it without Homebridge

```bash
node tools/discover.js                                   # list every unit on the LAN
node tools/test-status.js <mac> <ip>                      # read a unit's current status
node tools/test-hvac-power.js <mac> <ip> on|off           # turn a unit on/off directly
```

## Configuration

Devices are configured manually in Homebridge's `config.json` (the platform also logs every
discovered device's MAC/IP/model at startup, to make this easy to fill in):

```json
{
  "platforms": [
    {
      "platform": "BGHSmartControl",
      "devices": [
        { "name": "Living Room AC", "type": "hvac", "mac": "ac:cf:23:a8:aa:6e", "ip": "192.168.86.210" }
      ]
    }
  ]
}
```

Supported `type` values: `hvac` (full Thermostat service — tested), `switch`, `dimmer`, `curtain`,
`lock` (untested stubs, see Status above).

## Install

```bash
npm install
npm link
# then enable the plugin in Homebridge's config.json / Config UI X
```
