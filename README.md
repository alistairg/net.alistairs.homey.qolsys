# Qolsys IQ Panel for Homey

A Homey app that connects to a Qolsys IQ Panel (IQ Panel 2/2+, IQ Panel 4, IQ Pro) over the panel's built-in MQTT broker, so partitions and zones appear as Homey devices. The connection is local and uses mutual-TLS — no external broker, no cloud required.

## What you get

- Partitions as Homey alarm-panel devices: arm away / arm stay / disarm via flow cards
- Zones as Homey sensor devices: door/window contacts, motion, smoke, CO, water, glass break, etc.
- Live updates: zone state, alarm state, tamper, low battery, signal strength
- Standard Homey flow triggers fire when zones change state — wire up automations as you would for any contact or motion sensor

## Acknowledgements

This app would not exist without the work of **[Eric Hylands](https://github.com/EHylands)**, who reverse-engineered the Qolsys IQ Remote protocol and published two reference implementations:

- **[QolsysController](https://github.com/EHylands/QolsysController)** — Python library implementing the protocol (MIT licensed)
- **[ha-qolsys-panel](https://github.com/EHylands/ha-qolsys-panel)** — Home Assistant custom integration built on top of QolsysController

Every protocol detail in this app — the pairing flow, the MQTT topic layout, the IPC-wrapped arm/disarm commands, the ContentProvider URI parsing, the certificate format — was learned from those two repos. Where this app's behaviour differs from the upstream Python implementation, it's because the JavaScript SDK shape made a different approach more natural; the protocol logic itself is faithful to Eric's work.

If you run Home Assistant rather than (or alongside) Homey, **use Eric's integration directly** — it's the canonical implementation.

## Status & support

Hobbyist project, best effort, no SLA. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to file bugs and feature requests, and [SECURITY.md](SECURITY.md) for the private vulnerability disclosure path.

## Licence

[GPL-3.0](LICENSE).
