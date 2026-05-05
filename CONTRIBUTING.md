# Contributing

Thanks for your interest in this app. A few things to know upfront:

## Maintainer expectations

This is a hobbyist project I maintain in spare time. **Best effort, no SLA.** I read every issue but may not respond quickly, and I prioritise fixes by personal severity. PRs from others are very welcome and tend to land faster than feature requests.

## Filing a bug

Before opening an issue:

- Check existing open and closed issues for similar reports
- Make sure your Homey, the app, and any related apps are up to date
- Confirm the bug is in this app, not in Homey itself or another app

A useful bug report includes:

- What you were trying to do
- What you expected to happen
- What actually happened
- Detailed steps to reproduce from a known-good state
- Relevant log output (please redact credentials, IPs, MAC addresses, and any home-identifying info first)
- Your Homey model + firmware version, this app's version

## Filing a feature request

- The current behaviour
- The desired behaviour
- Why this matters — what problem does it solve in a real automation?
- If possible, where in the code you'd expect the change to land

I'll be honest about what I can/can't take on; many feature requests are closed with a "not planned, but PRs welcome" message. That's not a brush-off — it's an invitation.

## Submitting a PR

- Open a discussion or issue first if the change is non-trivial, so we can agree on the approach before you sink time into it
- Run `npm run build` and confirm no TypeScript errors before pushing
- Run `homey app validate --level publish` before pushing
- Match the existing code style — no need to introduce a new linter or framework
- One logical change per PR

## Security issues

If you've found a security vulnerability, please **don't** file it as a public issue. See [SECURITY.md](SECURITY.md) for the private disclosure path.

## Licence

By contributing you agree that your contributions are licensed under the same [GPL-3.0 licence](LICENSE) as the rest of the project.
