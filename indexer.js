const fsPromises = require('fs').promises;
const path = require('path');
const pug = require('pug');
const url = require('url');

const source = process.env.DIRINDEX_SOURCE || path.resolve();
const destination = process.env.DIRINDEX_DESTINATION || path.resolve('build');
const webSiteName = process.env.DIRINDEX_SITENAME || 'Home';
const indexName = process.env.DIRINDEX_INDEXNAME || 'index.html';
const webRootURL = process.env.DIRINDEX_WEBROOT || url.pathToFileURL(destination);
// eslint-disable-next-line no-console, no-unused-vars
const logMessage = (process.env.DIRINDEX_QUIET) ? (mess => undefined) : (mess => console.log(mess));
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

const errorExit = function forceUntidyErrorExit(message) {
  throw Error(message);
};

const subTreeIndex = pug.compileFile(path.join(webAssetDir, 'subtreeindex.pug'), { basedir: assets });
const topLevelIndex = pug.compileFile(path.join(webAssetDir, 'toplevelindex.pug'), { basedir: assets });

const paddedName = function whiteSpacePaddedName(name, indentLevel) {
  return ' '.repeat(indentLevel) + name;
};

const patternCopiedFiles = function copiedFilesMatchingRegExp(srcDir, dstDir, pattern) {
  return fsPromises.readdir(srcDir, { withFileTypes: true })
    .then(dirents => dirents.filter(entry => entry.isFile() && pattern.test(entry.name))
      .map((fileEntry) => {
        const src = path.join(srcDir, fileEntry.name);
        const dst = path.join(dstDir, fileEntry.name);
        return fsPromises.copyFile(src, dst);
      }))
    .then(copyList => Promise.all(copyList))
    .catch(errmes => logMessage(errmes));
};

const joinedPath = function pathStringFromJoinedArray(root, pathList) {
  return (pathList).reduce(
    (fullPath, currentDir) => path.join(fullPath, currentDir),
    root,
  );
};

const purgedTree = function recursivelyDeletedDirectoryTree(victim) {
  return fsPromises.readdir(victim, { withFileTypes: true })
    .then(entries => entries.map((entry) => {
      const entryPath = path.join(victim, entry.name);
      if (entry.isDirectory()) {
        return purgedTree(entryPath);
      }
      return fsPromises.unlink(entryPath);
    }))
    .then(hitList => Promise.all(hitList))
    .then(() => fsPromises.rmdir(victim))
    .catch(errmes => logMessage(errmes))
    .then(() => fsPromises.stat(victim))
    .then(
      () => errorExit(`Directory still exists: ${victim}`),
      () => logMessage(`Deleted OK: ${victim}`),
    );
};

const relinkedTree = function recursivelyFixedSymbolicLinkTree(srcTree, dstTree) {
  return fsPromises.readdir(srcTree, { withFileTypes: true })
    .then(entries => entries.map((entry) => {
      const entryPath = path.join(srcTree, entry.name);
      const destPath = path.join(dstTree, entry.name);
      if (entry.isDirectory()) {
        return relinkedTree(entryPath, destPath);
      }
      if (entry.isSymbolicLink()) {
        return fsPromises.realpath(entryPath)
          .then(actualEntry => Promise.all([
            fsPromises.readlink(entryPath),
            fsPromises.stat(actualEntry),
          ]))
          .then((linkInfo) => {
            const rel = linkInfo[0];
            const stats = linkInfo[1];
            if (stats.isDirectory()) {
              const relIndex = path.join(rel, indexName);
              return fsPromises.unlink(destPath)
                .then(() => fsPromises.symlink(relIndex, destPath))
                .then(() => `Fixed ${entryPath} --> ${relIndex}`);
            }
            return `Skipped ${rel}`;
          })
          .catch(errmes => logMessage(errmes));
      }
      return `Ignored ${entry.name}`;
    }))
    .then(fixList => Promise.all(fixList))
    .then(logs => logs.join('\n'))
    .catch(errmes => logMessage(errmes));
};

const linkProcessor = function symbolicLinkEntryProcessor(srcTree, dstTree) {
  return name => fsPromises.realpath(path.join(srcTree, name))
    .then(real => fsPromises.symlink(real, path.join(dstTree, name)))
    .catch(errmes => logMessage(errmes));
};

