const fsPromises = require('fs').promises;
const path = require('path');
const pug = require('pug');
const url = require('url');

const source = process.env.DIRINDEX_SOURCE || path.resolve();
const destination = process.env.DIRINDEX_DESTINATION || path.resolve('build');
const webSiteName = process.env.DIRINDEX_SITENAME || 'Home';
const indexName = process.env.DIRINDEX_INDEXNAME || 'index.html';
const webRootURL = process.env.DIRINDEX_WEBROOT || url.pathToFileURL(destination);
const webExtraRoot = ['dirindex'];
const webScripts = webExtraRoot.concat(['scripts']);
const webImages = webExtraRoot.concat(['images']);
const webStyles = webExtraRoot.concat(['styles']);
const webAssetDir = 'webassets';
const assets = path.resolve(webAssetDir);

const baseOptions = {
  root: webRootURL,
  siteName: webSiteName,
  scripts: [webRootURL].concat(webScripts).join('/'),
  images: [webRootURL].concat(webImages).join('/'),
  styles: [webRootURL].concat(webStyles).join('/'),
  widthFileIcon: '32px',
  heightFileIcon: '32px',
};

const verboseLogger = {
  indentLevel: 0,
  message(mess) {
  // eslint-disable-next-line no-console
    console.log(mess);
  },
  debugMessage() {},
  paddedName(name) {
    return ' '.repeat(this.indentLevel) + name;
  },
  formattedEntry(name) {
    return this.paddedName(name);
  },
  formattedDir(dirName, parents, siblings, entries) {
    const dirHeader = `${this.paddedName(dirName)}/ ${parents.join(' --> ')} | [${siblings.join(', ')}]`;
    return [dirHeader].concat(entries).join('\n');
  },
  deeper() {
    return Object.assign({}, this, { indentLevel: this.indentLevel + 2 });
  },
};

const normalLogger = {
  message() {},
  debugMessage() {},
  paddedName() {},
  formattedEntry() {},
  formattedDir() {},
  deeper() { return this; },
};

const debugLogger = Object.assign(
  {},
  verboseLogger,
  {
    debugMessage(mess) {
      // eslint-disable-next-line no-console
      console.log(mess);
    },
  },
);

const topLog = ((level) => {
  switch (level) {
    case '1':
      return verboseLogger;
    case '2':
      return debugLogger;
    default:
      return normalLogger;
  }
})(process.env.DIRINDEX_VERBOSE);

const errorExit = function forceUntidyErrorExit(message) {
  throw Error(message);
};

const subTreeIndex = pug.compileFile(path.join(webAssetDir, 'subtreeindex.pug'), { basedir: assets });
const topLevelIndex = pug.compileFile(path.join(webAssetDir, 'toplevelindex.pug'), { basedir: assets });

const patternCopiedFiles = function copiedFilesMatchingRegExp(srcDir, dstDir, pattern, log) {
  return fsPromises.readdir(srcDir, { withFileTypes: true })
    .then(dirents => dirents.filter(entry => entry.isFile() && pattern.test(entry.name))
      .map((fileEntry) => {
        const src = path.join(srcDir, fileEntry.name);
        const dst = path.join(dstDir, fileEntry.name);
        return fsPromises.copyFile(src, dst);
      }))
    .then(copyList => Promise.all(copyList))
    .catch(errmes => log.message(errmes));
};

const joinedPath = function pathStringFromJoinedArray(root, pathList) {
  return (pathList).reduce(
    (fullPath, currentDir) => path.join(fullPath, currentDir),
    root,
  );
};

const purgedTree = function recursivelyDeletedDirectoryTree(victim, log) {
  return fsPromises.readdir(victim, { withFileTypes: true })
    .then(entries => entries.map((entry) => {
      const entryPath = path.join(victim, entry.name);
      if (entry.isDirectory()) {
        return purgedTree(entryPath, log.deeper());
      }
      return fsPromises.unlink(entryPath);
    }))
    .then(hitList => Promise.all(hitList))
    .then(() => fsPromises.rmdir(victim))
    .catch(errmes => log.message(errmes))
    .then(() => fsPromises.stat(victim))
    .then(
      () => errorExit(`Directory still exists: ${victim}`),
      () => log.debugMessage(`Deleted OK: ${victim}`),
    );
};

