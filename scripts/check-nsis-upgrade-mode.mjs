import fs from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const tauriConfigPath = path.join(repoRoot, 'src-tauri', 'tauri.conf.json')

function fail(message) {
  console.error(`check-nsis-upgrade-mode: ${message}`)
  process.exit(1)
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch (error) {
    fail(`missing file: ${path.relative(repoRoot, filePath)} (${error.message})`)
  }
}

const config = JSON.parse(readText(tauriConfigPath))
const nsis = config?.bundle?.windows?.nsis

if (!nsis || typeof nsis !== 'object') {
  fail('src-tauri/tauri.conf.json is missing bundle.windows.nsis')
}

if (nsis.template !== 'nsis/installer.nsi') {
  fail('bundle.windows.nsis.template must be "nsis/installer.nsi"')
}

const customLanguageFiles = nsis.customLanguageFiles ?? {}
for (const [language, expectedPath] of Object.entries({
  SimpChinese: 'nsis/languages/SimpChinese.nsh',
  English: 'nsis/languages/English.nsh',
})) {
  if (customLanguageFiles[language] !== expectedPath) {
    fail(`bundle.windows.nsis.customLanguageFiles.${language} must be "${expectedPath}"`)
  }
}

const templatePath = path.join(repoRoot, 'src-tauri', nsis.template)
const template = readText(templatePath)

if (!template.includes('StrCpy $R2 "$(upgradeWithoutUninstall)"')) {
  fail('upgrade page must show the in-place upgrade option as the primary action')
}

if (!template.includes('StrCpy $R3 "$(uninstallBeforeInstalling)"')) {
  fail('upgrade page must keep uninstall-before-installing as the secondary action')
}

if (!/\$\{ElseIf\}\s+\$R0\s*=\s*1\s*;\s*Upgrading[\s\S]*?\$\{If\}\s+\$R1\s*=\s*1\s*;[^\n]*\n\s*Goto reinst_done[\s\S]*?\$\{Else\}[\s\S]*?Goto reinst_uninstall[\s\S]*?\$\{EndIf\}/.test(template)) {
  fail('upgrade branch must treat the first radio option as in-place upgrade, not uninstall')
}

if (!/Function PageLeaveReinstall[\s\S]*?\$\{If\}\s+\$PassiveMode\s*=\s*1[\s\S]*?StrCpy\s+\$R1\s+1[\s\S]*?\$\{Else\}[\s\S]*?\$\{NSD_GetState\}\s+\$R2\s+\$R1[\s\S]*?\$\{EndIf\}/.test(template)) {
  fail('passive reinstall flow must explicitly choose the first option before branching')
}

if (!template.includes('${If} $UpdateMode = 1') || !template.includes('Goto reinst_done')) {
  fail('updater /UPDATE mode must continue without uninstalling')
}

if (!template.includes('${If} $WixMode = 1') || !template.includes('Goto reinst_uninstall')) {
  fail('WiX migration path must still uninstall the previous WiX package')
}

for (const [language, relativePath] of Object.entries(customLanguageFiles)) {
  const languageFile = readText(path.join(repoRoot, 'src-tauri', relativePath))
  if (!languageFile.includes(`LangString upgradeWithoutUninstall `)) {
    fail(`${relativePath} must define upgradeWithoutUninstall for ${language}`)
  }
}

console.log('check-nsis-upgrade-mode: OK')
