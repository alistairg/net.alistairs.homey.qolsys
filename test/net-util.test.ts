import { describe, it, expect } from 'vitest';
import { stripPort } from '../lib/NetUtil';

describe('stripPort', () => {
  it('strips :port from IPv4 addresses', () => {
    expect(stripPort('192.168.1.50:8080')).toBe('192.168.1.50');
    expect(stripPort('10.0.0.1:443')).toBe('10.0.0.1');
    expect(stripPort('255.255.255.255:1')).toBe('255.255.255.255');
  });

  it('returns IPv4 unchanged when there is no port', () => {
    expect(stripPort('192.168.1.50')).toBe('192.168.1.50');
    expect(stripPort('10.0.0.1')).toBe('10.0.0.1');
  });

  it('strips :port from hostnames', () => {
    expect(stripPort('homey.local:8080')).toBe('homey.local');
    expect(stripPort('alarm-panel.local:8883')).toBe('alarm-panel.local');
  });

  it('returns hostname unchanged when there is no port', () => {
    expect(stripPort('homey.local')).toBe('homey.local');
    expect(stripPort('alarm-panel.local')).toBe('alarm-panel.local');
  });

  it('does not mangle plain (unbracketed) IPv6 addresses', () => {
    // The whole point of this function: a naive replace(/:.*$/, '') would
    // strip everything after the first colon and corrupt IPv6.
    expect(stripPort('::1')).toBe('::1');
    expect(stripPort('fe80::1')).toBe('fe80::1');
    expect(stripPort('2001:db8::1')).toBe('2001:db8::1');
    expect(stripPort('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8:85a3::8a2e:370:7334');
  });

  it('strips brackets from bracketed IPv6 addresses', () => {
    expect(stripPort('[::1]')).toBe('::1');
    expect(stripPort('[fe80::1]')).toBe('fe80::1');
    expect(stripPort('[2001:db8::1]')).toBe('2001:db8::1');
  });

  it('returns empty/falsy inputs unchanged', () => {
    expect(stripPort('')).toBe('');
  });
});
