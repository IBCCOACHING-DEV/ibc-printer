#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function parseEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return {};
  }

  const result = {};
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const equalIndex = line.indexOf('=');
    if (equalIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalIndex).trim();
    let value = line.slice(equalIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function env(name, fallback = '') {
  if (process.env[name] !== undefined && process.env[name] !== '') {
    return process.env[name];
  }

  return fileEnv[name] !== undefined ? fileEnv[name] : fallback;
}

function toBool(value, fallback) {
  if (!value) {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function escapePowerShellSingleQuotes(value) {
  return String(value).replace(/'/g, "''");
}

function runPowerShell(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const command = `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;
  return execSync(command, { encoding: 'utf8' });
}

function getPrinters() {
  const script =
    "$ErrorActionPreference='Stop'; " +
    'Get-CimInstance Win32_Printer | ' +
    'Select-Object Name,DriverName,PNPDeviceID,PortName,PrinterStatus,WorkOffline | ' +
    'ConvertTo-Json -Compress';

  const output = runPowerShell(script).trim();
  if (!output) {
    return [];
  }

  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function matchesModel(printer, targetModel) {
  const model = targetModel.toLowerCase();
  const name = String(printer.Name || '').toLowerCase();
  const driver = String(printer.DriverName || '').toLowerCase();
  return name.includes(model) || driver.includes(model);
}

function normalizeName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

const envPath = path.resolve(process.cwd(), '.env');
const fileEnv = parseEnvFile(envPath);

if (process.platform !== 'win32') {
  console.log('[windows-printer-prepare] Skipping: current OS is not Windows.');
  process.exit(0);
}

const targetModel = env('PRINTER_WINDOWS_TARGET_MODEL', 'Brother QL-810W').trim();
const identifier =
  env('PRINTER_WINDOWS_IDENTIFIER', '').trim() ||
  env('PRINTER_AGENT_KEY', '').trim();
const deleteOthers = toBool(env('PRINTER_WINDOWS_DELETE_OTHERS', 'true'), true);

if (!identifier) {
  console.error(
    '[windows-printer-prepare] Missing identifier. Set PRINTER_WINDOWS_IDENTIFIER or PRINTER_AGENT_KEY.',
  );
  process.exit(1);
}

const desiredName = normalizeName(`${targetModel} ${identifier}`);

let printers;
try {
  printers = getPrinters();
} catch (error) {
  console.error('[windows-printer-prepare] Failed to list printers:', error.message);
  process.exit(1);
}

const candidates = printers.filter((printer) => matchesModel(printer, targetModel));
if (candidates.length === 0) {
  console.error(
    `[windows-printer-prepare] No printer found for model "${targetModel}".`,
  );
  process.exit(1);
}

const onlineCandidates = candidates.filter((printer) => printer.WorkOffline !== true);
const selected = onlineCandidates[0] || candidates[0];

if (selected.Name !== desiredName) {
  try {
    const script =
      "$ErrorActionPreference='Stop'; " +
      `Rename-Printer -Name '${escapePowerShellSingleQuotes(selected.Name)}' -NewName '${escapePowerShellSingleQuotes(desiredName)}'`;
    runPowerShell(script);
    console.log(
      `[windows-printer-prepare] Renamed printer "${selected.Name}" to "${desiredName}".`,
    );
  } catch (error) {
    console.error('[windows-printer-prepare] Failed to rename printer:', error.message);
    process.exit(1);
  }
} else {
  console.log(`[windows-printer-prepare] Printer already named "${desiredName}".`);
}

if (deleteOthers) {
  let refreshed;
  try {
    refreshed = getPrinters();
  } catch (error) {
    console.error(
      '[windows-printer-prepare] Failed to refresh printer list after rename:',
      error.message,
    );
    process.exit(1);
  }

  const toRemove = refreshed.filter((printer) => printer.Name !== desiredName);

  for (const printer of toRemove) {
    try {
      const script =
        "$ErrorActionPreference='Stop'; " +
        `Remove-Printer -Name '${escapePowerShellSingleQuotes(printer.Name)}'`;
      runPowerShell(script);
      console.log(`[windows-printer-prepare] Removed printer "${printer.Name}".`);
    } catch (error) {
      console.warn(
        `[windows-printer-prepare] Could not remove printer "${printer.Name}": ${error.message}`,
      );
    }
  }
}

console.log('[windows-printer-prepare] Done.');
