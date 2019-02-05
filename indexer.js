
"use strict";

const fsPromises = require("fs").promises;

const paddedName = function whiteSpacePaddedName (name, indent) {
  return ' '.repeat(indent) + name;
}

const entryFormatter = function directoryEntryFormatter (parents, siblings, indent) {
  return (entry) => {
    if (entry.isFile()) {
      return paddedName(entry.name, indent);
    }
    if (entry.isDirectory()) {
      return processedDir(entry.name, parents, siblings, indent);
    }
  }
}

const dirProcessor = function directoryTreeProcessor (srcRoot) {
  return (dirName, parents, siblings, indent) => {
    const nextParents = parents.concat([dirName]);
    const nextIndent = indent + 2;
    const subTree = [srcRoot].concat(nextParents).join('/');
    return fsPromises.readdir(subTree, { withFileTypes: true })
    .then(entries => {
      const nextSiblings = entries.filter(entry => entry.isDirectory()).map(dirEntry => dirEntry.name);
      const formattedEntry = entryFormatter(nextParents, nextSiblings, nextIndent);
      return entries.map(formattedEntry)
    })
    .then(dirList => Promise.all(dirList))
    .then(resolvedTree => {
      const dirHeader = `${paddedName(dirName, indent)}/ ${parents.join(' --> ')} | [${siblings.join(', ')}]`;
      return [dirHeader].concat(resolvedTree).join("\n")
    })
    .catch(errmes => console.log(errmes));
  }
}

const processedDir = dirProcessor('.')
processedDir('home', [], [], 0).then(dir => console.log(dir));
