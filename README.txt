Connect a Qolsys IQ Panel (IQ Panel 2/2+, IQ Panel 4, or IQ Pro) to Homey. Partitions appear as alarm-panel devices and zones (door/window, motion, smoke, CO, water, glass break) appear as sensors. Arm and disarm via flow cards, react to zone changes in your automations, see live tamper, battery and signal-strength updates.

The app talks to the panel locally over its built-in MQTT broker using mutual-TLS, so no cloud or external broker is required.

This is an unofficial integration and is not affiliated with or endorsed by Qolsys.

Built on protocol research and reference implementations by Eric Hylands — github.com/EHylands/QolsysController and github.com/EHylands/ha-qolsys-panel. If you run Home Assistant, use Eric's integration directly.
