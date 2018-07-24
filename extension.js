const vscode = require('vscode')
const fs = require('fs')
const path = require('path')

const appDir = path.dirname(require.main.filename)
const fsOptions = { encoding: 'utf8' }

const patches = {
  'vs/code/electron-main/main.js': [
    // Change the Electron titleBarStyle to "hidden-inset"
    [
      '.titleBarStyle="hidden",',
      '.titleBarStyle="hidden-inset",'
    ]
  ],
  'vs/workbench/workbench.main.js': [
    // Never show the TITLEBAR_PART when "window.titleBarStyle" is "custom" 
    [
      'TITLEBAR_PART:return"custom"===this.getCustomTitleBarStyle()&&!h.isFullscreen()',
      'TITLEBAR_PART:return false'
    ],
    // Handle setting of traffic-lights size and .titlebar-less class on .monaco-workbench
    [
      // Patch the full layout function in layout.ts, and parse it to retrieve
      // its parameter and the object on which to call `getZoomFactor()`:
      /\.layout\=function\((\w+)\)\{(this\.workbenchSize\=[\s\S]*(\w+).getZoomFactor\(\)[\s\S]*contextViewService.layout\(\))}/m,
      (all, param, body, browser) => {
        return `.layout=function(${param}){
          // Only activate titlebar-less mode if "window.titleBarStyle" is set to "custom":
          if ("custom" === this.partService.configurationService.getValue().window.titleBarStyle) {
            // Take zoom-factor into account:
            var factor = ${browser}.getZoomFactor();
            var width = 78 / factor;
            var height = 35 / factor;
            var style = document.documentElement.style;
            style.setProperty("--traffic-lights-width", width + "px");
            style.setProperty("--traffic-lights-height", height + "px");
            // Add .titlebar-less to .monaco-workbench, see workbench.main.css
            this.workbenchContainer.classList.add("titlebar-less");
            this.partLayoutInfo.activitybar.width = width;
          }
          ${body}
        }`
      }
    ]
  ],
  'vs/workbench/workbench.main.css': [
    // Add our CSS modifications to the end of the main file
    [
      /$/g, // Append to the end of the file
      readFile('workbench.main.css')
    ]
  ]
}

const messages = {
  success: verb => `Titlebar-less mode ${verb}. Please restart VSCode to see effect.`,
  fail: (verb, result) => `Unable to ${verb} all patches (${result.applied}/${result.total})`
}

exports.activate = function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('titlebarLess.enable', enable),
    vscode.commands.registerCommand('titlebarLess.disable', disable)
  )
  removeOldOrigFiles()
}

function enable() {
  // Always try to disable before enabling, but ignore if nothing was there to
  // disable (= it was already disabled before).
  let result = applyPatches(false)
  if (result.success || result.applied === 0) {
    result = applyPatches(true)
    vscode.window.showInformationMessage(result.success
      ? messages.success('enabled')
      : messages.fail('apply', result)
    )
  } else {
    vscode.window.showInformationMessage(messages.fail('remove', result))
  }
}

function disable() {
  const result = applyPatches(false)
  // Ignore if nothing was there to disable (= it was already disabled before).
  vscode.window.showInformationMessage(result.success || result.applied === 0
    ? messages.success('disabled')
    : messages.fail('remove', result)
  )
}

function applyPatches(enable) {
  let applied = 0
  let total = 0
  for (const [filePath, filePatches] of Object.entries(patches)) {
    const file = getFilePath(filePath)
    const orig = `${file}.orig.${vscode.version}`
    try {
      const amount = filePatches.length
      total += amount
      if (enable) {
        let content = fs.readFileSync(file, fsOptions)
        let found = 0
        for (const [find, replace] of filePatches) {
          const patched = content.replace(find, replace)
          if (patched !== content) {
            content = patched
            found++
          }
        }
        if (found === amount) {
          fs.renameSync(file, orig)
          fs.writeFileSync(file, content, fsOptions)
          applied += amount
        }
      } else {
        if (fs.existsSync(orig)) {
          fs.unlinkSync(file)
          fs.renameSync(orig, file)
          applied += amount
        }
      }
    } catch (err) {
      console.error(err)
    }
  }
  return {
    success: applied === total,
    applied,
    total
  }
}

function removeOldOrigFiles() {
  // Remove all old backup files that aren't related to the current version
  // of VSCode anymore.
  for (const filePath of Object.keys(patches)) {
    const dir = path.dirname(getFilePath(filePath))
    const oldOrigFiles = fs.readdirSync(dir)
      .filter(file => /\.orig\./.test(file))
      .filter(file => !file.endsWith(vscode.version))
    for (const file of oldOrigFiles) {
      fs.unlinkSync(path.join(dir, file))
    }
  }
}

function getFilePath(filePath) {
  return path.join(appDir, ...filePath.split('/'))
}

function readFile(filename) {
  return fs.readFileSync(path.join(__dirname, filename), fsOptions)
}