const doFileEntry = function processDirectoryFileEntry(name, entryPath, dstTree, webTree, log) {
  const encoded = encodeURIComponent(name);
  return fsPromises.symlink(entryPath, path.join(dstTree, name))
    .then(() => [
      { entryType: 'file', href: `${webTree}/${encoded}`, title: name },
      log.formattedEntry(name),
    ])
    .catch(errmes => log.message(`Problem processing file ${entryPath}: ${errmes}`));
};

const doSymlinkEntry = function processDirectorySymlinkEntry(name, entryPath, webTree, log) {
  fsPromises.realpath(entryPath)
    .then(actualEntry => Promise.all([
      fsPromises.readlink(entryPath),
      fsPromises.stat(actualEntry),
    ]))
    .then(([rel, stats]) => {
      const relURL = rel.split(path.sep).map(part => encodeURIComponent(part)).join('/');
      const relRef = (stats.isDirectory()) ? `${relURL}/${indexName}` : relURL;
      return [
        { entryType: 'link', href: `${webTree}/${relRef}`, title: name },
        log.formattedEntry(name),
      ];
    })
    .catch(errmes => log.message(`Problem processing symlink ${entryPath}: ${errmes}`));
};

const tupleEntryProcessor = function tupleDirectoryEntryProcessor(
  srcTree, dstTree, webTree, parents, siblings, log, doDirEntry,
) {
  return (entry) => {
    if (entry.name === indexName) {
      return [null, log.formattedEntry(entry.name)];
    }
    const entryPath = path.join(srcTree, entry.name);
    if (entry.isFile()) {
      return doFileEntry(entry.name, entryPath, dstTree, webTree, log);
    }
    if (entry.isSymbolicLink()) {
      return doSymlinkEntry(entry.name, entryPath, webTree, log);
    }
    if (entry.isDirectory()) {
      return doDirEntry(entry.name, parents, siblings, log);
    }
    return errorExit(`Cannot process ${entry.name} in ${srcTree}`);
  };
};

const webBreadcrumbs = function webBreadcrumbRefs(webRoot, parents) {
  return parents.reduce(
    (crumbs, dirName) => {
      const encoded = encodeURIComponent(dirName);
      if (crumbs.length === 0) {
        const refBase = `${webRoot}/${encoded}`;
        return [{ base: refBase, href: `${refBase}/${indexName}`, title: dirName }];
      }
      const currentBase = `${crumbs[crumbs.length - 1].base}/${encoded}`;
      return crumbs.concat([{ base: currentBase, href: `${currentBase}/${indexName}`, title: dirName }]);
    }, [],
  );
};

const webNavProcessor = function webNavRefProcessor(webContext, current) {
  return (navName) => {
    const encoded = encodeURIComponent(navName);
    if (navName === current) {
      return { href: '#', title: navName, active: true };
    }
    return { href: `${webContext}/${encoded}/${indexName}`, title: navName, active: false };
  };
};

