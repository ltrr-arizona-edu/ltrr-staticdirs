# Create Index Files for Static Web Site Directory Trees

Web servers such as Apache displaying an otherwise static web site from a
filesystem directory tree can optionally generate dynamic directory listings,
showing directory contents as web pages containing links to display or
download the items. For serverless and other purely static web sites this
is not an option, but a script can pre-populate the directory tree with index
files to emulate this behavior.

## Requirements and installation

This is an unpublished npm package, requiring Node.js version 18 or greater.
From a shell command line, changing to the top-level directory containing
its files and using the `npm install` command should generate a working
version, following the
[generic instructions](https://docs.npmjs.com/cli/v10/commands/npm-install)
for this.

## Running

The only file to run is `indexer.js`. This expects to traverse a source
directory tree, building a destination tree populated with symbolic links to
the files in the source tree (rather than copying the files themselves, to save
on space and time). In directories and subdirectories where the source tree
lacks an index file it generates one, using the directory contents and its
position within the tree to generate links to the files and subdirectories,
a navigation menu connecting to other directories at the same level, and a
breadcrumb bar showing how deep the current directory is within the overall
tree. The top-level directory gets special treatment, with the extra navigation
menus removed. Where an index file already exists, it preserves it unmodified,
but still generates its own index file, giving it an alternate name. It creates
a `favicon.ico` file and a subdirectory of additional files referenced by the
index pages at the top level of the destination tree. Note that it should leave
the source tree completely unchanged, but erase and completely replace the
destination tree: these must not overlap.

## Modifying behavior

Environment variables, rather than command line arguments, modify the behavior
of `indexer.js`:

- `STATICDIRS_ALTINDEXNAME` alternative name to use when an index file exists.
- `STATICDIRS_DEPTNAME` department name for alt text in the index page footer.
- `STATICDIRS_DEPTURL` department link for the index page footer.
- `STATICDIRS_DESTINATION` filesystem directory for the destination tree.
- `STATICDIRS_INDEXNAME` name of the index file (e.g., `index.html`)
- `STATICDIRS_SITENAME` human-readable name for use in navigation links, etc.
- `STATICDIRS_SOURCE` filesystem directory for the source tree.
- `STATICDIRS_VERBOSE` logging level—1: show logs, 2: logs+debug, other: quiet.
- `STATICDIRS_WEBASSETSDIR` filesystem directory containing templates etc.
- `STATICDIRS_WEBROOT` base URL for the final web site.

## Development

The JavaScript code conforms to some widely used standards, optionally enforced
by [ESLint](https://eslint.org/), which the `npm run lint` command will invoke.

