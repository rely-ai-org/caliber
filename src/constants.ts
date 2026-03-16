import path from 'path';
import os from 'os';

export const AUTH_DIR = path.join(os.homedir(), '.caliber');
export const CALIBER_DIR = '.caliber';
export const MANIFEST_FILE = path.join(CALIBER_DIR, 'manifest.json');
export const BACKUPS_DIR = path.join(CALIBER_DIR, 'backups');
export const LEARNING_DIR = path.join(CALIBER_DIR, 'learning');
export const LEARNING_SESSION_FILE = 'current-session.jsonl';
export const LEARNING_STATE_FILE = 'state.json';
export const LEARNING_MAX_EVENTS = 500;
export const LEARNING_ROI_FILE = 'roi-stats.json';
