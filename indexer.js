#!/usr/bin/env node

import fsPromises from 'node:fs/promises'
import path from 'node:path'
import url from 'node:url'
import pug from 'pug'

const source = process.env.STATICDIRS_SOURCE || path.resolve()
const destination = process.env.STATICDIRS_DESTINATION || path.resolve('build')
const webSiteName = process.env.STATICDIRS_SITENAME || 'Home'
const webDeptName = process.env.STATICDIRS_DEPTNAME || ''
const webDeptURL = process.env.STATICDIRS_DEPTURL || ''
const indexName = process.env.STATICDIRS_INDEXNAME || 'index.html'
const altIndexName = process.env.STATICDIRS_ALTINDEXNAME || 'staticdirs_index.html'
const webRootURL = process.env.STATICDIRS_WEBROOT || url.pathToFileURL(destination)
const webExtraRoot = ['staticdirs']
const webScripts = webExtraRoot.concat(['scripts'])
const webImages = webExtraRoot.concat(['images'])
const webStyles = webExtraRoot.concat(['styles'])
const webAssetDir = 'webassets'
const assets = path.resolve(webAssetDir)

const baseOptions = {
  root: webRootURL,
  index: indexName,
  siteName: webSiteName,
  deptName: webDeptName,
  deptURL: webDeptURL,
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
})(process.env.STATICDIRS_VERBOSE)

const errorExit = message => {
  throw new Error(message)
}

const subTreeIndex = pug.compileFile(path.join(webAssetDir, 'subtreeindex.pug'), { basedir: assets })
const topLevelIndex = pug.compileFile(path.join(webAssetDir, 'toplevelindex.pug'), { basedir: assets })

