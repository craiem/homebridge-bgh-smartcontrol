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
- **Control**: power on/off, mode (off/cool/heat/auto — HomeKit's Thermostat service has no
  dry/fan-only equivalent), fan speed (auto/low/medium/high, exposed as a separate Fanv2 service),
  swing (exposed as that same Fanv2 service's `SwingMode`, inside the accessory's settings screen —
  Apple's Home app doesn't surface it in the quick-control sheet), and target temperature. Power
  on/off and swing were tested live against real hardware and visually confirmed; mode/fan/temp
  payload layout is cross-validated against firtman/bgh_smart's independently-working implementation.

Swing is newer and less battle-tested than the rest: confirmed by toggling it on/off from the
official app while capturing the traffic, then replaying both values (plus command `0x62`'s
trigger, needed to actually start the motor) against one real unit. Only tested on a single unit in
a single session — watch the real unit the first few times you use it. See `HVAC_SWING_FLAG` and
`HVAC_SWING_ON_TRIGGER_PAYLOAD` in `src/protocol/constants.js` for details and caveats.

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
  `[mode, fanSpeed, swingFlag, tempLowByte, tempHighByte]` (or `[mode, fanSpeed, swingFlag, 0x00, 0x80]`
  to leave the temperature alone). `mode`/`fanSpeed` can be `0xff` ("don't change"); mode `0xfd` means
  "turn on, resume whatever mode was last active" — what the official app's plain on/off toggle sends.
  `swingFlag` is `0x00`/`0x10` for off/on (no "don't change" sentinel confirmed yet, so every command
  should carry the unit's full desired state, matching how the official app itself operates).
- Swing: enabling it also requires command `0x62` to destinationEndpoint `1` with payload `[0x51]`,
  sent once right after the `0x61` command that carries `swingFlag = 0x10`.
- Status: devices periodically (and in reply to a `0xe4` PING to endpoint 1) broadcast command
  `0xfd` (STATUS_REPORT) with mode/fan/ambient-temp/target-temp in the payload.

See `src/protocol/constants.js` and `src/protocol/haCommand.js` for the exact byte layouts, each
commented with how it was confirmed.

## Try it without Homebridge

```bash
node tools/discover.js                                   # list every unit on the LAN
node tools/test-status.js <mac> <ip>                      # read a unit's current status
node tools/test-hvac-power.js <mac> <ip> on|off           # turn a unit on/off directly
node tools/test-hvac-swing.js <mac> <ip> on|off           # toggle swing directly (watch the unit)
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
        { "name": "Living Room AC", "type": "hvac", "mac": "aa:bb:cc:dd:ee:ff", "ip": "192.168.1.50" }
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
