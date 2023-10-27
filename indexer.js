import fsPromises from 'node:fs/promises'
import path from 'node:path'
import url from 'node:url'
import pug from 'pug'

const source = process.env.DIRINDEX_SOURCE || path.resolve()
const destination = process.env.DIRINDEX_DESTINATION || path.resolve('build')
const webSiteName = process.env.DIRINDEX_SITENAME || 'Home'
const indexName = process.env.DIRINDEX_INDEXNAME || 'index.html'
const webRootURL = process.env.DIRINDEX_WEBROOT || url.pathToFileURL(destination)
const webExtraRoot = ['dirindex']
const webScripts = webExtraRoot.concat(['scripts'])
const webImages = webExtraRoot.concat(['images'])
const webStyles = webExtraRoot.concat(['styles'])
const webAssetDir = 'webassets'
const assets = path.resolve(webAssetDir)

const baseOptions = {
  root: webRootURL,
  siteName: webSiteName,
  scripts: [webRootURL].concat(webScripts).join('/'),
  images: [webRootURL].concat(webImages).join('/'),
  styles: [webRootURL].concat(webStyles).join('/'),
  widthFileIcon: '32px',
  heightFileIcon: '32px'
}

const verboseLogger = {
  indentLevel: 0,
  message(mess) {
  // eslint-disable-next-line no-console
    console.log(mess)
  },
  debugMessage() {},
  paddedName(name) {
    return ' '.repeat(this.indentLevel) + name
  },
  formattedEntry(name) {
    return this.paddedName(name)
  },
  formattedDir(dirName, parents, siblings, entries) {
    const dirHeader = `${this.paddedName(dirName)}/ ${parents.join(' --> ')} | [${siblings.join(', ')}]`
    return [dirHeader].concat(entries).join('\n')
  },
  deeper() {
    return { ...this, indentLevel: this.indentLevel + 2 }
  }
}

const normalLogger = {
  message() {},
  debugMessage() {},
  paddedName() {},
  formattedEntry() {},
  formattedDir() {},
  deeper() {
    return this
  }
}

const debugLogger = {
  ...verboseLogger,
  debugMessage(mess) {
    // eslint-disable-next-line no-console
    console.log(mess)
  }
}

const topLog = (level => {
  switch (level) {
    case '1': {
      return verboseLogger
    }

    case '2': {
      return debugLogger
    }

    default: {
      return normalLogger
    }
  }
})(process.env.DIRINDEX_VERBOSE)

const errorExit = message => {
  throw new Error(message)
}

const subTreeIndex = pug.compileFile(path.join(webAssetDir, 'subtreeindex.pug'), { basedir: assets })
const topLevelIndex = pug.compileFile(path.join(webAssetDir, 'toplevelindex.pug'), { basedir: assets })

const patternCopiedFiles = (srcDir, dstDir, pattern, log) => {
  return fsPromises.readdir(srcDir, { withFileTypes: true })
    .then(dirents => dirents.filter(entry => entry.isFile() && pattern.test(entry.name))
      .map(fileEntry => {
        const src = path.join(srcDir, fileEntry.name)
        const dst = path.join(dstDir, fileEntry.name)
        return fsPromises.copyFile(src, dst)
      }))
    .then(copyList => Promise.all(copyList))
    .catch(error => log.message(error))
}

const joinedPath = (root, pathList) => {
  return path.join(root, ...pathList)
}

const tupleReducer = n => {
  return tuplelist => {
    const extract = tuplelist.map(tuple => tuple[n])
    return extract.filter(nth => (nth !== null) && (nth !== undefined))
  }
}

const extractWebRefs = tupleReducer(0)

const extractLogFrags = tupleReducer(1)

const breakageHandler = (entry, name, log) => {
  return errmes => {
    const badName = `BROKEN ${name}`
    log.message(`Problem processing ${entry} ${name}: ${errmes}`)
    return [
      { entryType: entry, href: '#', title: badName },
      log.formattedEntry(badName)
    ]
  }
}

