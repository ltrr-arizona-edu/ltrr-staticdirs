"use strict";

const fsPromises = require("fs").promises;
const path = require("path");

const indexName = 'index.html';

const paddedName = function whiteSpacePaddedName (name, indent) {
  return ' '.repeat(indent) + name;
}

const joinedPath = function pathStringFromJoinedArray (root, pathList) {
  return (pathList).reduce(
    (fullPath, currentDir) => path.join(fullPath, currentDir),
    root
  );
}

const entryProcessor = function directoryEntryProcessor (srcTree, dstTree, parents, siblings, indent) {
  return (entry) => {
    if (entry.name === indexName) {
      return '';
    }
    if (entry.isFile()) {
      return fsPromises.symlink(path.join(srcTree, entry.name), path.join(dstTree, entry.name))
      .then(() => paddedName(entry.name, indent));
    }
    if (entry.isDirectory()) {
      return processedDir(entry.name, parents, siblings, indent);
    }
  }
}

const dirProcessor = function directoryTreeProcessor (srcRoot, dstRoot) {
  return (dirName, parents, siblings, indent) => {
    const nextParents = parents.concat([dirName]);
    const nextIndent = indent + 2;
    const srcTree = joinedPath(srcRoot, nextParents);
    const dstTree = joinedPath(dstRoot, nextParents);
    return fsPromises.mkdir(dstTree, { mode: 0o755})
    .then(() => fsPromises.readdir(srcTree, { withFileTypes: true }))
    .then(entries => {
      const nextSiblings = entries.filter(entry => entry.isDirectory()).map(dirEntry => dirEntry.name);
      const processedEntry = entryProcessor(srcTree, dstTree, nextParents, nextSiblings, nextIndent);
      return entries.map(processedEntry)
    })
    .then(dirList => Promise.all(dirList))
    .then(resolvedTree => {
      const dirHeader = `${paddedName(dirName, indent)}/ ${parents.join(' --> ')} | [${siblings.join(', ')}]`;
      return [dirHeader].concat(resolvedTree).join("\n")
    })
    .catch(errmes => console.log(errmes));
  }
}

const processedDir = dirProcessor(path.resolve(), path.resolve('/tmp/dirindexdata'));
processedDir('home', [], [], 0).then(dir => console.log(dir));
