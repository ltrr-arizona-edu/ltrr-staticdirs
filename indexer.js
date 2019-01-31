const fsPromises = require("fs").promises;

function paddedname (name, indent) {
  return ' '.repeat(indent) + name;
}

function formatentry (root, parents, siblings, indent) {
  return (entry) => {
    if (entry.isFile()) {
      return paddedname(entry.name, indent);
    }
    if (entry.isDirectory()) {
      return mappeddir(root, entry.name, parents, siblings, indent);
    }
  }
}

function mappeddir (root, dirname, parents, siblings, indent) {
  const nextroot = `${root}/${dirname}`;
  const nextparents = parents.concat([dirname]);
  const nextindent = indent + 2;
  return fsPromises.readdir(nextroot, { withFileTypes: true })
  .then(entries => {
    const nextsiblings = entries.filter(entry => entry.isDirectory()).map(direntry => direntry.name);
    const entryformat = formatentry(nextroot, nextparents, nextsiblings, nextindent);
    return entries.map(entryformat)
  })
  .then(dirlist => Promise.all(dirlist))
  .then(subtree => [`${paddedname(dirname, indent)}/ ${parents.join(' --> ')} | [${siblings.join(', ')}]`].concat(subtree).join("\n"))
  .catch(errmes => console.log(errmes));
}

mappeddir('.', 'home', [], [], 0).then(dir => console.log(dir));
