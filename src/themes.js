// 场景主题：每 3 层切换一次（地窖 → 苔藓遗迹 → 冰封洞窟 → 熔岩深渊，之后循环且更难）
export const THEMES = {
  crypt: {
    id: 'crypt', name: '幽暗地窖', names: ['潮湿地窖', '骸骨回廊', '遗忘牢房'],
    floor: '#5a5560', wall: '#56505e', wall2: '#5e5048', mortar: '#221e28', top: '#2c2832', corr: '#57525a',
    overlay: 'moss', fog: 0x06050a, hemiSky: 0x8a90c8, hemiGround: 0x2a2018, moon: 0x9aa8e0,
    torch: 0xff8a3a, flame: [0xff7a1a, 0xffe06a], particles: 'dust', hazard: null,
    enemies: ['skeleton', 'skeleton', 'slime', 'bat', 'archer'], decor: ['cobweb', 'chains', 'coffin', 'bookshelf', 'table'],
  },
  moss: {
    id: 'moss', name: '苔藓遗迹', names: ['藤蔓神殿', '孢子密林', '沉睡古庭'],
    floor: '#56604e', wall: '#4e5a48', wall2: '#5a5a40', mortar: '#1a2218', top: '#28321f', corr: '#4e5846',
    overlay: 'mossHeavy', fog: 0x040a06, hemiSky: 0x88c890, hemiGround: 0x1a2a14, moon: 0x9ad8a0,
    torch: 0xffb050, flame: [0xffa030, 0xfff08a], particles: 'spores', hazard: 'poison',
    enemies: ['mushroom', 'mushroom', 'slime', 'archer', 'bat', 'skeleton'], decor: ['mushrooms', 'vines', 'roots', 'statue', 'puddle'],
  },
  ice: {
    id: 'ice', name: '冰封洞窟', names: ['霜语冰窟', '寒晶回廊', '永冬王座'],
    floor: '#6a7a8e', wall: '#5e7088', wall2: '#7a90a8', mortar: '#1a2230', top: '#2c3a4c', corr: '#62728a',
    overlay: 'frost', fog: 0x060a14, hemiSky: 0x9ac8ff, hemiGround: 0x1a2436, moon: 0xb0d8ff,
    torch: 0x6ac8ff, flame: [0x4ab8ff, 0xd8fbff], particles: 'snow', hazard: 'ice',
    enemies: ['wraith', 'iceMage', 'bat', 'skeleton', 'iceMage', 'archer'], decor: ['crystals', 'stalagmites', 'snow', 'icicles', 'statue'],
  },
  lava: {
    id: 'lava', name: '熔岩深渊', names: ['焦土裂谷', '熔火锻炉', '炎魔之心'],
    floor: '#4a3a36', wall: '#4a3432', wall2: '#5a3a2a', mortar: '#140a08', top: '#241612', corr: '#4a3632',
    overlay: 'lava', fog: 0x0e0504, hemiSky: 0xff9a70, hemiGround: 0x2a0a04, moon: 0xffa080,
    torch: 0xff5a1a, flame: [0xff4a0a, 0xffc040], particles: 'embers', hazard: 'lava',
    enemies: ['fireImp', 'fireImp', 'skeleton', 'archer', 'wraith', 'slime'], decor: ['lavapool', 'obsidian', 'skulls', 'brazierLava', 'chains'],
  },
};
export const THEME_ORDER = ['crypt', 'moss', 'ice', 'lava'];

export function themeFor(floor) {
  return THEMES[THEME_ORDER[Math.floor((floor - 1) / 3) % THEME_ORDER.length]];
}
export function floorTitle(floor) {
  const th = themeFor(floor);
  return th.names[(floor - 1) % 3];
}

// 楼层词缀（第 3 层起随机出现）
export const MODIFIERS = {
  dark: { name: '无光之层', desc: '火把熄灭，只能依靠提灯', color: '#9a8ac8' },
  swarm: { name: '群魔乱舞', desc: '怪物数量增加', color: '#ff8a6a' },
  bounty: { name: '财宝之层', desc: '金币与水晶掉落翻倍', color: '#ffcf4a' },
  traps: { name: '机关密布', desc: '陷阱更多，节奏更快', color: '#ff6a4a' },
  blessed: { name: '圣泉庇佑', desc: '每个房间清空后回复半颗心', color: '#7fd8ff' },
};
export function rollModifier(floor, rng) {
  if (floor < 3 || floor % 5 === 0) return null;
  if (rng() > 0.55) return null;
  const keys = Object.keys(MODIFIERS);
  return keys[Math.floor(rng() * keys.length)];
}
