import { afterEach, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { clipboardAvailability } from '../tools/desktop-clipboard.ts';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); });

it('allows clipboard checks when the native clipboard can be opened', () => {
  vi.mocked(execFileSync).mockReturnValue('{"available":true,"code":0}');
  expect(clipboardAvailability()).toEqual({ available: true });
  expect(execFileSync).toHaveBeenCalledWith(expect.stringMatching(/WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/u),
    expect.arrayContaining([expect.stringContaining('CloseClipboard')]), expect.objectContaining({ windowsHide: true }));
});

it('reports an explicit environment skip reason for access denied instead of throwing', () => {
  vi.mocked(execFileSync).mockReturnValue('{"available":false,"code":5}');
  expect(clipboardAvailability()).toEqual({ available: false, reason: expect.stringContaining('OpenClipboard error 5') });
});

it.each(['invalid JSON', '{}'])('does not claim clipboard availability from a failed probe: %s', output => {
  vi.mocked(execFileSync).mockReturnValue(output);
  expect(clipboardAvailability()).toEqual({ available: false, reason: expect.stringContaining('Could not check') });
});

it('reports inability to run the native probe without aborting the rest of the smoke checks', () => {
  vi.mocked(execFileSync).mockImplementation(() => { throw new Error('No window station'); });
  expect(clipboardAvailability()).toMatchObject({ available: false, reason: expect.stringContaining('interactive desktop') });
});
