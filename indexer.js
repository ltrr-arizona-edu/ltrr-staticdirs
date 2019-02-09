"use strict";

const fsPromises = require("fs").promises;
const path = require("path");
const pug = require("pug");
const url = require('url');

const source = process.env.DIRINDEX_SOURCE || path.resolve();
const destination = process.env.DIRINDEX_DESTINATION || path.resolve('build');
const homeDir = process.env.DIRINDEX_HOMEDIR || 'home';
const indexName = process.env.DIRINDEX_INDEXNAME || 'index.html';
const webRoot = process.env.DIRINDEX_WEBROOT || url.pathToFileURL(destination);
const webExtraRoot = ['dirindex'];
const webScripts = webExtraRoot.concat(['scripts']);
const webImages = webExtraRoot.concat(['images']);
const webStyles = webExtraRoot.concat(['styles']);
const webAssetDir = 'webassets';
const assets = path.resolve(webAssetDir);

const baseOptions = {
  root: webRoot,
  scripts: [webRoot].concat(webScripts).join('/'),
  images: [webRoot].concat(webImages).join('/'),
  styles: [webRoot].concat(webStyles).join('/'),
  widthFileIcon: '32px',
  heightFileIcon: '32px'
}

const subTreeIndex = pug.compileFile(path.join(webAssetDir, 'subtreeindex.pug'), {basedir: assets });

const paddedName = function whiteSpacePaddedName (name, indentLevel) {
  return ' '.repeat(indentLevel) + name;
}

const patternCopiedFiles = function copiedFilesMatchingRegExp (srcDir, dstDir, pattern) {
  return fsPromises.readdir(srcDir, { withFileTypes: true })
  .then(dirents => {
    return dirents.filter(entry => entry.isFile() && pattern.test(entry.name))
      .map(fileEntry => fsPromises.copyFile(path.join(srcDir, fileEntry.name), path.join(dstDir, fileEntry.name)));
  })
  .then(copyList => Promise.all(copyList))
  .catch(errmes => console.log(errmes))
}

const joinedPath = function pathStringFromJoinedArray (root, pathList) {
  return (pathList).reduce(
    (fullPath, currentDir) => path.join(fullPath, currentDir),
    root
  );
}

const purgedTree = function recursivelyDeletedDirectoryTree (victim) {
  return fsPromises.readdir(victim, { withFileTypes: true })
  .then(entries => entries.map(entry => {
    const entryPath = path.join(victim, entry.name);
    if (entry.isDirectory()) {
      return purgedTree(entryPath);
    }
    return fsPromises.unlink(entryPath);
  }))
  .then(hitList => Promise.all(hitList))
  .then(() => fsPromises.rmdir(victim))
  .catch(errmes => console.log(errmes))
  .then(() => fsPromises.stat(victim))
  .then(() => {throw `Directory still exists: ${victim}`}, () => console.log(`Deleted OK: ${victim}`))
}

const entryProcessor = function directoryEntryProcessor (srcTree, dstTree, parents, siblings, indentLevel) {
  return (entry) => {
    if (encodeURIComponent(entry.name) === indexName) {
      return '';
    }
    if (entry.isFile()) {
      return fsPromises.symlink(path.join(srcTree, entry.name), path.join(dstTree, entry.name))
      .then(() => paddedName(entry.name, indentLevel));
    }
    if (entry.isDirectory()) {
      return processedDir(entry.name, parents, siblings, indentLevel);
    }
    throw `Cannot process ${entry.name} in ${srcTree}`
  }
}

const webBreadcrumbs = function webBreadcrumbRefs (webRoot, parents) {
  return parents.reduce(
    (crumbs, dirName) => {
      const encoded = encodeURIComponent(dirName);
      if (crumbs.length === 0) {
        const refBase = `${webRoot}/${encoded}`;
        return [ { base: refBase, href: `${refBase}/${indexName}`, title: dirName } ];
      }
      const currentBase = `${crumbs[crumbs.length - 1].base}/${encoded}`;
      return crumbs.concat([ { base: currentBase, href: `${currentBase}/${indexName}`, title: dirName } ]);
    }, []
  );
}