const purgedTree = (victim, log) => {
  return fsPromises.readdir(victim, { withFileTypes: true })
    .then(
      entries => entries.map(entry => {
        const entryPath = path.join(victim, entry.name)
        if (entry.isDirectory()) {
          return purgedTree(entryPath, log.deeper())
        }

        return fsPromises.unlink(entryPath)
      }
      ))
    .then(hitList => Promise.all(hitList))
    .then(() => fsPromises.rmdir(victim))
    .catch(error => log.message(error))
    .then(() => fsPromises.stat(victim))
    .then(
      () => errorExit(`Directory still exists: ${victim}`),
      () => log.debugMessage(`Deleted OK: ${victim}`)
    )
}

const doIndexEntry = log => {
  return Promise.resolve()
    .then(() => [
      { entryType: 'index' },
      log.formattedEntry(indexName)
    ])
    .catch(breakageHandler('index', indexName, log))
}

const doFileEntry = (name, entryPath, dstTree, webTree, log) => {
  const encoded = encodeURIComponent(name)
  return fsPromises.symlink(entryPath, path.join(dstTree, name))
    .then(() => [
      { entryType: 'file', href: `${webTree}/${encoded}`, title: name },
      log.formattedEntry(name)
    ])
    .catch(breakageHandler('file', name, log))
}

const doSymlinkEntry = (name, entryPath, webTree, log) => {
  return fsPromises.realpath(entryPath)
    .then(actualEntry => Promise.all([
      fsPromises.readlink(entryPath),
      fsPromises.stat(actualEntry)
    ]))
    .then(([rel, stats]) => {
      const relURL = rel.split(path.sep).map(part => encodeURIComponent(part)).join('/')
      const relRef = (stats.isDirectory()) ? `${relURL}/${indexName}` : relURL
      return [
        { entryType: 'link', href: `${webTree}/${relRef}`, title: name },
        log.formattedEntry(name)
      ]
    })
    .catch(breakageHandler('link', name, log))
}

// eslint-disable-next-line max-params
const tupleEntryProcessor = (srcTree, dstTree, webTree, parents, siblings, log, doDirEntry) => {
  return entry => {
    if (entry.name === indexName) {
      return doIndexEntry(log)
    }

    const entryPath = path.join(srcTree, entry.name)
    if (entry.isFile()) {
      return doFileEntry(entry.name, entryPath, dstTree, webTree, log)
    }

    if (entry.isSymbolicLink()) {
      return doSymlinkEntry(entry.name, entryPath, webTree, log)
    }

    if (entry.isDirectory()) {
      return doDirEntry(entry.name, parents, siblings, log)
    }

    return errorExit(`Cannot process ${entry.name} in ${srcTree}`)
  }
}

const crumb = (crumbBase, dirName) => {
  const encoded = encodeURIComponent(dirName)
  const currentBase = `${crumbBase}/${encoded}`
  return [{ base: currentBase, href: `${currentBase}/${indexName}`, title: dirName }]
}

const webBreadcrumbs = (webRoot, parents) => {
  const [dirName, ...rest] = parents
  const trailStart = crumb(webRoot, dirName)
  if (rest === undefined) {
    return trailStart
  }

  const descent = (previous, trail) => {
    const [dirName, ...rest] = previous
    const currentCrumb = crumb(trail[trail.length - 1].base, dirName)
    if (rest === undefined) {
      return trail.concat(currentCrumb)
    }

    return descent(rest, trail.concat(currentCrumb))
  }

  return descent(rest, trailStart)
}

const webNavProcessor = (webContext, current) => {
  return navName => {
    const encoded = encodeURIComponent(navName)
    if (navName === current) {
      return { href: '#', title: navName, active: true }
    }

    return { href: `${webContext}/${encoded}/${indexName}`, title: navName, active: false }
  }
}

