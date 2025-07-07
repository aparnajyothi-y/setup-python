import * as core from '@actions/core';
import * as finder from './find-python';
import * as finderPyPy from './find-pypy';
import * as finderGraalPy from './find-graalpy';
import * as path from 'path';
import * as os from 'os';
import fs from 'fs';
import {getCacheDistributor} from './cache-distributions/cache-factory';
import {
  isCacheFeatureAvailable,
  logWarning,
  IS_MAC,
  getVersionInputFromFile,
  getVersionsInputFromPlainFile
} from './utils';

function isPyPyVersion(versionSpec: string) {
  return versionSpec.startsWith('pypy');
}

function isGraalPyVersion(versionSpec: string) {
  return versionSpec.startsWith('graalpy');
}
export async function cacheDependencies(cache: string, pythonVersion: string) {
  const userInputPath = core.getInput('cache-dependency-path') || undefined;
  let resolvedDependencyPath: string | undefined;

  if (userInputPath) {
    const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
    const actionPath = process.env.GITHUB_ACTION_PATH || '';

    const actionSourcePath = path.resolve(actionPath, userInputPath);
    const actionFileExists = await fs.promises
      .access(actionSourcePath, fs.constants.F_OK)
      .then(() => true)
      .catch(() => false);

    if (!actionFileExists) {
      core.warning(`Dependency file not found in action: ${actionSourcePath}`);
    } else {
      try {
        // Copy to a fixed subdir inside workspace
        const targetDir = path.join(workspace, '.github', '_generated');
        await fs.promises.mkdir(targetDir, {recursive: true});

        const fileName = path.basename(userInputPath);
        const copiedPath = path.join(targetDir, fileName);

        await fs.promises.copyFile(actionSourcePath, copiedPath);
        resolvedDependencyPath = path.relative(workspace, copiedPath).replace(/\\/g, '/');

        core.info(`Copied action file to workspace: ${copiedPath}`);
        core.info(`Resolved dependency path for cache: ${resolvedDependencyPath}`);
      } catch (err) {
        core.warning(`Failed to copy file from action to workspace: ${err}`);
      }
    }
  }

  const dependencyPathForCache = resolvedDependencyPath ?? userInputPath;

  const cacheDistributor = getCacheDistributor(
    cache,
    pythonVersion,
    dependencyPathForCache
  );
  await cacheDistributor.restoreCache();
}
function resolveVersionInputFromDefaultFile(): string[] {
  const couples: [string, (versionFile: string) => string[]][] = [
    ['.python-version', getVersionsInputFromPlainFile]
  ];
  for (const [versionFile, _fn] of couples) {
    logWarning(
      `Neither 'python-version' nor 'python-version-file' inputs were supplied. Attempting to find '${versionFile}' file.`
    );
    if (fs.existsSync(versionFile)) {
      return _fn(versionFile);
    } else {
      logWarning(`${versionFile} doesn't exist.`);
    }
  }
  return [];
}

function resolveVersionInput() {
  let versions = core.getMultilineInput('python-version');
  const versionFile = core.getInput('python-version-file');

  if (versions.length) {
    if (versionFile) {
      core.warning(
        'Both python-version and python-version-file inputs are specified, only python-version will be used.'
      );
    }
  } else {
    if (versionFile) {
      if (!fs.existsSync(versionFile)) {
        throw new Error(
          `The specified python version file at: ${versionFile} doesn't exist.`
        );
      }
      versions = getVersionInputFromFile(versionFile);
    } else {
      versions = resolveVersionInputFromDefaultFile();
    }
  }

  return versions;
}

async function run() {
  if (IS_MAC) {
    process.env['AGENT_TOOLSDIRECTORY'] = '/Users/runner/hostedtoolcache';
  }

  if (process.env.AGENT_TOOLSDIRECTORY?.trim()) {
    process.env['RUNNER_TOOL_CACHE'] = process.env['AGENT_TOOLSDIRECTORY'];
  }

  core.debug(
    `Python is expected to be installed into ${process.env['RUNNER_TOOL_CACHE']}`
  );
  try {
    const versions = resolveVersionInput();
    const checkLatest = core.getBooleanInput('check-latest');
    const allowPreReleases = core.getBooleanInput('allow-prereleases');
    const freethreaded = core.getBooleanInput('freethreaded');

    if (versions.length) {
      let pythonVersion = '';
      const arch: string = core.getInput('architecture') || os.arch();
      const updateEnvironment = core.getBooleanInput('update-environment');
      core.startGroup('Installed versions');
      for (const version of versions) {
        if (isPyPyVersion(version)) {
          const installed = await finderPyPy.findPyPyVersion(
            version,
            arch,
            updateEnvironment,
            checkLatest,
            allowPreReleases
          );
          pythonVersion = `${installed.resolvedPyPyVersion}-${installed.resolvedPythonVersion}`;
          core.info(
            `Successfully set up PyPy ${installed.resolvedPyPyVersion} with Python (${installed.resolvedPythonVersion})`
          );
        } else if (isGraalPyVersion(version)) {
          const installed = await finderGraalPy.findGraalPyVersion(
            version,
            arch,
            updateEnvironment,
            checkLatest,
            allowPreReleases
          );
          pythonVersion = `${installed}`;
          core.info(`Successfully set up GraalPy ${installed}`);
        } else {
          if (version.startsWith('2')) {
            core.warning(
              'The support for python 2.7 was removed on June 19, 2023. Related issue: https://github.com/actions/setup-python/issues/672'
            );
          }
          const installed = await finder.useCpythonVersion(
            version,
            arch,
            updateEnvironment,
            checkLatest,
            allowPreReleases,
            freethreaded
          );
          pythonVersion = installed.version;
          core.info(`Successfully set up ${installed.impl} (${pythonVersion})`);
        }
      }
      core.endGroup();
      const cache = core.getInput('cache');
      if (cache && isCacheFeatureAvailable()) {
        await cacheDependencies(cache, pythonVersion);
      }
    } else {
      core.warning(
        'The `python-version` input is not set.  The version of Python currently in `PATH` will be used.'
      );
    }
    const matchersPath = path.join(__dirname, '../..', '.github');
    core.info(`##[add-matcher]${path.join(matchersPath, 'python.json')}`);
  } catch (err) {
    core.setFailed((err as Error).message);
  }
}

run();
