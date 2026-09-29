// 构建：将 src/ 打包为 js/bundle.js（微信小游戏与浏览器预览共用）
import * as esbuild from 'esbuild';
const watch = process.argv.includes('--watch');
const opts = {
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: ['es2017'],
  outfile: 'js/bundle.js',
  minify: !process.argv.includes('--dev'),
  legalComments: 'none',
  logLevel: 'info',
};
if (watch) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
} else {
  await esbuild.build(opts);
}
