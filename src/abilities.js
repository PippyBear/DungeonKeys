// 能力（每层通关三选一，可叠加升级）
export const ABILITIES = {
  sharp: { name: '锋刃强化', icon: 'sharp', max: 3, rarity: 1, desc: (l) => '攻击伤害 +' + 25 * l + '%' },
  fire: { name: '烈焰附魔', icon: 'fire', max: 2, rarity: 2, desc: (l) => '命中使敌人燃烧，每秒 ' + 4 * l + ' 点伤害，持续 3 秒' },
  frost: { name: '冰霜附魔', icon: 'frost', max: 2, rarity: 2, desc: (l) => '命中使敌人减速 ' + (30 + 15 * l) + '%，持续 2 秒' },
  thunder: { name: '雷霆之怒', icon: 'thunder', max: 2, rarity: 3, desc: (l) => '每第 3 次命中释放闪电，连锁 ' + (2 + l) + ' 个敌人' },
  vamp: { name: '生命汲取', icon: 'vamp', max: 2, rarity: 2, desc: (l) => '击杀敌人时 ' + 15 * l + '% 几率回复半颗心' },
  heart: { name: '坚韧之心', icon: 'heart', max: 3, rarity: 1, desc: () => '生命上限 +1 颗心，并回满生命' },
  boots: { name: '疾风之靴', icon: 'boots', max: 2, rarity: 1, desc: (l) => '移动速度 +' + 15 * l + '%，翻滚冷却 -' + 20 * l + '%' },
  whirl: { name: '旋风斩', icon: 'whirl', max: 1, rarity: 3, desc: () => '普通攻击变为 360° 回旋斩' },
  blade: { name: '飞刃', icon: 'blade', max: 2, rarity: 2, desc: (l) => '攻击时射出 ' + l + ' 道飞刃，造成 60% 伤害' },
  shield: { name: '神圣护盾', icon: 'shield', max: 2, rarity: 2, desc: (l) => '每 ' + (l === 1 ? 12 : 8) + ' 秒生成护盾，抵挡一次伤害' },
  trapsense: { name: '陷阱大师', icon: 'trap', max: 2, rarity: 1, desc: (l) => l === 1 ? '陷阱发出警示光，陷阱伤害减半' : '陷阱对你完全无效' },
  compass: { name: '寻宝罗盘', icon: 'compass', max: 1, rarity: 1, desc: () => '小地图显示钥匙与出口位置，并指引方向' },
  greed: { name: '贪婪之手', icon: 'greed', max: 2, rarity: 1, desc: (l) => '金币获取 +' + 50 * l + '%，宝箱掉落更多' },
  fireball: { name: '火球术', icon: 'fireball', max: 2, rarity: 2, active: true, desc: (l) => '主动技能：发射爆炸火球（冷却 ' + (l === 1 ? 6 : 4) + ' 秒）' },
  nova: { name: '冰霜新星', icon: 'nova', max: 2, rarity: 2, active: true, desc: (l) => '主动技能：冻结周围敌人 ' + (2 + l) + ' 秒（冷却 9 秒）' },
  burst: { name: '爆裂亡魂', icon: 'burst', max: 1, rarity: 3, desc: () => '敌人死亡时爆炸，对周围敌人造成伤害' },
  phase: { name: '幽影步', icon: 'phase', max: 1, rarity: 2, desc: () => '翻滚穿过敌人时造成伤害，翻滚距离提升' },
  wings: { name: '羽翼之靴', icon: 'wings', max: 1, rarity: 2, desc: () => '可在空中再跳一次（二段跳），直接跃上高台与塔楼' },
  eye: { name: '洞察之眼', icon: 'eye', max: 1, rarity: 2, desc: () => '每层开始时揭示整张地图' },
};
export const ABILITY_IDS = Object.keys(ABILITIES);

export function rollAbilities(owned, rng, n = 3) {
  const pool = [];
  for (const id of ABILITY_IDS) {
    const lv = owned[id] || 0;
    const a = ABILITIES[id];
    if (lv >= a.max) continue;
    // 已有两个主动技能时不再给新的主动技能
    if (a.active && !lv && ABILITY_IDS.filter((k) => ABILITIES[k].active && owned[k]).length >= 2) continue;
    const w = a.rarity === 1 ? 10 : a.rarity === 2 ? 7 : 4;
    pool.push({ id, w: lv ? w * 1.2 : w });
  }
  const out = [];
  while (out.length < n && pool.length) {
    let total = 0;
    for (const p of pool) total += p.w;
    let r = rng() * total;
    let k = 0;
    for (; k < pool.length - 1; k++) { r -= pool[k].w; if (r <= 0) break; }
    out.push(pool[k].id);
    pool.splice(k, 1);
  }
  return out;
}

export const META = {
  hp: { name: '生命祝福', icon: 'heart', max: 3, cost: [30, 70, 130], desc: '初始生命 +1 颗心' },
  dmg: { name: '锻造秘术', icon: 'sword', max: 3, cost: [25, 60, 110], desc: '初始攻击力 +12%' },
  talent: { name: '天赋觉醒', icon: 'star', max: 1, cost: [90], desc: '每次冒险开局获得一个随机能力' },
  luck: { name: '幸运之星', icon: 'coin', max: 2, cost: [40, 90], desc: '金币与水晶掉落率提升' },
};
