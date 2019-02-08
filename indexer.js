"use strict";

const fsPromises = require("fs").promises;
const path = require("path");
const pug = require("pug");

const indexName = 'index.html';

const baseOptions = {
  webRoot: '',
  scripts: 'dirindex/scripts',
  images: 'dirindex/images',
  styles: 'dirindex/styles',
  widthFileIcon: '3rem',
  heightFileIcon: '3rem',

}

const subTreeIndex = pug.compileFile('webassets/subtreeindex.pug', {basedir: path.resolve('webassets') });

const paddedName = function whiteSpacePaddedName (name, indentLevel) {
  return ' '.repeat(indentLevel) + name;
}

const joinedPath = function pathStringFromJoinedArray (root, pathList) {
  return (pathList).reduce(
    (fullPath, currentDir) => path.join(fullPath, currentDir),
    root
  );
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
        return [ { base: refBase, href: `${refBase}/${indexName}`, title: encoded } ];
      }
      const currentBase = `${crumbs[crumbs.length - 1].base}/${encoded}`;
      return crumbs.concat([ { base: currentBase, href: `${currentBase}/${indexName}`, title: encoded } ]);
    }, []
  );
}

const webNavProcessor = function webNavRefProcessor (webContext, current) {
  return (navName) => {
    const encoded = encodeURIComponent(navName);
    if (navName === current) {
      return { href: '#', title: encoded, active: true };
    }
    return { href: `${webContext}/${encoded}/${indexName}`, title: encoded, active: false };
  }
}

const webDirProcessor = function webDirRefProcessor (webTree) {
  return (entry) => {
    const encoded = encodeURIComponent(entry.name);
    if (encoded === indexName) {
      return { entryType: 'index' };
    }
    if (entry.isFile()) {
      return { entryType: 'file', href: `${webTree}/${encoded}`, title: encoded };
    }
    if (entry.isDirectory()) {
      return { entryType: 'dir', href: `${webTree}/${encoded}/${indexName}`, title: encoded };
    }
    throw `Cannot add ${entry.name} to ${webTree}`
  }
}

const dirProcessor = function directoryTreeProcessor (srcRoot, dstRoot, webRoot) {
  return (dirName, parents, siblings, indentLevel) => {
    const webDirName = encodeURIComponent(dirName);
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

const processedDir = dirProcessor(path.resolve(), path.resolve('/tmp/dirindexdata'), baseOptions.webRoot);
processedDir('home', [], [], 0).then(dirLog => console.log(dirLog));
