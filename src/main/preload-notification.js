/**
 * Preload for NotificationWindow
 * Exposes a single notifAPI object via contextBridge
 */

const { ipcRenderer, contextBridge } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

contextBridge.exposeInMainWorld('notifAPI', {
  send: (channel, data) => ipcRenderer.send(channel, data),
  readSettingsAccentColor: () => {
    try {
      const settingsFile = path.join(os.homedir(), '.claude-terminal', 'settings.json');
      if (fs.existsSync(settingsFile)) {
        const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
        return settings.accentColor || null;
      }
    } catch (_) {}
    return null;
  },
  readSettingsLanguage: () => {
    try {
      const settingsFile = path.join(os.homedir(), '.claude-terminal', 'settings.json');
      if (fs.existsSync(settingsFile)) {
        const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
        return settings.language || 'en';
      }
    } catch (_) {}
    return 'en';
  }
});