const webNavProcessor = function webNavRefProcessor (webContext, current) {
  return (navName) => {
    const encoded = encodeURIComponent(navName);
    if (navName === current) {
      return { href: '#', title: navName, active: true };
    }
    return { href: `${webContext}/${encoded}/${indexName}`, title: navName, active: false };
  }
}

const webDirProcessor = function webDirRefProcessor (webTree) {
  return (entry) => {
    const encoded = encodeURIComponent(entry.name);
    if (encoded === indexName) {
      return { entryType: 'index' };
    }
    if (entry.isFile()) {
      return { entryType: 'file', href: `${webTree}/${encoded}`, title: entry.name };
    }
    if (entry.isDirectory()) {
      return { entryType: 'dir', href: `${webTree}/${encoded}/${indexName}`, title: entry.name };
    }
    throw `Cannot add ${entry.name} to ${webTree}`
  }
}

const dirProcessor = function directoryTreeProcessor (srcRoot, dstRoot, webRoot) {
  return (dirName, parents, siblings, indentLevel) => {
    const webDirName = dirName;
    const nextParents = parents.concat([dirName]);
    const nextIndent = indentLevel + 2;
    const srcTree = joinedPath(srcRoot, nextParents);
    const dstTree = joinedPath(dstRoot, nextParents);
    const webAbove = [webRoot].concat(parents.map(encodeURIComponent)).join('/');
    const webTree = `${webAbove}/${webDirName}`;
    const navRefs = siblings.map(webNavProcessor(webAbove, dirName));
    const breadcrumbs = webBreadcrumbs(webRoot, parents);
    return fsPromises.mkdir(dstTree, { mode: 0o755})
    .then(() => fsPromises.readdir(srcTree, { withFileTypes: true }))
    .then(rawEntries => {
      const dirRefs = rawEntries.map(webDirProcessor(webTree));
      const locals = Object.assign({ webDirName: webDirName, breadcrumbs: breadcrumbs, navRefs: navRefs, dirRefs: dirRefs }, baseOptions);
      fsPromises.writeFile(path.join(dstTree, indexName), subTreeIndex(locals), { mode: 0o644});
      return rawEntries;
    })
    .then(entries => {
      const nextSiblings = entries.filter(entry => entry.isDirectory()).map(dirEntry => dirEntry.name);
      return entries.map(entryProcessor(srcTree, dstTree, nextParents, nextSiblings, nextIndent));
    })
    .then(dirList => Promise.all(dirList))
    .then(resolvedTree => {
      const dirHeader = `${paddedName(dirName, indentLevel)}/ ${parents.join(' --> ')} | [${siblings.join(', ')}]`;
      return [dirHeader].concat(resolvedTree).join("\n")
    })
    .catch(errmes => console.log(errmes));
  }
}

const placedWebAssets = function copySelectiveWebAssetsToDst(assetRoot, dst) {
  const scriptDir = joinedPath(dst, webScripts);
  const imageDir = joinedPath(dst, webImages);
  const styleDir = joinedPath(dst, webStyles);
  return patternCopiedFiles(assetRoot, dst, /\.ico$/)
  .then(() => Promise.all(
    [scriptDir, imageDir, styleDir].map(dir => fsPromises.mkdir(dir, { mode: 0o755, recursive: true}))
  ))
  .then(() => Promise.all([
    patternCopiedFiles(assetRoot, scriptDir, /\.js$/),
    patternCopiedFiles(assetRoot, imageDir, /\.((png)|(jpg)|(svg))$/),
    patternCopiedFiles(assetRoot, styleDir, /\.css$/)
  ]))
  .catch(errmes => console.log(errmes));
}

const processedDir = dirProcessor(source, destination, webRoot);

purgedTree(destination)
.then(() => fsPromises.mkdir(destination, { mode: 0o755}))
.then(() => Promise.all([
  placedWebAssets(assets, destination),
  processedDir(homeDir, [], [], 0).then(dirLog => console.log(dirLog))
]))
.catch(errmes => console.log(errmes));