const entryProcessor = function directoryEntryProcessor(
  srcTree, dstTree, parents, siblings, indentLevel, processedLink, processedDir,
) {
  return (entry) => {
    if (encodeURIComponent(entry.name) === indexName) {
      return paddedName(entry.name, indentLevel);
    }
    const entryPath = path.join(srcTree, entry.name);
    if (entry.isFile()) {
      return fsPromises.symlink(entryPath, path.join(dstTree, entry.name))
        .then(() => paddedName(entry.name, indentLevel));
    }
    if (entry.isSymbolicLink()) {
      return processedLink(entry.name)
        .then(() => paddedName(entry.name, indentLevel));
    }
    if (entry.isDirectory()) {
      return processedDir(entry.name, parents, siblings, indentLevel);
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

const webDirProcessor = function webDirRefProcessor(webTree) {
  return (entry) => {
    const encoded = encodeURIComponent(entry.name);
    if (encoded === indexName) {
      return { entryType: 'index' };
    }
    if (entry.isFile()) {
      return { entryType: 'file', href: `${webTree}/${encoded}`, title: entry.name };
    }
    if (entry.isSymbolicLink()) {
      return { entryType: 'link', href: `${webTree}/${encoded}`, title: entry.name };
    }
    if (entry.isDirectory()) {
      return { entryType: 'dir', href: `${webTree}/${encoded}/${indexName}`, title: entry.name };
    }
    return errorExit(`Cannot add ${entry.name} to ${webTree}`);
  };
};

const dirProcessor = function directoryTreeProcessor(srcRoot, dstRoot, webRoot) {
  const processedDir = (dirName, parents, siblings, indentLevel) => {
    const webDirName = dirName;
    const nextParents = parents.concat([dirName]);
    const nextIndent = indentLevel + 2;
    const srcTree = joinedPath(srcRoot, nextParents);
    const dstTree = joinedPath(dstRoot, nextParents);
    const webAbove = [webRoot].concat(parents.map(encodeURIComponent)).join('/');
    const webTree = `${webAbove}/${webDirName}`;
    const navRefs = siblings.map(webNavProcessor(webAbove, dirName));
    const breadcrumbs = webBreadcrumbs(webRoot, parents);
    const processedLink = linkProcessor(srcTree, dstTree);
    return fsPromises.mkdir(dstTree, { mode: 0o755 })
      .then(() => fsPromises.readdir(srcTree, { withFileTypes: true }))
      .then((rawEntries) => {
        const dirRefs = rawEntries.map(webDirProcessor(webTree));
        const locals = Object.assign({
          webDirName, breadcrumbs, navRefs, dirRefs,
        }, baseOptions);
        fsPromises.writeFile(path.join(dstTree, indexName), subTreeIndex(locals), { mode: 0o644 });
        return rawEntries;
      })
      .then((entries) => {
        const nextSiblings = entries.filter(entry => entry.isDirectory())
          .map(dirEntry => dirEntry.name);
        return entries
          .map(entryProcessor(
            srcTree, dstTree, nextParents, nextSiblings, nextIndent, processedLink, processedDir,
          ));
      })
      .then(dirList => Promise.all(dirList))
      .then((resolvedTree) => {
        const dirHeader = `${paddedName(dirName, indentLevel)}/ ${parents.join(' --> ')} | [${siblings.join(', ')}]`;
        return [dirHeader].concat(resolvedTree).join('\n');
      })
      .catch(errmes => logMessage(errmes));
  };
  return processedDir;
};

const topLevelDir = function copiedTopLevelDataToDst(srcRoot, dstRoot, webRoot, processedDir) {
  const processedLink = linkProcessor(srcRoot, dstRoot);
  return fsPromises.readdir(srcRoot, { withFileTypes: true })
    .then((rawEntries) => {
      const dirRefs = rawEntries.map(webDirProcessor(webRoot));
      const locals = Object.assign({ dirRefs }, baseOptions);
      fsPromises.writeFile(path.join(dstRoot, indexName), topLevelIndex(locals), { mode: 0o644 });
      return rawEntries;
    })
    .then((entries) => {
      const nextSiblings = entries.filter(entry => entry.isDirectory())
        .map(dirEntry => dirEntry.name);
      return entries
        .map(entryProcessor(srcRoot, dstRoot, [], nextSiblings, 0, processedLink, processedDir));
    })
    .then(dirList => Promise.all(dirList))
    .then(resolvedTree => resolvedTree.join('\n'))
    .catch(errmes => logMessage(errmes));
};

const placedWebAssets = function copiedSelectiveWebAssetsToDst(assetRoot, dst) {
  const scriptDir = joinedPath(dst, webScripts);
  const imageDir = joinedPath(dst, webImages);
  const styleDir = joinedPath(dst, webStyles);
  return patternCopiedFiles(assetRoot, dst, /\.ico$/)
    .then(() => Promise.all(
      [scriptDir, imageDir, styleDir]
        .map(dir => fsPromises.mkdir(dir, { mode: 0o755, recursive: true })),
    ))
    .then(() => Promise.all([
      patternCopiedFiles(assetRoot, scriptDir, /\.js$/),
      patternCopiedFiles(assetRoot, imageDir, /\.((png)|(jpg)|(svg))$/),
      patternCopiedFiles(assetRoot, styleDir, /\.css$/),
    ]))
    .catch(errmes => logMessage(errmes));
};

const processedDirTree = dirProcessor(source, destination, webRootURL);

purgedTree(destination)
  .then(() => fsPromises.mkdir(destination, { mode: 0o755 }))
  .then(() => Promise.all([
    placedWebAssets(assets, destination),
    topLevelDir(source, destination, webRootURL, processedDirTree)
      .then(dirLog => logMessage(dirLog)),
  ]))
  .then(() => relinkedTree(source, destination))
  .then(linkLog => logMessage(linkLog))
  .catch(errmes => logMessage(errmes));