const patternCopiedFiles = async (srcDir, dstDir, pattern, log) => {
  try {
    const dirents = await fsPromises.readdir(srcDir, { withFileTypes: true })
    const copyList = dirents.filter(entry => entry.isFile() && pattern.test(entry.name))
      .map(fileEntry => {
        const src = path.join(srcDir, fileEntry.name)
        const dst = path.join(dstDir, fileEntry.name)
        return fsPromises.copyFile(src, dst, fsPromises.constants.COPYFILE_EXCL)
      })
    return Promise.all(copyList)
  } catch (error) {
    log.message(error)
  }
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

const doIndexEntry = async (entry, srcTree, dstTree, log) => {
  const { name } = entry
  try {
    if (entry.isFile()) {
      await fsPromises.symlink(path.join(srcTree, name), path.join(dstTree, name))
    }

    return [
      { entryType: 'index' },
      log.formattedEntry(name)
    ]
  } catch (error) {
    (breakageHandler('file', name, log))(error)
  }
}

const doFileEntry = async (name, entryPath, dstTree, webTree, log) => {
  const encoded = encodeURIComponent(name)
  try {
    await fsPromises.symlink(entryPath, path.join(dstTree, name))
    return [
      { entryType: 'file', href: `${webTree}/${encoded}`, title: name },
      log.formattedEntry(name)
    ]
  } catch (error) {
    (breakageHandler('file', name, log))(error)
  }
}

const doSymlinkEntry = async (name, entryPath, webTree, log) => {
  try {
    const actualEntry = await fsPromises.realpath(entryPath)
    const [rel, stats] = await Promise.all([
      fsPromises.readlink(entryPath),
      fsPromises.stat(actualEntry)
    ])
    const relURL = rel.split(path.sep).map(part => encodeURIComponent(part)).join('/')
    const relRef = (stats.isDirectory()) ? `${relURL}/${indexName}` : relURL
    return [
      { entryType: 'link', href: `${webTree}/${relRef}`, title: name },
      log.formattedEntry(name)
    ]
  } catch (error) {
    (breakageHandler('link', name, log))(error)
  }
}

// eslint-disable-next-line max-params
const tupleEntryProcessor = (srcTree, dstTree, webTree, parents, siblings, log, doDirEntry) => {
  return entry => {
    if (entry.name === indexName) {
      return doIndexEntry(entry, srcTree, dstTree, log)
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
  if ((parents === undefined) || (parents.length === 0)) {
    return []
  }

  const [dirName, ...rest] = parents
  const trailStart = crumb(webRoot, dirName)
  if ((rest === undefined) || (rest.length === 0)) {
    return trailStart
  }

  const descent = (previous, trail) => {
    if ((previous === undefined) || (previous.length === 0)) {
      return trail
    }

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

const writeIndex = async (dstTree, filledTemplate) => {
  let fhandle
  try {
    fhandle = await fsPromises.open(path.join(dstTree, indexName), 'wx', 0o644)
    await fhandle.writeFile(filledTemplate)
  } catch (error) {
    if (error.code === 'EEXIST') {
      await fsPromises.writeFile(path.join(dstTree, altIndexName), filledTemplate, { mode: 0o644 })
    } else {
      throw error
    }
  } finally {
    await fhandle?.close()
  }
}

const dirProcessor = (srcRoot, dstRoot, webRoot) => {
  const doDirEntry = async (dirName, parents, siblings, log) => {
    const nextParents = parents.concat([dirName])
    const nextLog = log.deeper()
    const srcTree = joinedPath(srcRoot, nextParents)
    const dstTree = joinedPath(dstRoot, nextParents)
    const webAbove = [webRoot].concat(parents.map(encodeURIComponent)).join('/')
    const webTree = `${webAbove}/${encodeURIComponent(dirName)}`
    const navRefs = siblings.map(webNavProcessor(webAbove, dirName))
    const breadcrumbs = webBreadcrumbs(webRoot, parents)
    const process = entries => {
      const nextSiblings = entries.filter(entry => entry.isDirectory())
        .map(dirEntry => dirEntry.name)
      return entries
        .map(tupleEntryProcessor(srcTree, dstTree, webTree, nextParents, nextSiblings, nextLog, doDirEntry))
    }

    try {
      await fsPromises.mkdir(dstTree, { mode: 0o755 })
      const entries = await fsPromises.readdir(srcTree, { withFileTypes: true })
      const tuples = await Promise.all(process(entries))
      const dirRefs = extractWebRefs(tuples)
      const subTreeLog = extractLogFrags(tuples)
      const locals = { dirName, breadcrumbs, navRefs, dirRefs, ...baseOptions }
      await writeIndex(dstTree, subTreeIndex(locals))
      return [
        { entryType: 'dir', href: `${webTree}/${indexName}`, title: dirName },
        log.formattedDir(dirName, parents, siblings, subTreeLog)
      ]
    } catch (error) {
      (breakageHandler('dir', dirName, log))(error)
    }
  }

  return doDirEntry
}

const topLevelDir = async (srcRoot, dstRoot, webRoot, log, processedDir) => {
  const process = entries => {
    const nextSiblings = entries.filter(entry => entry.isDirectory())
      .map(dirEntry => dirEntry.name)
    return entries
      .map(tupleEntryProcessor(srcRoot, dstRoot, webRoot, [], nextSiblings, log, processedDir))
  }

  try {
    const entries = await fsPromises.readdir(srcRoot, { withFileTypes: true })
    const tuples = await Promise.all(process(entries))
    const dirRefs = extractWebRefs(tuples)
    const dirLogs = extractLogFrags(tuples)
    const locals = { dirRefs, ...baseOptions }
    await writeIndex(dstRoot, topLevelIndex(locals))
    return log.formattedDir(srcRoot, [], [], dirLogs)
  } catch (error) {
    (breakageHandler('dir', srcRoot, log))(error)
  }
}

const placedWebAssets = async (assetRoot, dst, log) => {
  const scriptDir = joinedPath(dst, webScripts)
  const imageDir = joinedPath(dst, webImages)
  const styleDir = joinedPath(dst, webStyles)
  try {
    await patternCopiedFiles(assetRoot, dst, /\.ico$/, log)
    await Promise.all(
      [scriptDir, imageDir, styleDir]
        .map(dir => fsPromises.mkdir(dir, { mode: 493, recursive: true }))
    )
    return Promise.all([
      patternCopiedFiles(assetRoot, scriptDir, /\.js$/, log),
      patternCopiedFiles(assetRoot, imageDir, /\.((png)|(jpg)|(svg))$/, log),
      patternCopiedFiles(assetRoot, styleDir, /\.css$/, log)
    ])
  } catch (error) {
    log.message(error)
  }
}

const processedDirTree = dirProcessor(source, destination, webRootURL)

const topRunner = async (destination, topLog) => {
  try {
    await fsPromises.rm(destination, { recursive: true, force: true })
    await fsPromises.mkdir(destination, { mode: 0o755 })
    await placedWebAssets(assets, destination, topLog)
    const dirLog = await topLevelDir(source, destination, webRootURL, topLog.deeper(), processedDirTree)
    topLog.message(dirLog)
  } catch (error) {
    topLog.message(error)
  }
}

export default await topRunner(destination, topLog)