const dirProcessor = function directoryTreeProcessor(srcRoot, dstRoot, webRoot) {
  const doDirEntry = (dirName, parents, siblings, log) => {
    const webDirName = encodeURIComponent(dirName);
    const nextParents = parents.concat([dirName]);
    const nextLog = log.deeper();
    const srcTree = joinedPath(srcRoot, nextParents);
    const dstTree = joinedPath(dstRoot, nextParents);
    const webAbove = [webRoot].concat(parents.map(encodeURIComponent)).join('/');
    const webTree = `${webAbove}/${webDirName}`;
    const navRefs = siblings.map(webNavProcessor(webAbove, dirName));
    const breadcrumbs = webBreadcrumbs(webRoot, parents);
    return fsPromises.mkdir(dstTree, { mode: 0o755 })
      .then(() => fsPromises.readdir(srcTree, { withFileTypes: true }))
      .then((entries) => {
        const nextSiblings = entries.filter(entry => entry.isDirectory())
          .map(dirEntry => dirEntry.name);
        return entries
          .map(tupleEntryProcessor(
            srcTree, dstTree, webTree, nextParents, nextSiblings, nextLog, doDirEntry,
          ));
      })
      .then(dirList => Promise.all(dirList))
      .then((tuples) => {
        const dirRefs = tuples.reduce(
          (tuple, webRefs) => ((tuple[0] === null)
            ? webRefs : webRefs.concat(tuple[0])),
          [],
        );
        const dirLogs = tuples.reduce(
          (tuple, logged) => (((tuple[1] === null) || (tuple[1] === undefined))
            ? logged : logged.concat(tuple[1])),
          [],
        );
        const locals = Object.assign({
          webDirName, breadcrumbs, navRefs, dirRefs,
        }, baseOptions);
        return Promise.all([
          fsPromises.writeFile(
            path.join(dstTree, indexName), subTreeIndex(locals), { mode: 0o644 },
          ),
          dirLogs,
        ]);
      })
      .then(([, subTreeLog]) => [
        { entryType: 'dir', href: `${webTree}/${indexName}`, title: dirName },
        log.formattedDir(dirName, parents, siblings, subTreeLog),
      ])
      .catch(errmes => log.message(`Problem processing directory ${srcTree}: ${errmes}`));
  };
  return doDirEntry;
};

const topLevelDir = function copiedTopLevelDataToDst(srcRoot, dstRoot, webRoot, log, processedDir) {
  return fsPromises.readdir(srcRoot, { withFileTypes: true })
    .then((entries) => {
      const nextSiblings = entries.filter(entry => entry.isDirectory())
        .map(dirEntry => dirEntry.name);
      return entries
        .map(tupleEntryProcessor(srcRoot, dstRoot, [], nextSiblings, log, processedDir));
    })
    .then(dirList => Promise.all(dirList))
    .then((tuples) => {
      const dirRefs = tuples.reduce(
        (tuple, webRefs) => ((tuple[0] === null)
          ? webRefs : webRefs.concat(tuple[0])),
        [],
      );
      const dirLogs = tuples.reduce(
        (tuple, logged) => (((tuple[1] === null) || (tuple[1] === undefined))
          ? logged : logged.concat(tuple[1])),
        [],
      );
      const locals = Object.assign({ dirRefs }, baseOptions);
      return Promise.all([
        fsPromises.writeFile(path.join(dstRoot, indexName), topLevelIndex(locals), { mode: 0o644 }),
        log.formattedDir(srcRoot, [], [], dirLogs),
      ]);
    })
    .catch(errmes => log.message(`Problem processing directory ${srcRoot}: ${errmes}`));
};

const placedWebAssets = function copiedSelectiveWebAssetsToDst(assetRoot, dst, log) {
  const scriptDir = joinedPath(dst, webScripts);
  const imageDir = joinedPath(dst, webImages);
  const styleDir = joinedPath(dst, webStyles);
  return patternCopiedFiles(assetRoot, dst, /\.ico$/, log)
    .then(() => Promise.all(
      [scriptDir, imageDir, styleDir]
        .map(dir => fsPromises.mkdir(dir, { mode: 0o755, recursive: true })),
    ))
    .then(() => Promise.all([
      patternCopiedFiles(assetRoot, scriptDir, /\.js$/, log),
      patternCopiedFiles(assetRoot, imageDir, /\.((png)|(jpg)|(svg))$/, log),
      patternCopiedFiles(assetRoot, styleDir, /\.css$/, log),
    ]))
    .catch(errmes => log.message(errmes));
};

const processedDirTree = dirProcessor(source, destination, webRootURL);

purgedTree(destination, topLog)
  .then(() => fsPromises.mkdir(destination, { mode: 0o755 }))
  .then(() => Promise.all([
    placedWebAssets(assets, destination, topLog),
    topLevelDir(source, destination, webRootURL, topLog.deeper(), processedDirTree)
      .then(([, dirLog]) => topLog.message(dirLog)),
  ]))
  .catch(errmes => topLog.message(errmes));