const dirProcessor = (srcRoot, dstRoot, webRoot) => {
  const doDirEntry = (dirName, parents, siblings, log) => {
    const nextParents = parents.concat([dirName])
    const nextLog = log.deeper()
    const srcTree = joinedPath(srcRoot, nextParents)
    const dstTree = joinedPath(dstRoot, nextParents)
    const webAbove = [webRoot].concat(parents.map(encodeURIComponent)).join('/')
    const webTree = `${webAbove}/${encodeURIComponent(dirName)}`
    const navRefs = siblings.map(webNavProcessor(webAbove, dirName))
    const breadcrumbs = webBreadcrumbs(webRoot, parents)
    return fsPromises.mkdir(dstTree, { mode: 0o755 })
      .then(() => fsPromises.readdir(srcTree, { withFileTypes: true }))
      .then(entries => {
        const nextSiblings = entries.filter(entry => entry.isDirectory())
          .map(dirEntry => dirEntry.name)
        return entries
          .map(tupleEntryProcessor(
            srcTree, dstTree, webTree, nextParents, nextSiblings, nextLog, doDirEntry
          ))
      })
      .then(dirList => Promise.all(dirList))
      .then(tuples => {
        const dirRefs = extractWebRefs(tuples)
        const dirLogs = extractLogFrags(tuples)
        const locals = ({ dirName, breadcrumbs, navRefs, dirRefs, ...baseOptions })
        return Promise.all([
          fsPromises.writeFile(
            path.join(dstTree, indexName), subTreeIndex(locals), { mode: 0o644 }
          ),
          dirLogs
        ])
      })
      .then(([, subTreeLog]) => [
        { entryType: 'dir', href: `${webTree}/${indexName}`, title: dirName },
        log.formattedDir(dirName, parents, siblings, subTreeLog)
      ])
      .catch(breakageHandler('dir', dirName, log))
  }

  return doDirEntry
}

const topLevelDir = (srcRoot, dstRoot, webRoot, log, processedDir) => {
  return fsPromises.readdir(srcRoot, { withFileTypes: true })
    .then(entries => {
      const nextSiblings = entries.filter(entry => entry.isDirectory())
        .map(dirEntry => dirEntry.name)
      return entries
        .map(tupleEntryProcessor(srcRoot, dstRoot, webRoot, [], nextSiblings, log, processedDir))
    })
    .then(dirList => Promise.all(dirList))
    .then(tuples => {
      const dirRefs = extractWebRefs(tuples)
      const dirLogs = extractLogFrags(tuples)
      const locals = ({ ...dirRefs, ...baseOptions })
      return Promise.all([
        fsPromises.writeFile(path.join(dstRoot, indexName), topLevelIndex(locals), { mode: 0o644 }),
        log.formattedDir(srcRoot, [], [], dirLogs)
      ])
    })
    .catch(breakageHandler('dir', srcRoot, log))
}

const placedWebAssets = (assetRoot, dst, log) => {
  const scriptDir = joinedPath(dst, webScripts)
  const imageDir = joinedPath(dst, webImages)
  const styleDir = joinedPath(dst, webStyles)
  return patternCopiedFiles(assetRoot, dst, /\.ico$/, log)
    .then(() => Promise.all(
      [scriptDir, imageDir, styleDir]
        .map(dir => fsPromises.mkdir(dir, { mode: 0o755, recursive: true }))
    ))
    .then(() => Promise.all([
      patternCopiedFiles(assetRoot, scriptDir, /\.js$/, log),
      patternCopiedFiles(assetRoot, imageDir, /\.((png)|(jpg)|(svg))$/, log),
      patternCopiedFiles(assetRoot, styleDir, /\.css$/, log)
    ]))
    .catch(error => log.message(error))
}

const processedDirTree = dirProcessor(source, destination, webRootURL)

purgedTree(destination, topLog)
  .then(() => fsPromises.mkdir(destination, { mode: 0o755 }))
  .then(() => Promise.all([
    placedWebAssets(assets, destination, topLog),
    topLevelDir(source, destination, webRootURL, topLog.deeper(), processedDirTree)
      .then(([, dirLog]) => topLog.message(dirLog))
  ]))
  .catch(error => topLog.message(error))
