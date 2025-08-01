import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import {cacheDependencies} from '../src/setup-python';
import {getCacheDistributor} from '../src/cache-distributions/cache-factory';

jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs');
  return {
    ...actualFs,
    promises: {
      access: jest.fn(),
      mkdir: jest.fn(),
      copyFile: jest.fn(),
      writeFile: jest.fn(),
      appendFile: jest.fn()
    }
  };
});
jest.mock('@actions/core');
jest.mock('../src/cache-distributions/cache-factory');
jest.mock('crypto', () => ({
  randomUUID: jest.fn(() => '12345678-9abc-def0-1234-56789abcdef0')
}));

const mockedFsPromises = fs.promises as jest.Mocked<typeof fs.promises>;
const mockedCore = core as jest.Mocked<typeof core>;
const mockedGetCacheDistributor = getCacheDistributor as jest.Mock;
const {randomUUID} = require('crypto');

describe('cacheDependencies', () => {
  const mockRestoreCache = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GITHUB_ACTION_PATH = '/github/action';
    process.env.GITHUB_WORKSPACE = '/github/workspace';
    mockedCore.getInput.mockReturnValue('nested/deps.lock');

    mockedFsPromises.mkdir.mockResolvedValue(undefined);
    mockedFsPromises.copyFile.mockResolvedValue(undefined);

    mockedGetCacheDistributor.mockReturnValue({restoreCache: mockRestoreCache});
    (randomUUID as jest.Mock).mockReturnValue(
      '12345678-9abc-def0-1234-56789abcdef0'
    );
  });

  it('copies to temp folder on conflict and resolves correct path', async () => {
    mockedFsPromises.access.mockImplementation(async p => {
      const filePath = typeof p === 'string' ? p : p.toString();
      if (
        filePath === '/github/action/nested/deps.lock' ||
        filePath === '/github/workspace/deps.lock'
      ) {
        return Promise.resolve(); // Source and conflict path exists
      }
      if (filePath === '/github/workspace/.tmp-cache-deps-12345678/deps.lock') {
        return Promise.resolve(); // File appears after copy
      }
      return Promise.reject(new Error('Not found'));
    });

    await cacheDependencies('pip', '3.12');

    const source = '/github/action/nested/deps.lock';
    const target = '/github/workspace/.tmp-cache-deps-12345678/deps.lock';

    expect(mockedFsPromises.copyFile).toHaveBeenCalledWith(source, target);
    expect(mockedCore.info).toHaveBeenCalledWith(
      `Copied ${source} to ${target}`
    );
    expect(mockedCore.info).toHaveBeenCalledWith(
      `Resolved cache-dependency-path: .tmp-cache-deps-12345678/deps.lock`
    );
    expect(mockRestoreCache).toHaveBeenCalled();
  });

  it('copies preserving relative structure if no conflict', async () => {
    mockedFsPromises.access.mockImplementation(async p => {
      const filePath = typeof p === 'string' ? p : p.toString();
      if (filePath === '/github/action/nested/deps.lock') {
        return Promise.resolve(); // Source exists
      }
      if (filePath === '/github/workspace/deps.lock') {
        return Promise.reject(new Error('No conflict')); // No conflict
      }
      if (filePath === '/github/workspace/nested/deps.lock') {
        return Promise.resolve(); // Exists after copy
      }
      return Promise.reject(new Error('Not found'));
    });

    await cacheDependencies('pip', '3.12');

    const target = '/github/workspace/nested/deps.lock';
    expect(mockedFsPromises.copyFile).toHaveBeenCalled();
    expect(mockedCore.info).toHaveBeenCalledWith(
      expect.stringContaining('Copied')
    );
    expect(mockedCore.info).toHaveBeenCalledWith(
      'Resolved cache-dependency-path: nested/deps.lock'
    );
    expect(mockRestoreCache).toHaveBeenCalled();
  });

  it('warns if file does not exist', async () => {
    mockedFsPromises.access.mockRejectedValue(new Error('Not found'));

    await cacheDependencies('pip', '3.12');

    expect(mockedCore.warning).toHaveBeenCalledWith(
      expect.stringContaining('does not exist')
    );
    expect(mockRestoreCache).not.toHaveBeenCalled();
    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Dependency file does not exist')
    );
  });

  it('handles copy error gracefully and still validates fallback path', async () => {
    mockedFsPromises.access.mockImplementation(async p => {
      const filePath = typeof p === 'string' ? p : p.toString();
      if (filePath === '/github/action/nested/deps.lock') {
        return Promise.resolve();
      }
      if (filePath === '/github/workspace/nested/deps.lock') {
        return Promise.resolve(); // Used as fallback after failed copy
      }
      return Promise.reject(new Error('No access'));
    });

    mockedFsPromises.copyFile.mockRejectedValue(new Error('Permission denied'));

    await cacheDependencies('pip', '3.12');

    expect(mockedCore.warning).toHaveBeenCalledWith(
      expect.stringContaining('Failed to copy file')
    );
    expect(mockedCore.setOutput).toHaveBeenCalledWith(
      'resolvedDependencyPath',
      'nested/deps.lock'
    );
    expect(mockRestoreCache).toHaveBeenCalled();
  });

  it('skips all logic if input not provided', async () => {
    mockedCore.getInput.mockReturnValue('');

    await cacheDependencies('pip', '3.12');

    expect(mockedFsPromises.copyFile).not.toHaveBeenCalled();
    expect(mockRestoreCache).not.toHaveBeenCalled();
  });

  it('fails if final dependency path check fails', async () => {
    mockedFsPromises.access.mockImplementation(async p => {
      const filePath = typeof p === 'string' ? p : p.toString();
      if (filePath === '/github/action/nested/deps.lock') {
        return Promise.resolve();
      }
      if (filePath === '/github/workspace/nested/deps.lock') {
        return Promise.reject(new Error('Does not exist'));
      }
      return Promise.reject(new Error('no access'));
    });

    await cacheDependencies('pip', '3.12');

    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Dependency file does not exist at:')
    );
    expect(mockRestoreCache).not.toHaveBeenCalled();
  });
});
