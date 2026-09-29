// 本地存档
import { platform } from './platform.js';

const KEY = 'dungeon_keys_save_v1';

function defaults() {
  return {
    v: 1,
    crystals: 0,
    meta: { hp: 0, dmg: 0, talent: 0, luck: 0 },
    best: 0,
    stats: { runs: 0, kills: 0, deaths: 0, bosses: 0 },
    settings: { sound: true, music: true, quality: platform.isWx ? 'mid' : 'high' },
    run: null,
    hero: { cls: 'knight', gender: 'male', fur: 0, outfit: 0, acc: 0 },
    tutorial: 0,
  };
}

export class SaveData {
  constructor() {
    const d = platform.getItem(KEY);
    this.data = d && d.v === 1 ? Object.assign(defaults(), d) : defaults();
    this.data.meta = Object.assign(defaults().meta, this.data.meta || {});
    this.data.settings = Object.assign(defaults().settings, this.data.settings || {});
    this.data.stats = Object.assign(defaults().stats, this.data.stats || {});
  }
  save() { platform.setItem(KEY, this.data); }
}
