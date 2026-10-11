import { afterEach, describe, expect, it } from 'vitest';
import { captureJoinFromUrl, clearJoin, startJoin } from './joinState';

describe('captureJoinFromUrl', () => {
  afterEach(() => {
    clearJoin();
    history.replaceState(null, '', '/');
  });
  it('remembers the trip and removes the parameter from the URL', () => {
    history.replaceState(null, '', '/app/?join=t-1&x=2#h');
    captureJoinFromUrl();
    expect(sessionStorage.getItem('logbook.join')).toBe('{"tripId":"t-1"}');
    expect(location.search).toBe('?x=2');
    expect(location.hash).toBe('#h');
  });
  it('does nothing without parameter', () => {
    history.replaceState(null, '', '/?x=2');
    captureJoinFromUrl();
    expect(sessionStorage.getItem('logbook.join')).toBeNull();
  });
  it('startJoin without trip marks a plain join', () => {
    startJoin();
    expect(sessionStorage.getItem('logbook.join')).toBe('{}');
  });
});
