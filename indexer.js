const fsPromises = require("fs").promises;

function paddedname (name, indent) {
  return ' '.repeat(indent) + name;
}

function formatentry (root, indent) {
  return (entry) => {
    if (entry.isFile()) {
      return paddedname(entry.name, indent);
    }
    if (entry.isDirectory()) {
      return mappeddir(root, entry.name, indent);
    }
  }
}

function mappeddir (root, dirname, indent) {
  const path = root + '/' + dirname;
  const entryformat = formatentry(path, indent + 2);
  return fsPromises.readdir(path, { withFileTypes: true })
  .then(entries => entries.map(entryformat))
  .then(dirlist => Promise.all(dirlist))
  .then(subtree => [paddedname(dirname, indent) + '/'].concat(subtree).join("\n"))
  .catch(errmes => console.log(errmes));
}

mappeddir('.', 'home', 0).then(dir => console.log(dir));
