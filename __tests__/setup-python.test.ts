import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {cacheDependencies} from '../src/setup-python';
import {getCacheDistributor} from '../src/cache-distributions/cache-factory';

jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs');
  return {
    ...actualFs,
    promises: {
      access: jest.fn(),
      mkdir: jest.fn(),
      mkdtemp: jest.fn(),
      copyFile: jest.fn(),
      writeFile: jest.fn(),
      appendFile: jest.fn()
    }
  };
});
jest.mock('@actions/core');
jest.mock('../src/cache-distributions/cache-factory');

const mockedFsPromises = fs.promises as jest.Mocked<typeof fs.promises>;
const mockedCore = core as jest.Mocked<typeof core>;
const mockedGetCacheDistributor = getCacheDistributor as jest.Mock;

describe('cacheDependencies', () => {
  const mockRestoreCache = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GITHUB_ACTION_PATH = '/github/action';
    process.env.GITHUB_WORKSPACE = '/github/workspace';

    mockedCore.getInput.mockReturnValue('nested/deps.lock');

    mockedGetCacheDistributor.mockReturnValue({restoreCache: mockRestoreCache});
    mockedFsPromises.copyFile.mockResolvedValue(undefined);
    mockedFsPromises.mkdtemp.mockResolvedValue(
      '/tmp/setup-python-cache-abc123'
    );
  });

  it('copies the file to a temp directory if source exists', async () => {
    mockedFsPromises.access.mockImplementation(async filePath => {
      if (filePath === '/github/action/nested/deps.lock') {
        return Promise.resolve();
      }
      throw new Error('not found');
    });

    await cacheDependencies('pip', '3.12');

    const sourcePath = '/github/action/nested/deps.lock';
    const expectedTarget = '/tmp/setup-python-cache-abc123/deps.lock';

    expect(mockedFsPromises.copyFile).toHaveBeenCalledWith(
      sourcePath,
      expectedTarget
    );
    expect(mockedCore.info).toHaveBeenCalledWith(
      `Copied ${sourcePath} to isolated temp location: ${expectedTarget}`
    );
  });

  it('logs warning if source file does not exist', async () => {
    mockedFsPromises.access.mockRejectedValue(new Error('not found'));

    await cacheDependencies('pip', '3.12');

    expect(mockedCore.warning).toHaveBeenCalledWith(
      expect.stringContaining('does not exist')
    );
    expect(mockedFsPromises.copyFile).not.toHaveBeenCalled();
  });

  it('logs warning if copyFile fails', async () => {
    mockedFsPromises.access.mockResolvedValue();
    mockedFsPromises.copyFile.mockRejectedValue(new Error('copy failed'));

    await cacheDependencies('pip', '3.12');

    expect(mockedCore.warning).toHaveBeenCalledWith(
      expect.stringContaining('Failed to copy file')
    );
  });

  it('skips everything if cache-dependency-path is not provided', async () => {
    mockedCore.getInput.mockReturnValue('');

    await cacheDependencies('pip', '3.12');

    expect(mockedFsPromises.copyFile).not.toHaveBeenCalled();
    expect(mockedCore.warning).not.toHaveBeenCalled();
  });
});
